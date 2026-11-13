"""The three brains: Reflex answers first, Main does everyday tasks with tools,
Deep runs long jobs in the background."""
import os
import re
import threading
import time
from datetime import datetime
from typing import Callable

import anthropic

from . import settings
from .memory import Memory
from .research import TRIGGER as RESEARCH_TRIGGER, Researcher
from .tools import MAIN_TOOLS, REFLEX_TOOLS, RESEARCH_DECISION, ToolBox, ToolError
from .usage_log import Usage, UsageLog

FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOOL_ROUNDS = 8

ROLE = {
    "reflex": (
        "You are running as JARVIS's Reflex brain: the fastest of three brains, "
        "and the first to see every request.\n"
        "Answer yourself, straight away and briefly, when the request is a "
        "greeting or small talk, a simple well-known fact, the date or time, "
        "remembering or recalling a fact, or opening an app or website.\n"
        "For anything else call the hand_off tool:\n"
        "- target 'main' for everyday tasks: working with files, writing, "
        "explaining, multi-step requests, or any fact you are not sure of. Call "
        "the tool without writing any text first.\n"
        "- target 'research' for anything that needs the web: current events, "
        "prices, product comparisons, or facts you would have to look up. First "
        "write just \"On it.\", then call the tool.\n"
        "- target 'deep' for planning, long writing and hard problems that "
        "deserve long, careful thought but not the web. First write one short "
        "sentence telling the user you are starting a background job and will "
        "tell them when it is done, then call the tool.\n"
        "Never guess. If you are not confident an answer is right, hand off to main."
    ),
    "main": (
        "You are running as JARVIS's Main brain, handling everyday tasks with "
        "tools. Files can only be created and read inside the workspace folder. "
        "If a request needs information from the web, start a background "
        "research job with start_research_job and reply \"On it.\" If it needs a "
        "plan, long writing or long careful thought without the web, use "
        "start_deep_job. Either way the user is told when the job is done."
    ),
    "deep": (
        "You are running as JARVIS's Deep brain, working on a background job: "
        "research, planning, a report or a hard problem. You have no tools and "
        "no internet access in this job, so work from what you know and say "
        "clearly where something is uncertain or may be out of date. Your whole "
        "reply is saved as a report and shown to the user when you finish, so "
        "write it to stand on its own."
    ),
}


SPOKEN_HINT = (
    "The user spoke this request aloud and your reply will be read out by a "
    "voice. Answer in one to three short, natural sentences unless they ask "
    "for more. Use plain words only: no lists, headings, symbols or formatting."
)


class Interrupted(Exception):
    """The user told JARVIS to stop while a reply was being written."""


_YES = {"yes", "yeah", "yep", "yes please", "please do", "sure", "ok", "okay", "go ahead",
        "do it", "please", "yes do", "of course", "absolutely"}
_NO = {"no", "nope", "no thanks", "no thank you", "not now", "later", "leave it", "don't",
       "dont", "no need"}
_CONTINUE = {"continue", "carry on", "keep going", "go on", "continue please",
             "keep researching", "continue the research"}
_FINISH = {"finish", "finish it", "write it up", "write the report", "wrap up", "wrap it up",
           "stop there", "that's enough", "write it up with what you have",
           "write the report with what you have"}
_CANCEL = {"cancel", "cancel it", "cancel the research", "cancel the job", "abandon it"}
_OPEN = {"open it", "open the report", "open", "show me", "show it", "yes open it",
         "open it please"}


class Failure(Exception):
    """An API problem, already put into plain words for the user."""


def plain_error(e: Exception) -> str:
    if isinstance(e, anthropic.AuthenticationError):
        return ("Anthropic did not accept the API key. Check the key in the .env "
                "file is complete and still active.")
    if isinstance(e, anthropic.PermissionDeniedError):
        return "This API key is not allowed to use that model or feature."
    if isinstance(e, anthropic.NotFoundError):
        return ("Anthropic does not recognise the model name. Check the model "
                "names in config.yaml.")
    if isinstance(e, anthropic.RateLimitError):
        return ("Too many requests were sent in a short time, or the account's "
                "usage limit was reached. Wait a minute and try again.")
    if isinstance(e, anthropic.BadRequestError):
        msg = str(getattr(e, "message", "") or e)
        if "credit" in msg.lower() or "billing" in msg.lower():
            return "The Anthropic account has run out of credit. Add credit and try again."
        return f"Anthropic rejected the request as invalid. Their message: {msg[:300]}"
    if isinstance(e, anthropic.APITimeoutError):
        return "Anthropic took too long to answer. Try again in a moment."
    if isinstance(e, anthropic.APIConnectionError):
        return "I could not reach Anthropic. Check your internet connection."
    if isinstance(e, anthropic.APIStatusError):
        if e.status_code >= 500:
            return ("Anthropic's service is having trouble or is overloaded right "
                    "now. Try again in a few minutes.")
        return f"Anthropic returned an error (code {e.status_code})."
    return f"Something unexpected went wrong: {type(e).__name__}."


