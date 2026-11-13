"""The tools JARVIS's brains can use, and the code that carries them out."""
import os
import re
import webbrowser
from datetime import datetime
from pathlib import Path

from .memory import Memory

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log"}
MAX_READ_BYTES = 200_000

_STR = {"type": "string"}


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


DATETIME = _tool(
    "get_current_datetime",
    "Get the current local date, time and weekday on the user's PC.",
    {}, [],
)
OPEN = _tool(
    "open_app_or_website",
    "Open an app on the user's PC or a website in their browser. For a website "
    "give the address (for example https://www.youtube.com). For an app give "
    "its name (for example notepad). Only apps on the user's allowed list can be "
    "opened; if the name is not on the list the result tells you which names are.",
    {"target": _STR}, ["target"],
)
CREATE_FILE = _tool(
    "create_text_file",
    "Create a text file inside the JARVIS workspace folder. filename is a name "
    "or sub-path inside the workspace ending in .txt, .md, .csv, .json or .log. "
    "If the file already exists this fails unless overwrite is true - ask the "
    "user before overwriting.",
    {"filename": _STR, "content": _STR, "overwrite": {"type": "boolean"}},
    ["filename", "content"],
)
READ_FILE = _tool(
    "read_text_file",
    "Read a text file from inside the JARVIS workspace folder.",
    {"filename": _STR}, ["filename"],
)
LIST_FILES = _tool(
    "list_workspace_files",
    "List the files currently in the JARVIS workspace folder.",
    {}, [],
)
REMEMBER = _tool(
    "remember_fact",
    "Save a fact to long-term memory when the user asks you to remember "
    "something. Write the fact as one complete, self-contained sentence.",
    {"fact": _STR}, ["fact"],
)
RECALL = _tool(
    "recall_facts",
    "Look up remembered facts. Give a few keywords in query, or leave query "
    "empty to get every remembered fact. Each fact comes back with its id.",
    {"query": _STR}, [],
)
FORGET = _tool(
    "forget_fact",
    "Delete one remembered fact by its id (get ids from recall_facts). Only "
    "use this when the user asks you to forget or correct something.",
    {"fact_id": {"type": "integer"}}, ["fact_id"],
)
HAND_OFF = _tool(
    "hand_off",
    "Pass the user's request to a bigger brain. target 'main' is for everyday "
    "tasks; target 'deep' is for research, planning, reports and hard problems "
    "and runs as a background job.",
    {"target": {"type": "string", "enum": ["main", "deep"]}}, ["target"],
)
START_DEEP = _tool(
    "start_deep_job",
    "Start a background job on the deep brain for research, planning, a report "
    "or a hard problem. Write task as a complete brief: the job only sees the "
    "brief plus the recent conversation. The user is told when it finishes.",
    {"task": _STR}, ["task"],
)

REFLEX_TOOLS = [DATETIME, OPEN, REMEMBER, RECALL, HAND_OFF]
MAIN_TOOLS = [DATETIME, OPEN, CREATE_FILE, READ_FILE, LIST_FILES, REMEMBER, RECALL,
              FORGET, START_DEEP]


class ToolError(Exception):
    """A tool could not do what was asked. The message goes back to the brain."""


