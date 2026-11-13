"""Sends five test requests through JARVIS (no window) and prints a results table.
Run from the Jarvis folder:  .venv\\Scripts\\python.exe test_five.py
It sets test mode so no apps or websites are really opened. It uses real API calls."""
import os
import queue
import sys
import threading

os.environ.setdefault("JARVIS_DRY_RUN", "1")

from jarvis.engine import Engine  # noqa: E402

REQUESTS = [
    ("reflex", "Hello JARVIS, good morning!"),
    ("reflex", "What's the time and date right now?"),
    ("main", "Create a file called shopping.txt in my workspace containing three "
             "lines: milk, bread, eggs. Then read it back to me."),
    ("main", "Explain in about five sentences how a home Wi-Fi router works."),
    ("deep", "Research and write a short report (around 400 words) comparing three "
             "ways I could back up my family photos, with a recommendation."),
]


def main() -> int:
    events: queue.Queue = queue.Queue()
    engine = Engine(events.put)
    rows = []
    jobs_waiting = 0
    early = []
    for expected, text in REQUESTS:
        print(f"\nYOU: {text}\nJARVIS: ", end="", flush=True)
        threading.Thread(target=engine.handle, args=(text,), daemon=True).start()
        while True:
            ev = events.get()
            if ev["type"] == "delta":
                print(ev["text"], end="", flush=True)
            elif ev["type"] == "reset":
                print("\n[restarting reply]\n" + ev.get("text", ""), end="", flush=True)
            elif ev["type"] == "error":
                print("\nSORRY - " + ev["text"], end="")
            elif ev["type"] == "done":
                rows.append((text, expected, ev["brain"], ev["ms"], ev["cost"], ev["ok"]))
                if "deep job" in ev["brain"]:
                    jobs_waiting += 1
                print()
                break
            elif ev["type"] in ("job_done", "job_failed", "job_logged"):
                early.append(ev)  # a background job finished early; shown below
    print(f"\nWaiting for {jobs_waiting} background job(s) to finish...")
    while jobs_waiting:
        ev = early.pop(0) if early else events.get(timeout=1800)
        if ev["type"] == "job_done":
            print(f"\nJARVIS - background job #{ev['job']} is done "
                  f"(saved as {ev['file']}):\n{ev['text']}")
        elif ev["type"] == "job_failed":
            print(f"\nJARVIS - background job #{ev['job']} failed: {ev['text']}")
        elif ev["type"] == "job_logged":
            rows.append((f"(background job #{ev['job']})", "deep", "deep", ev["ms"],
                         ev["cost"], ev["ok"]))
            jobs_waiting -= 1

    print("\n" + "=" * 100)
    print(f"{'Request':<44} {'Expected':<9} {'Answered by':<30} {'ms':>8} {'Cost $':>8}  OK")
    print("-" * 100)
    for text, expected, brain, ms, cost, ok in rows:
        print(f"{text[:42]:<44} {expected:<9} {brain:<30} {ms:>8,} {cost:>8.4f}  "
              f"{'yes' if ok else 'NO'}")
    print("=" * 100)
    return 0 if all(r[5] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
