"""Computer control with three safety tiers.

Tier 1 actions run straight away. Tier 2 actions are first described exactly,
then run only after the user says yes. Tier 3 actions are never done.
Every action, allowed or refused, is written to logs/actions-DATE.csv."""
import base64
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from . import settings
from .tools import ToolError

# The tier each action has unless config.yaml makes it stricter.
DEFAULT_TIERS = {
    "open_app_or_website": 1, "search_files": 1, "list_folder": 1, "read_text_file": 1,
    "set_volume": 1, "take_screenshot": 1,
    "create_text_file": 2, "move_or_rename": 2, "move_to_recycle_bin": 2,
    "run_powershell": 2, "type_text": 2, "fill_form": 2, "control_screen": 2,
}
READ_TYPES = {".txt", ".md", ".csv", ".json", ".log", ".ini", ".yaml", ".yml", ".xml",
              ".html", ".htm", ".rtf", ".py", ".bat", ".ps1"}
WRITE_TYPES = {".txt", ".md", ".csv", ".json", ".log", ".html"}
MAX_READ_BYTES = 200_000

# PowerShell commands that fall under Tier 3. A deny-list can never be complete,
# which is why every command is also shown to the user before it runs.
_PS_BLOCKED = [
    (r"\b(remove-item|rm|del|erase|rd|rmdir|ri|clear-content|clear-recyclebin|sdelete)\b"
     r"|\.delete\(|\bformat-volume\b|\bformat\s+[a-z]:|\bdiskpart\b|\bcipher\b",
     "it deletes or wipes files (deleting is only done through the Recycle Bin)"),
    (r"\b(winget|choco|scoop|msiexec|install-module|install-package|install-script|"
     r"add-appxpackage|add-windowscapability|dism|pip3?\s+install|npm\s+(i|install)|"
     r"setup\.exe|\S+\.msi)\b",
     "it installs software"),
    (r"\b(invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget|start-bitstransfer|"
     r"invoke-expression|iex|downloadstring|downloadfile)\b|-enc(odedcommand)?\b",
     "it downloads or runs code from elsewhere"),
    (r"\b(net\s+(user|localgroup|accounts)|set-localuser|new-localuser|add-localgroupmember|"
     r"set-mppreference|add-mppreference|netsh|set-netfirewall\w*|new-netfirewall\w*|"
     r"set-executionpolicy|bcdedit|secedit|manage-bde|cmdkey|takeown|icacls|"
     r"schtasks|register-scheduledtask|new-service|set-service|sc(\.exe)?\s+(create|config)|"
     r"reg(\.exe)?\s+(add|delete|import)|set-itemproperty|new-itemproperty|remove-itemproperty)\b"
     r"|\bhk(lm|cu|cr):|-verb\s+runas",
     "it changes passwords, accounts, security or system settings"),
    (r"\b(send-mailmessage|smtpclient|outlook\.application|mailto:)", "it sends email"),
    (r"\.env\b|anthropic_api_key", "it touches JARVIS's secret API key"),
]
_SENSITIVE_WINDOW = re.compile(
    r"password|sign[\s-]?in|log[\s-]?in|checkout|payment|pay now|billing|credit card|"
    r"bank|paypal|security settings", re.I)
_CARD_NUMBER = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


class ActionLog:
    COLUMNS = ["time", "tier", "action", "what", "decision", "result"]

    def __init__(self, logs_dir: Path):
        self.dir = logs_dir
        self.lock = threading.Lock()

    def write(self, tier, action: str, what: str, decision: str, result: str = "") -> None:
        now = datetime.now()
        path = self.dir / f"actions-{now.strftime('%Y-%m-%d')}.csv"
        with self.lock:
            new = not path.exists()
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if new:
                    w.writerow(self.COLUMNS)
                w.writerow([now.strftime("%H:%M:%S"), tier, action,
                            " ".join(str(what).split())[:500], decision,
                            " ".join(str(result).split())[:300]])