class ToolBox:
    def __init__(self, memory: Memory, workspace: Path, apps: dict):
        self.memory = memory
        self.workspace = workspace.resolve()
        self.apps = {str(k).lower().strip(): str(v) for k, v in (apps or {}).items()}
        # Set JARVIS_DRY_RUN=1 to test without really opening anything.
        self.dry_run = os.environ.get("JARVIS_DRY_RUN") == "1"

    def run(self, name: str, args) -> str:
        if not isinstance(args, dict):
            raise ToolError("The tool input was not understood.")
        handler = getattr(self, "_" + name, None)
        if handler is None:
            raise ToolError(f"There is no tool called {name}.")
        return handler(args)

    @staticmethod
    def _text(args: dict, key: str, required: bool = True) -> str:
        value = args.get(key, "")
        if not isinstance(value, str) or (required and not value.strip()):
            raise ToolError(f"'{key}' must be a piece of text and cannot be empty.")
        return value

    # ---- date and time ---------------------------------------------------
    def _get_current_datetime(self, args: dict) -> str:
        now = datetime.now().astimezone()
        return now.strftime("%A, %d %B %Y, %H:%M:%S (time zone %Z, UTC%z)")

    # ---- open app or website ---------------------------------------------
    def _open_app_or_website(self, args: dict) -> str:
        target = self._text(args, "target").strip()
        low = target.lower()
        if low in self.apps:
            command = self.apps[low]
            if self.dry_run:
                return f"(test mode) Would open the app '{low}'."
            if not hasattr(os, "startfile"):
                raise ToolError("Opening apps only works on Windows.")
            try:
                os.startfile(command)  # same as typing it into the Win+R Run box
            except OSError as e:
                raise ToolError(f"Windows could not open '{low}': {e}")
            return f"Opened {low}."
        url = target
        if not re.match(r"^https?://", url, re.I):
            if re.match(r"^[\w-]+(\.[\w-]+)+(/\S*)?$", url):
                url = "https://" + url
            else:
                names = ", ".join(sorted(self.apps)) or "(none)"
                raise ToolError(
                    f"'{target}' is not on the allowed apps list and is not a web "
                    f"address. Allowed apps: {names}. The user can add more in config.yaml."
                )
        if self.dry_run:
            return f"(test mode) Would open {url} in the browser."
        if not webbrowser.open(url):
            raise ToolError("No web browser could be opened.")
        return f"Opened {url} in the browser."

    # ---- files (workspace only) ------------------------------------------
    def _safe_path(self, filename: str) -> Path:
        if not filename.strip():
            raise ToolError("A file name is needed.")
        candidate = Path(filename)
        if candidate.is_absolute() or candidate.drive:
            raise ToolError("Use a file name inside the workspace, not a full path.")
        target = (self.workspace / candidate).resolve()
        if target != self.workspace and self.workspace not in target.parents:
            raise ToolError("That path is outside the workspace folder, which is not allowed.")
        if target.suffix.lower() not in TEXT_EXTENSIONS:
            allowed = ", ".join(sorted(TEXT_EXTENSIONS))
            raise ToolError(f"Only text files are allowed ({allowed}).")
        return target

    def _create_text_file(self, args: dict) -> str:
        target = self._safe_path(self._text(args, "filename"))
        content = self._text(args, "content", required=False)
        if target.exists() and args.get("overwrite") is not True:
            raise ToolError(
                f"{target.name} already exists. Ask the user whether to overwrite it."
            )
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        except OSError as e:
            raise ToolError(f"The file could not be saved: {e}")
        return f"Saved {target.relative_to(self.workspace)} ({len(content)} characters)."

    def _read_text_file(self, args: dict) -> str:
        target = self._safe_path(self._text(args, "filename"))
        if not target.is_file():
            raise ToolError(f"There is no file called {args['filename']} in the workspace.")
        if target.stat().st_size > MAX_READ_BYTES:
            raise ToolError(
                f"That file is too large to read in one go "
                f"({target.stat().st_size:,} bytes; the limit is {MAX_READ_BYTES:,})."
            )
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ToolError("That file is not plain text, so it cannot be read.")
        except OSError as e:
            raise ToolError(f"The file could not be read: {e}")

    def _list_workspace_files(self, args: dict) -> str:
        files = sorted(
            str(p.relative_to(self.workspace)).replace("\\", "/")
            for p in self.workspace.rglob("*") if p.is_file()
        )
        return "\n".join(files) if files else "The workspace is empty."

    # ---- memory ----------------------------------------------------------
    def _remember_fact(self, args: dict) -> str:
        fact_id = self.memory.add_fact(self._text(args, "fact"))
        return f"Remembered (fact id {fact_id})."

    def _recall_facts(self, args: dict) -> str:
        query = self._text(args, "query", required=False)
        facts = self.memory.search_facts(query)
        if not facts:
            return "No remembered facts match." if query.strip() else "Nothing is remembered yet."
        return "\n".join(f"[{i}] {fact} (saved {created[:10]})" for i, fact, created in facts)

    def _forget_fact(self, args: dict) -> str:
        fact_id = args.get("fact_id")
        if not isinstance(fact_id, int) or isinstance(fact_id, bool):
            raise ToolError("'fact_id' must be a whole number.")
        if not self.memory.delete_fact(fact_id):
            raise ToolError(f"There is no fact with id {fact_id}.")
        return f"Forgot fact {fact_id}."
