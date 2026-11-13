"""Token counting, cost estimates and the log files in the logs folder."""
import csv
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

COLUMNS = ["time", "brain", "model", "response_ms", "input_tokens", "output_tokens",
           "cache_read_tokens", "cache_write_tokens", "est_cost_usd", "ok", "request"]


@dataclass
class Usage:
    """Running total for one user request (which can be several API calls)."""
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost: float = 0.0

    def add(self, usage, model: str, prices: dict) -> None:
        inp = getattr(usage, "input_tokens", 0) or 0
        out = getattr(usage, "output_tokens", 0) or 0
        read = getattr(usage, "cache_read_input_tokens", 0) or 0
        write = getattr(usage, "cache_creation_input_tokens", 0) or 0
        self.input += inp
        self.output += out
        self.cache_read += read
        self.cache_write += write
        p = prices.get(model)
        if not p:
            return  # unknown model: tokens are still logged, cost is left out
        in_price, out_price = p.get("input", 0), p.get("output", 0)
        scale = 1.0
        limit = p.get("long_prompt_over")
        if limit and (inp + read + write) > limit:
            scale = p.get("long_input", in_price) / in_price if in_price else 1.0
            in_price, out_price = p.get("long_input", in_price), p.get("long_output", out_price)
        self.cost += (
            inp * in_price
            + out * out_price
            + read * p.get("cache_read", in_price * 0.1) * scale
            + write * p.get("cache_write", in_price * 1.25) * scale
        ) / 1_000_000


class UsageLog:
    def __init__(self, logs_dir: Path):
        self.dir = logs_dir
        self.lock = threading.Lock()

    def _day_file(self, day: str) -> Path:
        return self.dir / f"requests-{day}.csv"

    def record(self, brain: str, model: str, ms: int, usage: Usage, ok: bool,
               request: str) -> float:
        """Add one line to today's log and refresh the daily totals. Returns today's cost."""
        now = datetime.now()
        day = now.strftime("%Y-%m-%d")
        row = [now.strftime("%H:%M:%S"), brain, model, ms, usage.input, usage.output,
               usage.cache_read, usage.cache_write, f"{usage.cost:.6f}",
               "yes" if ok else "no", " ".join(request.split())[:80]]
        with self.lock:
            path = self._day_file(day)
            new = not path.exists()
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if new:
                    w.writerow(COLUMNS)
                w.writerow(row)
            return self._refresh_totals(day)

    def _day_total(self, path: Path) -> dict:
        t = {"requests": 0, "input_tokens": 0, "output_tokens": 0, "est_cost_usd": 0.0}
        with path.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    t["requests"] += 1
                    t["input_tokens"] += (int(r["input_tokens"]) + int(r["cache_read_tokens"])
                                          + int(r["cache_write_tokens"]))
                    t["output_tokens"] += int(r["output_tokens"])
                    t["est_cost_usd"] += float(r["est_cost_usd"])
                except (KeyError, ValueError):
                    continue
        return t

    def _refresh_totals(self, today: str) -> float:
        today_cost = 0.0
        rows = []
        for path in sorted(self.dir.glob("requests-*.csv")):
            day = path.stem.replace("requests-", "")
            t = self._day_total(path)
            if day == today:
                today_cost = t["est_cost_usd"]
            rows.append([day, t["requests"], t["input_tokens"], t["output_tokens"],
                         f"{t['est_cost_usd']:.4f}"])
        with (self.dir / "daily_totals.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["date", "requests", "input_tokens", "output_tokens", "est_cost_usd"])
            w.writerows(rows)
        return today_cost

    def error(self, where: str, detail: str) -> None:
        """Technical detail for troubleshooting. Never contains the API key."""
        with self.lock, (self.dir / "errors.log").open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} [{where}] {detail}\n")
