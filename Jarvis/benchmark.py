"""JARVIS speed and cost benchmark: before and after the speed improvements.

Run from the Jarvis folder:   .venv\\Scripts\\python.exe benchmark.py

It sends 10 quick and 10 normal requests by text and by voice, first with the
speed improvements switched off ("before") and then switched on ("after"),
and prints a before-and-after table. Options:
    --silent      do not play JARVIS's spoken replies out loud
    --text-only   skip the voice part
It makes about 80 real API calls. It uses a separate temporary memory, so your
own conversation and remembered facts are not touched. Nothing is opened or
changed on your PC (test mode). The cost is added to today's log."""
import csv
import os
import queue
import statistics
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

os.environ.setdefault("JARVIS_DRY_RUN", "1")

from jarvis import settings  # noqa: E402
from jarvis.engine import Engine  # noqa: E402

QUICK = ["What time is it?", "Hello, how are you today?", "What is today's date?",
         "What is the capital of France?", "Thank you, that is all for now.",
         "How many days are in a leap year?", "What is twelve times twelve?",
         "Good morning.", "What day of the week is it?",
         "How many minutes are in two hours?"]
NORMAL = ["Explain in a few sentences how a home wifi router works.",
          "Give me three tips for sleeping better.",
          "What is the difference between a virus and a bacterium?",
          "Suggest a simple dinner I can make with chicken and rice.",
          "Explain why the sky is blue.",
          "Write a two sentence thank you note for a birthday present.",
          "What files are in my workspace folder?",
          "How do I take a screenshot on Windows?",
          "What should I pack for a weekend hiking trip?",
          "Give me five quick tips for learning to touch type."]
REQUESTS = [("quick", q) for q in QUICK] + [("normal", n) for n in NORMAL]


def today_cost() -> float:
    try:
        with (settings.LOGS / "daily_totals.csv").open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["date"] == datetime.now().strftime("%Y-%m-%d"):
                    return float(row["est_cost_usd"])
    except (OSError, KeyError, ValueError):
        pass
    return 0.0


def text_run(engine: Engine, events: queue.Queue) -> list[dict]:
    rows = []
    for kind, text in REQUESTS:
        start = time.perf_counter()
        first = None
        threading.Thread(target=engine.handle, args=(text,), daemon=True).start()
        while True:
            ev = events.get(timeout=300)
            if ev["type"] == "delta" and first is None and ev["text"].strip():
                first = time.perf_counter()
            elif ev["type"] == "confirm":
                engine.answer_confirm(False)
            elif ev["type"] == "done":
                rows.append({"kind": kind, "said": text, "brain": ev["brain"], "ok": ev["ok"],
                             "first": int(((first or time.perf_counter()) - start) * 1000),
                             "total": ev["ms"], "cost": ev["cost"]})
                break
        print(f"    {kind:6} {text[:46]:<48} first words {rows[-1]['first']:>6,} ms   "
              f"{rows[-1]['brain']}", flush=True)
        time.sleep(0.5)
    return rows


def measure(profile: str, with_voice: bool, silent: bool) -> dict:
    print(f"\n=== {profile.upper()} ===", flush=True)
    events: queue.Queue = queue.Queue()
    db = Path(tempfile.mkdtemp(prefix="jarvis-bench-")) / "memory.db"
    engine = Engine(events.put, profile=profile, db_path=db)
    if profile == "before":
        engine.cfg.setdefault("voice", {})["speech_to_text_device"] = "cpu"
    else:
        engine.prewarm()
    print("  by text:", flush=True)
    out = {"text": text_run(engine, events), "voice": []}
    if with_voice:
        import speed_check
        print("  by voice:", flush=True)
        out["voice"] = speed_check.run(silent, engine=engine, requests=REQUESTS)
    engine.kill()           # stop any background job a test request may have started
    return out


def med(values: list) -> int | None:
    values = [v for v in values if v is not None]
    return int(statistics.median(values)) if values else None


def change(before, after) -> str:
    if not before or after is None:
        return "-"
    pct = (after - before) / before * 100
    return f"{pct:+.0f}%"


def report(before: dict, after: dict, cost_start: float) -> str:
    lines = ["", "JARVIS speed and cost: before and after", "=" * 86,
             f"{'':<40}{'Before':>12}{'After':>12}{'Change':>10}", "-" * 86]

    def row(label, b, a, unit=" ms", fmt="{:,}"):
        bs = (fmt.format(b) + unit) if b is not None else "n/a"
        as_ = (fmt.format(a) + unit) if a is not None else "n/a"
        lines.append(f"{label:<40}{bs:>12}{as_:>12}{change(b, a):>10}")

    for kind in ("quick", "normal"):
        pick = lambda d, mode, key: [r.get(key) for r in d[mode] if r["kind"] == kind]
        row(f"Text, {kind}: time to first words", med(pick(before, "text", "first")),
            med(pick(after, "text", "first")))
        row(f"Text, {kind}: time to full reply", med(pick(before, "text", "total")),
            med(pick(after, "text", "total")))
        if before["voice"] or after["voice"]:
            row(f"Voice, {kind}: stop talking to first word",
                med(pick(before, "voice", "total")), med(pick(after, "voice", "total")))
        reflex = lambda d: sum(1 for r in d["text"] if r["kind"] == kind
                               and r["brain"].startswith("reflex"))
        row(f"Text, {kind}: answered by the reflex", reflex(before), reflex(after),
            unit=" of 10")
        lines.append("")
    cost = lambda d: sum(r.get("cost", 0) for mode in ("text", "voice") for r in d[mode])
    n = lambda d: len(d["text"]) + len(d["voice"])
    cb, ca = cost(before), cost(after)
    lines.append(f"{'Cost of all test requests':<40}{'$%.4f' % cb:>12}{'$%.4f' % ca:>12}"
                 f"{change(cb, ca):>10}")
    if n(before) and n(after):
        lines.append(f"{'Average cost per request':<40}{'$%.5f' % (cb / n(before)):>12}"
                     f"{'$%.5f' % (ca / n(after)):>12}{change(cb / n(before), ca / n(after)):>10}")
    lines += ["-" * 86,
              "Times are the middle value of each group of 10. Costs are estimates from the "
              "prices in config.yaml.",
              f"Today's cost before this benchmark: ${cost_start:.4f}.   "
              f"Today's cost now: ${today_cost():.4f}.",
              "Not included in the table: the start-up warm-up, and background summaries of "
              "old conversation."]
    failed = [r["said"] for d in (before, after) for mode in ("text", "voice") for r in d[mode]
              if r.get("ok") is False or r.get("brain") == "FAILED" or
              (mode == "voice" and r.get("total") is None)]
    if failed:
        lines.append(f"{len(failed)} request(s) failed or gave no result and are left out of "
                     "the middle values.")
    return "\n".join(lines)


if __name__ == "__main__":
    with_voice = "--text-only" not in sys.argv
    if with_voice:
        try:
            from jarvis import voice as voice_mod
            if not voice_mod.models_ready():
                raise RuntimeError
        except Exception:
            print("Voice is not set up, so only the text part will be measured.")
            with_voice = False
    silent = "--silent" in sys.argv
    start_cost = today_cost()
    before = measure("before", with_voice, silent)
    after = measure("after", with_voice, silent)
    text = report(before, after, start_cost)
    print(text)
    settings.ensure_folders()
    path = settings.LOGS / f"benchmark-{datetime.now().strftime('%Y-%m-%d_%H%M')}.txt"
    path.write_text(text + "\n", encoding="utf-8")
    print(f"\nSaved as {path}")
