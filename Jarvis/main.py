"""Starts JARVIS. Normally launched by double-clicking start_jarvis.bat."""
import traceback
from datetime import datetime
from pathlib import Path

if __name__ == "__main__":
    try:
        from jarvis.app import run
        run()
    except Exception:
        # With no console window there is nowhere to show a crash, so save it.
        logs = Path(__file__).resolve().parent / "logs"
        logs.mkdir(exist_ok=True)
        with (logs / "crash.log").open("a", encoding="utf-8") as f:
            f.write(f"\n--- {datetime.now().isoformat(timespec='seconds')} ---\n")
            f.write(traceback.format_exc())
        raise
