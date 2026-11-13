"""The tools JARVIS's brains can use, and the code that carries them out."""
import os
import re
import webbrowser
from datetime import datetime
from pathlib import Path

from .memory import Memory


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
    "Create a new text file (.txt .md .csv .json .log .html) inside one of the "
    "allowed folders. Never overwrites. The user is shown the exact file and "
    "contents and must say yes before it is created.",
    {"path": _STR, "content": _STR}, ["path", "content"],
)
READ_FILE = _tool(
    "read_text_file",
    "Read a text file inside one of the allowed folders.",
    {"path": _STR}, ["path"],
)
LIST_FOLDER = _tool(
    "list_folder",
    "List what is in an allowed folder. Leave folder empty for the workspace.",
    {"folder": _STR}, [],
)
SEARCH_FILES = _tool(
    "search_files",
    "Find files and folders by name inside the allowed folders. query is one or "
    "more words that must all appear in the name. folder is optional.",
    {"query": _STR, "folder": _STR}, ["query"],
)
SET_VOLUME = _tool(
    "set_volume",
    "Change the PC's sound volume. change is set (with level 0-100), up, down or "
    "mute_toggle.",
    {"change": {"type": "string", "enum": ["set", "up", "down", "mute_toggle"]},
     "level": {"type": "integer"}}, ["change"],
)
SCREENSHOT = _tool(
    "take_screenshot",
    "Look at the user's screen right now. The picture is for you only and is "
    "not saved. Use it when you need to see what is on screen.",
    {}, [],
)
MOVE = _tool(
    "move_or_rename",
    "Move or rename a file or folder inside the allowed folders. Never "
    "overwrites. The user must say yes first.",
    {"source": _STR, "destination": _STR}, ["source", "destination"],
)
RECYCLE = _tool(
    "move_to_recycle_bin",
    "Move a file or folder to the Recycle Bin. This is the ONLY way to delete "
    "anything, and the user must say yes first. Nothing is ever deleted for good.",
    {"path": _STR}, ["path"],
)
POWERSHELL = _tool(
    "run_powershell",
    "Run one PowerShell command on the user's PC. The user is shown the exact "
    "command and must say yes first. Commands that delete, install software, "
    "download code, send email or change passwords, accounts or security "
    "settings are refused.",
    {"command": _STR}, ["command"],
)
TYPE_TEXT = _tool(
    "type_text",
    "Type text into another app's window, as if on the keyboard. window_title is "
    "part of that window's title. Enter is never pressed, so nothing is sent or "
    "submitted. The user must say yes first.",
    {"text": _STR, "window_title": _STR}, ["text", "window_title"],
)
FILL_FORM = _tool(
    "fill_form",
    "Fill in a form in another app: types each value in order, pressing Tab "
    "between them, starting from the box the cursor is in. Never presses Enter "
    "or clicks submit. The user must say yes first.",
    {"values": {"type": "array", "items": _STR}, "window_title": _STR},
    ["values", "window_title"],
)
CONTROL_SCREEN = _tool(
    "control_screen",
    "Operate an app through the screen with the mouse and keyboard, for things "
    "no other tool can do. task is a complete description of what to do. The "
    "user approves the task, and each click and keystroke, before it happens. "
    "Slow: prefer any other tool when one fits.",
    {"task": _STR}, ["task"],
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
    "Pass the user's request on. target 'main' is for everyday tasks; target "
    "'research' starts a background web research job (anything that needs "
    "current or looked-up information from the internet); target 'deep' starts a "
    "background job for planning, long writing and hard problems that need "
    "careful thought but not the web.",
    {"target": {"type": "string", "enum": ["main", "research", "deep"]}}, ["target"],
)
START_DEEP = _tool(
    "start_deep_job",
    "Start a background job on the deep brain for research, planning, a report "
    "or a hard problem. Write task as a complete brief: the job only sees the "
    "brief plus the recent conversation. The user is told when it finishes.",
    {"task": _STR}, ["task"],
)

START_RESEARCH = _tool(
    "start_research_job",
    "Start a background web research job: it searches the web, opens and "
    "cross-checks pages, and saves a Word report. Use it for anything that needs "
    "current or looked-up information. Write task as a complete brief. Reply to "
    "the user with a short 'On it' - they are told when the report is ready.",
    {"task": _STR}, ["task"],
)
RESEARCH_DECISION = _tool(
    "research_decision",
    "Pass on the user's answer to a question a research job is waiting on. "
    "continue = keep researching past the limit; finish = write the report now "
    "with what it has; cancel = abandon the job; open_report = open the finished "
    "Word report; leave = do not open it. Only call this when the user has "
    "clearly answered that question.",
    {"decision": {"type": "string",
                  "enum": ["continue", "finish", "cancel", "open_report", "leave"]}},
    ["decision"],
)

REFLEX_TOOLS_BEFORE = [DATETIME, OPEN, SET_VOLUME, REMEMBER, RECALL, HAND_OFF]
# The reflex can also do the read-only (tier 1) file lookups itself.
REFLEX_TOOLS = [DATETIME, OPEN, SET_VOLUME, SEARCH_FILES, LIST_FOLDER, READ_FILE, REMEMBER,
                RECALL, FORGET, HAND_OFF]
MAIN_TOOLS = [DATETIME, OPEN, SEARCH_FILES, LIST_FOLDER, READ_FILE, SET_VOLUME, SCREENSHOT,
              CREATE_FILE, MOVE, RECYCLE, POWERSHELL, TYPE_TEXT, FILL_FORM, CONTROL_SCREEN,
              REMEMBER, RECALL, FORGET, START_DEEP, START_RESEARCH]


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