def _retryable(e: Exception) -> bool:
    if isinstance(e, (anthropic.APIConnectionError, anthropic.RateLimitError)):
        return True
    return isinstance(e, anthropic.APIStatusError) and e.status_code >= 500


class LoopResult:
    def __init__(self):
        self.text = ""
        self.handoff: str | None = None
        self.refused = False
        self.interrupted = False


class Engine:
    """emit(event) is called with dicts: delta, reset, status, done, error,
    job_done, job_failed. It may be called from any thread."""

    def __init__(self, emit: Callable[[dict], None]):
        settings.ensure_folders()
        self.cfg = settings.load_config()
        self.personality = settings.load_personality()
        # max_retries=0: JARVIS does its own single retry (see _call).
        self.client = anthropic.Anthropic(api_key=settings.load_api_key(), max_retries=0)
        self.memory = Memory(settings.DB_PATH)
        self.tools = ToolBox(self.memory, settings.WORKSPACE, self.cfg["apps"])
        self.log = UsageLog(settings.LOGS)
        self.emit = emit
        self.jobs = 0
        self.researcher = Researcher(self)
        self.pending: dict | None = None   # a yes/no question a research job is waiting on
        self.jobs_lock = threading.Lock()
        self.summary_lock = threading.Lock()
        self.cancel_event = threading.Event()

    def cancel(self) -> None:
        """Stop the chat reply being written right now (background jobs carry on)."""
        self.cancel_event.set()

    # ---- building a request ------------------------------------------------
    def _system(self, brain: str, spoken: bool = False) -> list[dict]:
        mem = self.cfg["memory"]
        parts = [f"Current local date and time: "
                 f"{datetime.now().astimezone().strftime('%A, %d %B %Y, %H:%M (%Z)')}"]
        facts = self.memory.all_facts(limit=mem.get("facts_in_prompt", 40))
        if facts:
            parts.append("Facts the user asked you to remember:\n"
                         + "\n".join(f"- {f}" for _i, f, _c in facts))
        summary = self.memory.get_summary()
        if summary:
            parts.append("Summary of the earlier conversation:\n" + summary)
        if brain in ("reflex", "main"):
            status = self.researcher.status_lines()
            if status:
                parts.append("Background research right now:\n" + "\n".join(status))
            if self.pending and self.pending["kind"] == "limit":
                parts.append("A research job is paused and has asked the user whether to "
                             "continue or to write the report with what it has. If the "
                             "user answers that, call research_decision.")
            elif self.pending and self.pending["kind"] == "open":
                parts.append("You have just asked the user whether to open the finished "
                             "research report. If they answer that, call research_decision.")
        if spoken:
            parts.append(SPOKEN_HINT)
        return [
            # Stable part first, marked for prompt caching (tools + this block).
            {"type": "text", "text": self.personality + "\n\n" + ROLE[brain],
             "cache_control": {"type": "ephemeral"}},
            # Changing part after the cache marker so it never spoils the cache.
            {"type": "text", "text": "\n\n".join(parts)},
        ]

    def _call(self, brain: str, system, messages, tools, usage: Usage,
              on_text: Callable[[str], None] | None = None,
              on_reset: Callable[[], None] | None = None, extra: dict | None = None):
        """One streamed API call, retried once if the failure looks temporary."""
        b = self.cfg["brains"][brain]
        kwargs = dict(model=b["model"], max_tokens=int(b.get("max_tokens", 16000)),
                      system=system, messages=messages)
        if b.get("effort"):
            kwargs["output_config"] = {"effort": b["effort"]}
        if tools:
            kwargs["tools"] = tools
        if extra:
            kwargs.update(extra)
        if brain == "deep" and b.get("refusal_fallback", True):
            open_stream = lambda: self.client.beta.messages.stream(
                betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
        else:
            open_stream = lambda: self.client.messages.stream(**kwargs)

        for attempt in (1, 2):
            streamed = False
            try:
                with open_stream() as stream:
                    for event in stream:
                        if on_text and self.cancel_event.is_set():
                            try:  # count what was used before the interruption
                                snap = stream.current_message_snapshot
                                usage.add(snap.usage, snap.model, self.cfg["prices"])
                            except Exception:
                                pass
                            raise Interrupted()
                        if event.type == "text" and on_text:
                            streamed = True
                            on_text(event.text)
                    final = stream.get_final_message()
                usage.add(final.usage, final.model, self.cfg["prices"])
                return final
            except anthropic.APIError as e:
                self.log.error(brain, f"attempt {attempt}: {type(e).__name__}: "
                                      f"{str(e)[:500]}")
                if attempt == 1 and _retryable(e):
                    if streamed and on_reset:
                        on_reset()  # wipe the half-written reply before trying again
                    time.sleep(2)
                    continue
                tried = " I tried twice." if attempt == 2 else ""
                raise Failure(plain_error(e) + tried) from e

    def _loop(self, brain: str, messages: list, tools: list, usage: Usage,
              user_text: str, spoken: bool = False) -> LoopResult:
        """Call a brain, run any tools it asks for, repeat until it has answered."""
        result = LoopResult()
        system = self._system(brain, spoken)

        def on_text(chunk: str):
            result.text += chunk
            self.emit({"type": "delta", "text": chunk})

        for _ in range(MAX_TOOL_ROUNDS):
            if result.text and not result.text.endswith("\n"):
                on_text("\n\n")
            mark = len(result.text)

            def on_reset(mark=mark):
                result.text = result.text[:mark]
                self.emit({"type": "reset", "text": result.text})

            try:
                final = self._call(brain, system, messages, tools, usage, on_text, on_reset)
            except Interrupted:
                result.interrupted = True
                return result
            if final.stop_reason == "refusal":
                result.refused = True
                return result
            calls = [b for b in final.content if b.type == "tool_use"]
            if not calls:
                if final.stop_reason == "max_tokens":
                    on_text("\n\n(I ran out of room there - ask me to continue.)")
                return result
            if final.stop_reason == "max_tokens":
                raise Failure("My reply was cut off part-way through using a tool. "
                              "Please try again.")
            handoff = next((c for c in calls if c.name == "hand_off"), None)
            if handoff is not None:
                target = handoff.input.get("target") if isinstance(handoff.input, dict) else None
                result.handoff = target if target in ("main", "research", "deep") else "main"
                return result
            # Pass the brain's full reply back unchanged, then all tool results together.
            messages.append({"role": "assistant", "content": final.content})
            results = []
            for call in calls:
                self.emit({"type": "status", "text": f"Using tool: {call.name}"})
                try:
                    if call.name == "start_research_job":
                        task = call.input.get("task") if isinstance(call.input, dict) else ""
                        job = self.start_research(task or user_text)
                        out, err = (f"Research job #{job} started in the background. Reply "
                                    "\"On it.\" The user is told when the report is ready."), False
                    elif call.name == "research_decision":
                        d = call.input.get("decision") if isinstance(call.input, dict) else ""
                        out, err = self.apply_decision(str(d)), False
                    elif call.name == "start_deep_job":
                        task = call.input.get("task") if isinstance(call.input, dict) else ""
                        job = self.start_deep_job(task or user_text)
                        out, err = (f"Background job #{job} started. Tell the user it is "
                                    "running and they will be told when it is done."), False
                    else:
                        out, err = self.tools.run(call.name, call.input), False
                except ToolError as e:
                    out, err = str(e), True
                except Exception as e:  # a bug in a tool must not crash the chat
                    self.log.error("tool", f"{call.name}: {type(e).__name__}: {e}")
                    out, err = f"The tool failed unexpectedly: {type(e).__name__}", True
                results.append({"type": "tool_result", "tool_use_id": call.id,
                                "content": out, "is_error": err})
            messages.append({"role": "user", "content": results})
        on_text("\n\n(I stopped because this was taking too many steps.)")
        return result

    # ---- one chat request --------------------------------------------------
    def handle(self, user_text: str, spoken: bool = False) -> None:
        """Answer one message from the user. Run this on a background thread."""
        start = time.perf_counter()
        usage = Usage()
        brain, ok, answer = "reflex", True, ""
        self.cancel_event.clear()
        try:
            history = self.memory.recent_for_prompt()
            ask = {"role": "user", "content": user_text}
            shortcut = self._shortcut(user_text)
            if shortcut is not None:
                # Answered without a brain: a research trigger word, or yes/no to a
                # question a research job is waiting on.
                brain, text = shortcut
                result = LoopResult()
                result.text = text
                self.emit({"type": "delta", "text": text})
            else:
                tools = REFLEX_TOOLS + ([RESEARCH_DECISION] if self.pending else [])
                result = self._loop("reflex", history + [ask], tools, usage, user_text, spoken)
            if result.interrupted:
                pass
            elif result.handoff == "main":
                brain = "main"
                if result.text:
                    self.emit({"type": "reset", "text": ""})
                self.emit({"type": "status", "text": "Main brain is working..."})
                result = self._loop("main", history + [ask], MAIN_TOOLS, usage, user_text,
                                    spoken)
            elif result.handoff == "research":
                job = self.start_research(user_text)
                brain = f"reflex (started research job #{job})"
                if not result.text.strip():
                    result.text = "On it."
                    self.emit({"type": "delta", "text": result.text})
            elif result.handoff == "deep":
                job = self.start_deep_job(user_text)
                brain = f"reflex (started deep job #{job})"
                if not result.text.strip():
                    note = (f"I've started background job #{job} on my deep brain. "
                            "I'll tell you when it's done.")
                    result.text = note
                    self.emit({"type": "delta", "text": note})
            if result.refused and not result.text.strip():
                result.text = "I'm not able to help with that request."
                self.emit({"type": "delta", "text": result.text})
            answer = result.text.strip() or "(no reply)"
            if result.interrupted:
                brain += " (interrupted)"
                answer = (result.text.strip() + " [the user interrupted here]").strip()
                self.emit({"type": "delta", "text": "  [stopped]"})
            self.memory.add_message("user", user_text)
            self.memory.add_message("assistant", answer)
        except Failure as e:
            ok = False
            self.emit({"type": "error", "text": str(e)})
        except Exception as e:
            ok = False
            self.log.error("handle", f"{type(e).__name__}: {e}")
            self.emit({"type": "error",
                       "text": f"Something unexpected went wrong inside JARVIS "
                               f"({type(e).__name__}). Details are in logs/errors.log."})
        ms = int((time.perf_counter() - start) * 1000)
        key = brain.split(" ")[0]
        model = self.cfg["brains"].get(key, {}).get("model", "none")
        today = self.log.record(brain, model, ms, usage, ok,
                                user_text)
        self.emit({"type": "done", "brain": brain, "ms": ms, "cost": usage.cost,
                   "tokens": usage.input + usage.output + usage.cache_read + usage.cache_write,
                   "today": today, "ok": ok})
        if ok:
            threading.Thread(target=self._maybe_summarise, daemon=True).start()

    # ---- research jobs -------------------------------------------------------
    def start_research(self, task: str) -> int:
        with self.jobs_lock:
            self.jobs += 1
            job = self.jobs
        self.researcher.start(job, task, self.memory.recent_for_prompt())
        return job

    def _shortcut(self, user_text: str) -> tuple[str, str] | None:
        """Things JARVIS handles instantly without asking a brain."""
        words = re.sub(r"[^a-z' ]", " ", user_text.lower())
        words = re.sub(r"^\s*(hey\s+)?jarvis\s+", "", " ".join(words.split()))
        if self.pending and len(words.split()) <= 7:
            yes = words in _YES or words.startswith(("yes ", "yeah ", "sure ", "ok ", "okay "))
            no = words in _NO or words.startswith(("no ", "nope ", "not now"))
            if self.pending["kind"] == "limit":
                d = ("cancel" if words in _CANCEL else "finish" if words in _FINISH or no
                     else "continue" if yes or words in _CONTINUE else None)
            else:
                d = "open_report" if yes or words in _OPEN else "leave" if no else None
            if d:
                return "shortcut (no brain needed)", self.apply_decision(d)
        if RESEARCH_TRIGGER.match(user_text):
            job = self.start_research(user_text)
            return (f"research (started job #{job})",
                    f"On it. Research job {job} is running in the background, and you can "
                    "keep talking to me.")
        return None

    def apply_decision(self, decision: str) -> str:
        """Carry out the user's answer to a research question. Returns what to tell them."""
        if decision in ("continue", "finish", "cancel"):
            job = self.researcher.waiting_job()
            if job is None:
                return "No research job is waiting for an answer."
            self.pending = None
            self.researcher.decide(job, decision)
            return {"continue": "Continuing the research.",
                    "finish": "All right, I'll write the report with what I have.",
                    "cancel": "Research cancelled."}[decision]
        path = (self.pending or {}).get("path")
        if not path:
            done = [j for j in self.researcher.jobs.values() if j.file]
            path = str(done[-1].file) if done else None
        self.pending = None
        if decision == "leave":
            return "All right. It's in the workspace research folder whenever you want it."
        if not path or not os.path.exists(path):
            return "I can't find a finished report to open."
        if self.tools.dry_run:
            return f"(test mode) Would open {os.path.basename(path)}."
        try:
            os.startfile(path)  # opens it in Word, as a double-click would
        except (AttributeError, OSError) as e:
            return f"I couldn't open the report: {e}"
        return "Opening it now."

    # ---- deep background jobs ----------------------------------------------
    def start_deep_job(self, task: str) -> int:
        with self.jobs_lock:
            self.jobs += 1
            job = self.jobs
        history = self.memory.recent_for_prompt()
        threading.Thread(target=self._deep_worker, args=(job, task, history),
                         daemon=True).start()
        return job

    def _deep_worker(self, job: int, task: str, history: list) -> None:
        start = time.perf_counter()
        usage = Usage()
        ok = True
        try:
            messages = history + [{"role": "user", "content": task}]
            final = self._call("deep", self._system("deep"), messages, None, usage)
            text = "".join(b.text for b in final.content if b.type == "text").strip()
            if final.stop_reason == "refusal" and not text:
                raise Failure("The deep brain declined this request for safety reasons.")
            if final.stop_reason == "max_tokens":
                text += "\n\n(The report hit the length limit and stops here.)"
            reports = settings.WORKSPACE / "reports"
            reports.mkdir(parents=True, exist_ok=True)
            name = f"{datetime.now().strftime('%Y-%m-%d_%H%M%S')}_job{job}.md"
            (reports / name).write_text(f"# Request\n\n{task}\n\n# Report\n\n{text}\n",
                                        encoding="utf-8")
            self.memory.add_message(
                "assistant",
                f"[Background job #{job} finished. Full report saved as "
                f"workspace/reports/{name}]\n\n{text}")
            self.emit({"type": "job_done", "job": job, "text": text,
                       "file": f"workspace\\reports\\{name}"})
        except Failure as e:
            ok = False
            self.emit({"type": "job_failed", "job": job, "text": str(e)})
        except Exception as e:
            ok = False
            self.log.error("deep", f"{type(e).__name__}: {e}")
            self.emit({"type": "job_failed", "job": job,
                       "text": f"Something unexpected went wrong ({type(e).__name__})."})
        ms = int((time.perf_counter() - start) * 1000)
        today = self.log.record(f"deep (job #{job})", self.cfg["brains"]["deep"]["model"],
                                ms, usage, ok, task)
        self.emit({"type": "job_logged", "job": job, "ms": ms, "cost": usage.cost,
                   "today": today, "ok": ok})

    # ---- keeping history small ---------------------------------------------
    def _maybe_summarise(self) -> None:
        mem = self.cfg["memory"]
        keep = int(mem.get("recent_messages", 12))
        if not self.summary_lock.acquire(blocking=False):
            return
        try:
            rows = self.memory.unsummarised()
            if len(rows) <= int(mem.get("summarise_after", 24)):
                return
            old = rows[:-keep] if keep else rows
            if not old:
                return
            transcript = "\n\n".join(f"{role.upper()}: {content[:4000]}"
                                     for _id, role, content in old)
            prompt = (
                "Here is the running summary of an earlier conversation between a "
                "user and their assistant JARVIS, followed by the next part of that "
                "conversation. Write an updated summary of everything, under 250 "
                "words, keeping names, decisions, preferences and unfinished tasks. "
                "Reply with the summary only.\n\n"
                f"<summary>\n{self.memory.get_summary() or '(none yet)'}\n</summary>\n\n"
                f"<conversation>\n{transcript}\n</conversation>"
            )
            start = time.perf_counter()
            usage = Usage()
            ok = True
            try:
                final = self._call("reflex", "You write short, accurate summaries.",
                                   [{"role": "user", "content": prompt}], None, usage)
                text = "".join(b.text for b in final.content if b.type == "text").strip()
                if text and final.stop_reason == "end_turn":
                    self.memory.save_summary(text, old[-1][0])
                else:
                    ok = False
            except Failure:
                ok = False  # history simply stays as it is; we try again next time
            self.log.record("reflex (history summary)", self.cfg["brains"]["reflex"]["model"],
                            int((time.perf_counter() - start) * 1000), usage, ok,
                            "(automatic summary of older conversation)")
        finally:
            self.summary_lock.release()
