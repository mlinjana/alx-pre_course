"""The three brains: Reflex answers first, Main does everyday tasks with tools,
Deep runs long jobs in the background."""
import json
import os
import re
import threading
import time
from datetime import datetime
from typing import Callable

import anthropic

from . import settings
from .control import Computer, Tier3
from .memory import Memory
from .research import TRIGGER as RESEARCH_TRIGGER, Researcher
from .tools import (MAIN_TOOLS, REFLEX_TOOLS, REFLEX_TOOLS_BEFORE, RESEARCH_DECISION, ToolBox,
                    ToolError)
from .usage_log import Usage, UsageLog

FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOOL_ROUNDS = 8

ROLE = {
    "reflex": (
        "You are running as JARVIS's Reflex brain: the fastest of three brains, "
        "and the first to see every request.\n"
        "Answer yourself, straight away, whenever you can do it well: greetings "
        "and small talk; the date or time; well-known facts; short explanations "
        "and simple how-to questions on everyday topics; simple sums and unit "
        "conversions; a sentence or two of writing; remembering, recalling or "
        "forgetting a fact; opening an app or website; changing the volume; and "
        "finding, listing or reading files in the allowed folders.\n"
        "Call the hand_off tool for everything else:\n"
        "- target 'main' for anything that creates, moves, renames or removes a "
        "file, runs a command, types into an app or needs the screen; for longer "
        "writing or analysis; for requests with several steps; and for any fact "
        "you are not sure of. Call the tool without writing any text first.\n"
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
        "tools, including control of the user's Windows PC under three safety "
        "tiers that JARVIS's own code enforces.\n"
        "Tier 1 (just do it): open apps and websites, search for and read files "
        "in the allowed folders, change the volume, look at the screen.\n"
        "Tier 2 (the user must say yes): create, move or rename files, run a "
        "PowerShell command, type into an app, fill in a form, control the "
        "screen. Just call the tool: JARVIS shows the user exactly what will "
        "happen and waits for their yes. Do not ask them yourself first, and if "
        "they say no, do not retry or find another route.\n"
        "Tier 3 (never, even if asked): delete anything permanently, make "
        "payments, send emails or messages, change passwords or security "
        "settings, install software. Say plainly that you will not. To delete "
        "something, offer move_to_recycle_bin.\n"
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


# The narrower reflex wording used before the speed work. benchmark.py uses it
# to measure "before" and "after" in one run.
ROLE_BEFORE = {
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


def is_yes(text: str) -> bool:
    words = " ".join(re.sub(r"[^a-z' ]", " ", str(text).lower()).split())
    words = re.sub(r"^(hey )?jarvis ", "", words)
    return words in _YES or words in {"yes go ahead", "yes do it", "yes please do",
                                      "go ahead please", "yes that's fine", "confirm",
                                      "confirmed", "approved", "i confirm"}


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

    def __init__(self, emit: Callable[[dict], None], profile: str | None = None,
                 db_path=None):
        settings.ensure_folders()
        self.cfg = settings.load_config()
        self.personality = settings.load_personality()
        # max_retries=0: JARVIS does its own single retry (see _call).
        self.client = anthropic.Anthropic(api_key=settings.load_api_key(), max_retries=0)
        self.memory = Memory(db_path or settings.DB_PATH)
        # profile "before" switches the speed improvements off, for benchmark.py only.
        self.fast = profile != "before"
        if not self.fast:
            self.cfg["brains"]["main"]["effort"] = "medium"
        self.tools = ToolBox(self.memory, settings.WORKSPACE, self.cfg["apps"])
        self.log = UsageLog(settings.LOGS)
        self.emit = emit
        self.jobs = 0
        self.researcher = Researcher(self)
        self.pending: dict | None = None   # a yes/no question a research job is waiting on
        self.jobs_lock = threading.Lock()
        self.summary_lock = threading.Lock()
        self.cancel_event = threading.Event()
        self.computer = Computer(self.cfg, settings.WORKSPACE, settings.LOGS, self.log.error)
        self.confirm: dict | None = None   # a tier 2 action waiting for the user's yes
        self.kill_gen = 0                  # goes up each time the kill switch is used

    def cancel(self) -> None:
        """Stop the chat reply being written right now (background jobs carry on)."""
        self.cancel_event.set()

    # ---- building a request ------------------------------------------------
    # ---- tier 2 confirmation and the kill switch ------------------------------
    def confirm_action(self, text: str) -> bool:
        """Show exactly what is about to happen and wait for the user's yes."""
        box = {"event": threading.Event(), "yes": False}
        self.confirm = box
        self.emit({"type": "confirm", "text": text})
        deadline = time.time() + float(self.computer.cfg.get("confirm_timeout_seconds", 120))
        timed_out = False
        while not box["event"].wait(0.2):
            if self.computer.stop.is_set():
                break
            if time.time() > deadline:
                timed_out = True
                break
        self.confirm = None
        self.emit({"type": "confirm_closed", "yes": box["yes"], "timed_out": timed_out})
        return box["yes"]

    def answer_confirm(self, text_or_yes) -> bool:
        """Only a clear yes counts as yes. Returns what was understood."""
        yes = text_or_yes if isinstance(text_or_yes, bool) else is_yes(text_or_yes)
        if self.confirm:
            self.confirm["yes"] = yes
            self.confirm["event"].set()
        return yes

    def kill(self) -> None:
        """The kill switch: stop every action and background job right now."""
        self.kill_gen += 1
        self.cancel_event.set()
        self.computer.kill()
        if self.confirm:
            self.confirm["event"].set()
        for job in self.researcher.jobs.values():
            if job.state == "waiting":
                self.researcher.decide(job, "cancel")
        self.pending = None
        self.computer.log.write("-", "KILL SWITCH", "all actions and background jobs stopped",
                                "pressed by the user")
        self.emit({"type": "killed"})

    def _controlled(self, call, usage: Usage):
        """Run a computer-control action under its safety tier."""
        name = call.name
        args = call.input if isinstance(call.input, dict) else {}
        c = self.computer
        tier = c.tier(name)
        brief = json.dumps(args, ensure_ascii=False)[:300]
        if tier == 3 or not c.enabled:
            c.log.write(3, name, brief, "refused (never tier)")
            return ("This action is in the 'never' tier, so JARVIS will not do it. "
                    "Tell the user plainly."), True
        desc = brief
        try:
            if name == "control_screen":
                from .screen import run_task
                task = str(args.get("task", "")).strip()
                if not task:
                    raise ToolError("A task is needed.")
                each = str((c.cfg.get("screen_control") or {}).get("ask", "every_action")) != "once"
                desc = ("Take control of the mouse and keyboard to do this:\n  " + task + "\n"
                        + ("I will ask again before every click and every keystroke."
                           if each else "After this yes I will not ask again until it is done.")
                        + " The kill switch stops me at once.")
                do = lambda: run_task(self, task, usage)
            elif hasattr(c, "plan_" + name):
                desc, do = getattr(c, "plan_" + name)(args)
            else:
                handler = getattr(c, name, None) or (lambda a: self.tools.run(name, a))
                if tier == 2:
                    desc = f"{name.replace('_', ' ')}: {brief}"
                do = lambda: handler(args)
            decision = "automatic"
            if tier == 2:
                if not self.confirm_action(desc):
                    c.log.write(2, name, desc, "declined by the user")
                    return ("The user did not say yes, so this was NOT done. Do not try "
                            "again or find another way. Tell them it was not done."), True
                decision = "approved by the user"
            out = ("(test mode) Approved, but nothing was really done."
                   if c.dry_run and tier == 2 else do())
            c.log.write(tier, name, desc, decision, "ok")
            return out, False
        except Tier3 as e:
            c.log.write(3, name, desc, "refused (never tier)", str(e))
            return str(e) + " This is in the 'never' tier. Tell the user plainly.", True
        except ToolError as e:
            c.log.write(tier, name, desc, "not done", str(e))
            return str(e), True
        except Exception as e:
            c.log.write(tier, name, desc, "failed", f"{type(e).__name__}: {e}")
            return f"It failed: {type(e).__name__}: {e}", True

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
        if self.computer.enabled and (brain == "main" or (brain == "reflex" and self.fast)):
            parts.append("Allowed folders for file actions: " + self.computer.folders_text()
                         + ". A path with no folder means the workspace.")
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
            {"type": "text", "text": self._stable_system(brain),
             "cache_control": {"type": "ephemeral"}},
            # Changing part after the cache marker so it never spoils the cache.
            {"type": "text", "text": "\n\n".join(parts)},
        ]

    def _stable_system(self, brain: str) -> str:
        role = ROLE_BEFORE[brain] if (not self.fast and brain in ROLE_BEFORE) else ROLE[brain]
        return self.personality + "\n\n" + role

    def _reflex_tools(self) -> list:
        return REFLEX_TOOLS if self.fast else REFLEX_TOOLS_BEFORE

    def prewarm(self) -> None:
        """At start-up: open the connection to Anthropic and store the fixed part of
        the reflex and main prompts in the cache, so the first request is not slower
        than the rest. Costs a fraction of a cent. Failure here is harmless."""
        if not (self.fast and (self.cfg.get("performance") or {}).get("prewarm", True)):
            return
        hidden = self.computer.hidden_tools()
        for brain, tools in (("reflex", self._reflex_tools()), ("main", MAIN_TOOLS)):
            b = self.cfg["brains"][brain]
            kwargs = dict(
                model=b["model"], max_tokens=0,
                system=[{"type": "text", "text": self._stable_system(brain),
                         "cache_control": {"type": "ephemeral"}}],
                tools=[t for t in tools if t.get("name") not in hidden],
                messages=[{"role": "user", "content": "Hello"}])
            if b.get("effort"):
                kwargs["output_config"] = {"effort": b["effort"]}
            try:
                self.client.messages.create(**kwargs)
            except Exception as e:
                self.log.error("prewarm", f"{brain}: {type(e).__name__}: {str(e)[:200]}")
                return

    def _run_tool(self, call, user_text: str, usage: Usage):
        """Carry out one tool call. Returns (result, is_error)."""
        try:
            if call.name == "start_research_job":
                task = call.input.get("task") if isinstance(call.input, dict) else ""
                job = self.start_research(task or user_text)
                return (f"Research job #{job} started in the background. Reply "
                        "\"On it.\" The user is told when the report is ready."), False
            if call.name == "research_decision":
                d = call.input.get("decision") if isinstance(call.input, dict) else ""
                return self.apply_decision(str(d)), False
            if call.name == "start_deep_job":
                task = call.input.get("task") if isinstance(call.input, dict) else ""
                job = self.start_deep_job(task or user_text)
                return (f"Background job #{job} started. Tell the user it is "
                        "running and they will be told when it is done."), False
            if self.computer.tier(call.name) is not None:
                return self._controlled(call, usage)
            return self.tools.run(call.name, call.input), False
        except ToolError as e:
            return str(e), True
        except Exception as e:  # a bug in a tool must not crash the chat
            self.log.error("tool", f"{call.name}: {type(e).__name__}: {e}")
            return f"The tool failed unexpectedly: {type(e).__name__}", True

    def _call(self, brain: str, system, messages, tools, usage: Usage,
              on_text: Callable[[str], None] | None = None,
              on_reset: Callable[[], None] | None = None, extra: dict | None = None,
              kill_gen: int | None = None):
        """One streamed API call, retried once if the failure looks temporary."""
        b = self.cfg["brains"][brain]
        kwargs = dict(model=b["model"], max_tokens=int(b.get("max_tokens", 16000)),
                      system=system, messages=messages)
        if b.get("effort"):
            kwargs["output_config"] = {"effort": b["effort"]}
        if tools:
            hidden = self.computer.hidden_tools()
            kwargs["tools"] = [t for t in tools if t.get("name") not in hidden]
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
                        if kill_gen is not None and kill_gen != self.kill_gen:
                            raise Failure("Stopped by the kill switch.")
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
        # In a tool loop the main brain re-reads the whole conversation each round;
        # caching it makes the later rounds faster and cheaper.
        extra = {"cache_control": {"type": "ephemeral"}} if (self.fast and brain == "main") else None

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
                final = self._call(brain, system, messages, tools, usage, on_text, on_reset,
                                   extra=extra)
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
            # When the brain asks for several things at once they all come back in this
            # one round. They are run one after another on purpose: JARVIS's own tools
            # finish in milliseconds, and running them on separate threads measured
            # slower (see HOW_TO_USE.md), while keeping order keeps ask-first actions safe.
            outs = [self._run_tool(c, user_text, usage) for c in calls]
            for call, (out, err) in zip(calls, outs):
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
        self.computer.stop.clear()
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
                tools = self._reflex_tools() + ([RESEARCH_DECISION] if self.pending else [])
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
            final = self._call("deep", self._system("deep"), messages, None, usage,
                               kill_gen=self.kill_gen)
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