def _known_folder(name: str) -> Path:
    """Where Windows really keeps Documents / Downloads (they can be moved)."""
    guids = {"documents": "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}",
             "downloads": "{374DE290-123F-4565-9164-39C4925E467B}"}
    try:
        import ctypes
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD),
                        ("d", ctypes.c_byte * 8)]

        guid = GUID()
        ctypes.windll.ole32.CLSIDFromString(guids[name], ctypes.byref(guid))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None,
                                                      ctypes.byref(out)) == 0 and out.value:
            path = Path(out.value)
            ctypes.windll.ole32.CoTaskMemFree(out)
            return path
    except Exception:
        pass
    return Path.home() / name.capitalize()


def foreground_title() -> str:
    try:
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        buf = ctypes.create_unicode_buffer(512)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, 512)
        return buf.value
    except Exception:
        return ""


def focus_window(title_part: str) -> str:
    """Bring the first visible window whose title contains title_part to the front."""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
    except Exception:
        raise ToolError("Typing into other apps only works on Windows.")
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            if title_part.lower() in buf.value.lower() and "jarvis" != buf.value.lower():
                found.append((hwnd, buf.value))
        return True

    user32.EnumWindows(each, 0)
    if not found:
        raise ToolError(f"No open window has \"{title_part}\" in its title.")
    hwnd, title = found[0]
    user32.ShowWindow(hwnd, 9)          # restore if minimised
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.4)
    if user32.GetForegroundWindow() != hwnd:
        raise ToolError(f"Windows would not bring \"{title}\" to the front.")
    return title


def type_string(text: str, stop: threading.Event) -> None:
    """Type text with the keyboard. New lines are typed as Shift+Enter, so a
    chat or mail app never treats one as 'send'. Enter itself is never pressed."""
    from pynput.keyboard import Controller, Key
    kb = Controller()
    for ch in text.replace("\r\n", "\n"):
        if stop.is_set():
            raise ToolError("Stopped by the kill switch.")
        if ch == "\n":
            with kb.pressed(Key.shift):
                kb.press(Key.enter)
                kb.release(Key.enter)
        elif ch == "\t":
            kb.press(Key.tab)
            kb.release(Key.tab)
        else:
            kb.type(ch)
        time.sleep(0.008)


def screenshot_block(max_edge: int = 1280) -> tuple[dict, float]:
    """A picture of the screen for the brain to look at, and how much it was shrunk."""
    from PIL import ImageGrab
    img = ImageGrab.grab()
    scale = min(1.0, max_edge / max(img.size))
    if scale < 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=70)
    return ({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.standard_b64encode(buf.getvalue()).decode()}},
            scale)


