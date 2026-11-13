"""The three brains: Reflex answers first, Main does everyday tasks with tools,
Deep runs long jobs in the background."""
import threading
import time
from datetime import datetime
from typing import Callable

import anthropic

from . import settings
from .memory import Memory
from .tools import MAIN_TOOLS, REFLEX_TOOLS, ToolBox, ToolError
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
        "- target 'deep' for research, planning, reports and hard problems that "
        "deserve long, careful thought. First write one short sentence telling "
        "the user you are starting a background job and will tell them when it "
        "is done, then call the tool.\n"
        "Never guess. If you are not confident an answer is right, hand off to main."
    ),
    "main": (
        "You are running as JARVIS's Main brain, handling everyday tasks with "
        "tools. Files can only be created and read inside the workspace folder. "
        "If a request needs research, a plan, a report or long careful thought, "
        "start a background job with start_deep_job and tell the user it is "
        "running and that they will be told when it is done."
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
        self.jobs_lock = threading.Lock()
        self.summary_lock = threading.Lock()

    # ---- building a request ------------------------------------------------
    def _system(self, brain: str) -> list[dict]:
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
        return [
            # Stable part first, marked for prompt caching (tools + this block).
            {"type": "text", "text": self.personality + "\n\n" + ROLE[brain],
             "cache_control": {"type": "ephemeral"}},
            # Changing part after the cache marker so it never spoils the cache.
            {"type": "text", "text": "\n\n".join(parts)},
        ]

    def _call(self, brain: str, system, messages, tools, usage: Usage,
              on_text: Callable[[str], None] | None = None,
              on_reset: Callable[[], None] | None = None):
        """One streamed API call, retried once if the failure looks temporary."""
        b = self.cfg["brains"][brain]
        kwargs = dict(model=b["model"], max_tokens=int(b.get("max_tokens", 16000)),
                      system=system, messages=messages)
        if b.get("effort"):
            kwargs["output_config"] = {"effort": b["effort"]}
        if tools:
            kwargs["tools"] = tools
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
              user_text: str) -> LoopResult:
        """Call a brain, run any tools it asks for, repeat until it has answered."""
        result = LoopResult()
        system = self._system(brain)

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

            final = self._call(brain, system, messages, tools, usage, on_text, on_reset)
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
                result.handoff = target if target in ("main", "deep") else "main"
                return result
            # Pass the brain's full reply back unchanged, then all tool results together.
            messages.append({"role": "assistant", "content": final.content})
            results = []
            for call in calls:
                self.emit({"type": "status", "text": f"Using tool: {call.name}"})
                try:
                    if call.name == "start_deep_job":
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
    def handle(self, user_text: str) -> None:
        """Answer one message from the user. Run this on a background thread."""
        start = time.perf_counter()
        usage = Usage()
        brain, ok, answer = "reflex", True, ""
        try:
            history = self.memory.recent_for_prompt()
            ask = {"role": "user", "content": user_text}
            result = self._loop("reflex", history + [ask], REFLEX_TOOLS, usage, user_text)
            if result.handoff == "main":
                brain = "main"
                if result.text:
                    self.emit({"type": "reset", "text": ""})
                self.emit({"type": "status", "text": "Main brain is working..."})
                result = self._loop("main", history + [ask], MAIN_TOOLS, usage, user_text)
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
        today = self.log.record(brain, self.cfg["brains"][key]["model"], ms, usage, ok,
                                user_text)
        self.emit({"type": "done", "brain": brain, "ms": ms, "cost": usage.cost,
                   "tokens": usage.input + usage.output + usage.cache_read + usage.cache_write,
                   "today": today, "ok": ok})
        if ok:
            threading.Thread(target=self._maybe_summarise, daemon=True).start()

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
