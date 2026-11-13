"""Local SQLite memory: remembered facts, conversation history, rolling summary."""
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

# Old messages are shortened to this many characters when sent back to a brain,
# so one long report cannot make every later request large.
HISTORY_MESSAGE_CAP = 3000


class Memory:
    def __init__(self, db_path: Path):
        self.db_path = str(db_path)
        self.lock = threading.Lock()
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS facts(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    fact TEXT NOT NULL,
                    created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS messages(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created TEXT NOT NULL,
                    summarised INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS summary(
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    text TEXT NOT NULL);
                """
            )

    def _conn(self):
        return sqlite3.connect(self.db_path, timeout=10)

    @staticmethod
    def _now() -> str:
        return datetime.now().isoformat(timespec="seconds")

    # ---- facts -----------------------------------------------------------
    def add_fact(self, fact: str) -> int:
        with self.lock, self._conn() as c:
            cur = c.execute(
                "INSERT INTO facts(fact, created) VALUES(?, ?)", (fact.strip(), self._now())
            )
            return cur.lastrowid

    def all_facts(self, limit: int | None = None) -> list[tuple[int, str, str]]:
        sql = "SELECT id, fact, created FROM facts ORDER BY id DESC"
        if limit:
            sql += f" LIMIT {int(limit)}"
        with self.lock, self._conn() as c:
            return list(reversed(c.execute(sql).fetchall()))

    def search_facts(self, query: str) -> list[tuple[int, str, str]]:
        words = [w.lower() for w in query.split() if len(w) > 2]
        facts = self.all_facts()
        if not words:
            return facts
        return [f for f in facts if any(w in f[1].lower() for w in words)]

    def delete_fact(self, fact_id: int) -> bool:
        with self.lock, self._conn() as c:
            return c.execute("DELETE FROM facts WHERE id = ?", (fact_id,)).rowcount > 0

    # ---- conversation ----------------------------------------------------
    def add_message(self, role: str, content: str) -> None:
        with self.lock, self._conn() as c:
            c.execute(
                "INSERT INTO messages(role, content, created) VALUES(?, ?, ?)",
                (role, content, self._now()),
            )

    def unsummarised(self) -> list[tuple[int, str, str]]:
        with self.lock, self._conn() as c:
            return c.execute(
                "SELECT id, role, content FROM messages WHERE summarised = 0 ORDER BY id"
            ).fetchall()

    def recent_for_prompt(self) -> list[dict]:
        """History not yet folded into the summary, as API messages (oldest first)."""
        rows = self.unsummarised()
        while rows and rows[0][1] != "user":  # the API needs a user message first
            rows = rows[1:]
        out = []
        for _id, role, content in rows:
            if len(content) > HISTORY_MESSAGE_CAP:
                content = (
                    content[:HISTORY_MESSAGE_CAP]
                    + "\n[...this earlier message was shortened to save space...]"
                )
            out.append({"role": role, "content": content})
        return out

    def get_summary(self) -> str:
        with self.lock, self._conn() as c:
            row = c.execute("SELECT text FROM summary WHERE id = 1").fetchone()
            return row[0] if row else ""

    def save_summary(self, text: str, up_to_id: int) -> None:
        with self.lock, self._conn() as c:
            c.execute(
                "INSERT INTO summary(id, text) VALUES(1, ?) "
                "ON CONFLICT(id) DO UPDATE SET text = excluded.text",
                (text,),
            )
            c.execute("UPDATE messages SET summarised = 1 WHERE id <= ?", (up_to_id,))