class Computer:
    def __init__(self, cfg: dict, workspace: Path, logs_dir: Path, error_log=None):
        self.cfg = cfg.get("computer_control") or {}
        self.enabled = bool(self.cfg.get("enabled", True))
        self.log = ActionLog(logs_dir)
        self.workspace = workspace.resolve()
        self.dry_run = os.environ.get("JARVIS_DRY_RUN") == "1"
        self.stop = threading.Event()      # set by the kill switch
        self.proc = None

        self.tiers = dict(DEFAULT_TIERS)
        for name in self.cfg.get("tier_2_ask_first") or []:
            if name in self.tiers:
                self.tiers[name] = 2
        for name in self.cfg.get("tier_1_no_ask") or []:
            if name in self.tiers and DEFAULT_TIERS[name] == 2 and error_log:
                error_log("config", f"'{name}' cannot be moved to tier 1; it stays ask-first.")
        for name in self.cfg.get("tier_3_never") or []:
            if name in self.tiers:
                self.tiers[name] = 3
        if not (self.cfg.get("screen_control") or {}).get("enabled", False):
            self.tiers["control_screen"] = 3

        self.folders: dict[str, Path] = {}
        for entry in self.cfg.get("allowed_folders") or ["workspace", "Documents", "Downloads"]:
            key = str(entry).strip()
            if key.lower() == "workspace":
                path = self.workspace
            elif key.lower() in ("documents", "downloads"):
                path = _known_folder(key.lower())
            else:
                path = Path(os.path.expandvars(os.path.expanduser(key)))
            try:
                self.folders[key] = path.resolve()
            except OSError:
                continue

    # ---- policy ------------------------------------------------------------
    def tier(self, name: str) -> int | None:
        return self.tiers.get(name)

    def hidden_tools(self) -> set[str]:
        """Actions the brains should not even be offered."""
        return {n for n, t in self.tiers.items() if t == 3 or not self.enabled}

    def folders_text(self) -> str:
        return "; ".join(f"{k} = {v}" for k, v in self.folders.items())

    def path(self, raw: str, must_exist: bool = False, inside_only: bool = True) -> Path:
        """Turn what the brain wrote into a real path and refuse anything outside
        the allowed folders."""
        if not isinstance(raw, str) or not raw.strip():
            raise ToolError("A file or folder path is needed.")
        raw = raw.strip().strip('"')
        p = Path(os.path.expandvars(os.path.expanduser(raw)))
        if not p.is_absolute():
            first = p.parts[0].lower() if p.parts else ""
            alias = next((v for k, v in self.folders.items() if k.lower() == first), None)
            p = alias.joinpath(*p.parts[1:]) if alias else self.workspace / p
        try:
            p = p.resolve()
        except OSError as e:
            raise ToolError(f"That path is not valid: {e}")
        if inside_only and not any(p == f or f in p.parents for f in self.folders.values()):
            raise ToolError(f"{p} is outside the allowed folders ({self.folders_text()}). "
                            "The user can add folders in config.yaml.")
        if must_exist and not p.exists():
            raise ToolError(f"{p} does not exist.")
        return p

    def kill(self) -> None:
        self.stop.set()
        proc = self.proc
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    # ---- tier 1: done without asking ---------------------------------------
    def search_files(self, a: dict) -> str:
        words = [w for w in str(a.get("query", "")).lower().split() if w]
        if not words:
            raise ToolError("Say what to search for.")
        roots = [self.path(a["folder"], must_exist=True)] if a.get("folder") else \
            list(self.folders.values())
        hits, deadline = [], time.time() + 8
        for root in roots:
            for folder, dirs, files in os.walk(root):
                dirs[:] = [d for d in dirs if not d.startswith((".", "$"))]
                for name in files + dirs:
                    if all(w in name.lower() for w in words):
                        hits.append(str(Path(folder) / name))
                if len(hits) >= 40 or time.time() > deadline:
                    break
            if len(hits) >= 40 or time.time() > deadline:
                break
        if not hits:
            return "Nothing found with that in its name."
        more = "\n(stopped at 40 results or 8 seconds - narrow the search for more)" \
            if len(hits) >= 40 or time.time() > deadline else ""
        return "\n".join(hits[:40]) + more

    def list_folder(self, a: dict) -> str:
        folder = self.path(a.get("folder") or "workspace", must_exist=True)
        if not folder.is_dir():
            raise ToolError(f"{folder} is not a folder.")
        items = sorted(folder.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        lines = [("[folder] " if p.is_dir() else "") + p.name for p in items[:200]]
        if len(items) > 200:
            lines.append(f"... and {len(items) - 200} more")
        return f"{folder}:\n" + ("\n".join(lines) if lines else "(empty)")

    def read_text_file(self, a: dict) -> str:
        p = self.path(a.get("path", ""), must_exist=True)
        if not p.is_file():
            raise ToolError(f"{p} is not a file.")
        if p.suffix.lower() not in READ_TYPES:
            raise ToolError(f"Only text files can be read ({', '.join(sorted(READ_TYPES))}).")
        if p.stat().st_size > MAX_READ_BYTES:
            raise ToolError(f"That file is too large to read in one go ({p.stat().st_size:,} "
                            f"bytes; the limit is {MAX_READ_BYTES:,}).")
        try:
            return p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ToolError("That file is not plain text, so it cannot be read.")

    def set_volume(self, a: dict) -> str:
        change = str(a.get("change", "")).lower()
        if change not in ("set", "up", "down", "mute_toggle"):
            raise ToolError("change must be set, up, down or mute_toggle.")
        level = a.get("level")
        if change == "set" and not (isinstance(level, int) and 0 <= level <= 100):
            raise ToolError("For 'set', level must be a whole number from 0 to 100.")
        if self.dry_run:
            return f"(test mode) Would change the volume: {change} {level if change == 'set' else ''}"
        try:
            import ctypes
            user32 = ctypes.windll.user32
        except Exception:
            raise ToolError("Changing the volume only works on Windows.")

        def press(vk, times=1):
            for _ in range(times):
                user32.keybd_event(vk, 0, 0, 0)
                user32.keybd_event(vk, 0, 2, 0)

        mute, down, up = 0xAD, 0xAE, 0xAF     # the keyboard's volume keys; one press = 2%
        if change == "mute_toggle":
            press(mute)
            return "Pressed the mute key (it switches sound off, or back on)."
        if change in ("up", "down"):
            press(up if change == "up" else down, 5)
            return f"Volume turned {change} by about 10%."
        press(down, 50)
        press(up, round(level / 2))
        return f"Volume set to about {round(level / 2) * 2}%."

    def take_screenshot(self, a: dict):
        if self.dry_run:
            return "(test mode) Would take a screenshot."
        try:
            block, _scale = screenshot_block()
        except Exception as e:
            raise ToolError(f"The screenshot could not be taken: {type(e).__name__}")
        return [block, {"type": "text", "text": "This is the user's screen right now. "
                        "It was taken for your eyes only and has not been saved."}]

    # ---- tier 2: described exactly, done only after a yes ------------------
    # Each plan_ method checks everything first, then returns
    # (exact description, function that does exactly that).
    def plan_create_text_file(self, a: dict):
        p = self.path(a.get("path", ""))
        content = a.get("content", "")
        if not isinstance(content, str):
            raise ToolError("content must be text.")
        if p.suffix.lower() not in WRITE_TYPES:
            raise ToolError(f"Only these kinds of file can be created: {', '.join(sorted(WRITE_TYPES))}.")
        if p.exists():
            raise ToolError(f"{p} already exists. JARVIS never overwrites a file. Choose "
                            "another name, or ask the user about moving the old one to "
                            "the Recycle Bin first.")
        shown = content if len(content) <= 1200 else content[:1200] + \
            f"\n... (and {len(content) - 1200:,} more characters)"
        desc = f"Create a new file:\n  {p}\nwith this in it ({len(content):,} characters):\n{shown}"

        def do():
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("x", encoding="utf-8") as f:
                f.write(content)
            return f"Created {p}."
        return desc, do

    def plan_move_or_rename(self, a: dict):
        src = self.path(a.get("source", ""), must_exist=True)
        dst = self.path(a.get("destination", ""))
        if src in self.folders.values():
            raise ToolError("An allowed folder itself cannot be moved or renamed.")
        if dst.is_dir():
            dst = dst / src.name
        if dst.exists():
            raise ToolError(f"{dst} already exists. JARVIS never overwrites a file.")
        kind = "Rename" if src.parent == dst.parent else "Move"
        desc = f"{kind} this {'folder' if src.is_dir() else 'file'}:\n  from  {src}\n  to    {dst}"

        def do():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            return f"Done: {src.name} is now at {dst}."
        return desc, do

    def plan_move_to_recycle_bin(self, a: dict):
        p = self.path(a.get("path", ""), must_exist=True)
        if p in self.folders.values():
            raise ToolError("An allowed folder itself cannot be put in the Recycle Bin.")
        extra = ""
        if p.is_dir():
            count = sum(1 for x in p.rglob("*") if x.is_file())
            extra = f" and the {count} file(s) inside it"
        desc = (f"Move this {'folder' if p.is_dir() else 'file'}{extra} to the Recycle Bin:\n"
                f"  {p}\nIt is not deleted for good: you can restore it from the Recycle Bin.")

        def do():
            from send2trash import send2trash
            send2trash(str(p))
            return f"Moved {p.name} to the Recycle Bin."
        return desc, do

    def plan_run_powershell(self, a: dict):
        command = a.get("command", "")
        if not isinstance(command, str) or not command.strip():
            raise ToolError("A command is needed.")
        for pattern, why in _PS_BLOCKED:
            if re.search(pattern, command, re.I):
                raise Tier3(f"That command is not allowed because {why}.")
        exe = shutil.which("powershell") or shutil.which("pwsh")
        desc = f"Run this PowerShell command on your PC:\n  {command}"

        def do():
            if not exe:
                raise ToolError("PowerShell was not found on this computer.")
            self.proc = subprocess.Popen(
                [exe, "-NoProfile", "-NonInteractive", "-Command", command],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                cwd=str(self.workspace),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                out, _ = self.proc.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                raise ToolError("The command took longer than 60 seconds and was stopped.")
            if self.stop.is_set():
                raise ToolError("Stopped by the kill switch.")
            out = (out or "").strip()
            if len(out) > 4000:
                out = out[:4000] + "\n... (output cut off here; it was longer)"
            return f"Finished with exit code {self.proc.returncode}.\n{out or '(no output)'}"
        return desc, do

    def _typing_checks(self, pieces: list[str], window: str) -> None:
        if not isinstance(window, str) or not window.strip():
            raise ToolError("window_title is needed: part of the title of the app to type into.")
        if _SENSITIVE_WINDOW.search(window):
            raise Tier3("JARVIS does not type into sign-in, password, payment or security windows.")
        for piece in pieces:
            if not isinstance(piece, str):
                raise ToolError("Everything to type must be text.")
            if _CARD_NUMBER.search(piece):
                raise Tier3("That looks like a card or account number. JARVIS does not make payments.")

    def _type_into(self, window: str, pieces: list[str], tab_between: bool) -> str:
        title = focus_window(window)
        if _SENSITIVE_WINDOW.search(title):
            raise Tier3(f"The window \"{title}\" looks like a sign-in, payment or security "
                        "window, so nothing was typed.")
        for i, piece in enumerate(pieces):
            if i and tab_between:
                type_string("\t", self.stop)
            type_string(piece, self.stop)
        return f"Typed into \"{title}\". Enter was not pressed and nothing was sent or submitted."

    def plan_type_text(self, a: dict):
        text, window = a.get("text", ""), a.get("window_title", "")
        self._typing_checks([text], window)
        desc = (f"Type this into the app whose window title contains \"{window}\":\n{text}\n"
                "I will not press Enter, so nothing is sent or submitted.")
        return desc, lambda: self._type_into(window, [text], False)

    def plan_fill_form(self, a: dict):
        values, window = a.get("values"), a.get("window_title", "")
        if not isinstance(values, list) or not values:
            raise ToolError("values must be a list of the things to type, in order.")
        self._typing_checks(values, window)
        listed = "\n".join(f"  {i}. {v}" for i, v in enumerate(values, 1))
        desc = (f"Fill in a form in the app whose window title contains \"{window}\", starting "
                f"at the box the cursor is in and pressing Tab to move to the next box:\n{listed}\n"
                "I will not press Enter or click any button, so nothing is submitted.")
        return desc, lambda: self._type_into(window, values, True)


class Tier3(ToolError):
    """The request falls in the 'never' tier."""


class HotkeyWatcher:
    """Watches the whole keyboard for one combination, e.g. ctrl+alt+k or pause."""

    _MODS = {"ctrl": "ctrl", "ctrl_l": "ctrl", "ctrl_r": "ctrl", "alt": "alt", "alt_l": "alt",
             "alt_r": "alt", "alt_gr": "alt", "shift": "shift", "shift_l": "shift",
             "shift_r": "shift", "cmd": "win", "cmd_l": "win", "cmd_r": "win"}

    def __init__(self, combo: str, callback):
        from pynput import keyboard
        parts = [p for p in combo.lower().replace(" ", "").split("+") if p]
        self.key = parts[-1]
        self.mods = {("win" if p in ("win", "super", "cmd") else p) for p in parts[:-1]}
        self.down: set[str] = set()
        self.callback = callback
        self.fired = False
        self.listener = keyboard.Listener(on_press=self._press, on_release=self._release)
        self.listener.daemon = True
        self.listener.start()

    def _name(self, key) -> str:
        try:
            key = self.listener.canonical(key)   # undo what Ctrl/Alt do to letters
        except Exception:
            pass
        char = getattr(key, "char", None)
        return char.lower() if char else getattr(key, "name", "") or ""

    def _press(self, key) -> None:
        name = self._name(key)
        if name in self._MODS:
            self.down.add(self._MODS[name])
        elif name == self.key and self.mods <= self.down and not self.fired:
            self.fired = True
            self.callback()

    def _release(self, key) -> None:
        name = self._name(key)
        if name in self._MODS:
            self.down.discard(self._MODS[name])
        elif name == self.key:
            self.fired = False

    def stop(self) -> None:
        self.listener.stop()
