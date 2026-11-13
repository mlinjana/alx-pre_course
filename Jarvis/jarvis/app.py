"""The desktop chat window (uses tkinter, which comes with Python on Windows)."""
import queue
import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext

from .engine import Engine
from .settings import SetupProblem

BG, PANEL, FG, ACCENT, DIM, WARN = "#0f1720", "#18232f", "#e6edf3", "#4cc2ff", "#8b98a5", "#ff8a80"


class ChatWindow:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.events: queue.Queue = queue.Queue()
        self.busy = False
        self.reply_open = False          # is a JARVIS reply being streamed right now?
        self.waiting_notices: list = []  # background-job news held until the reply ends
        self.today = None

        root.title("JARVIS")
        root.geometry("820x640")
        root.minsize(520, 400)
        root.configure(bg=BG)

        self.chat = scrolledtext.ScrolledText(
            root, wrap="word", state="disabled", bg=BG, fg=FG, insertbackground=FG,
            font=("Segoe UI", 11), relief="flat", padx=14, pady=10, spacing3=4)
        self.chat.pack(fill="both", expand=True)
        self.chat.tag_configure("you", foreground=ACCENT, font=("Segoe UI", 10, "bold"))
        self.chat.tag_configure("jarvis", foreground="#7ee787", font=("Segoe UI", 10, "bold"))
        self.chat.tag_configure("note", foreground=DIM, font=("Segoe UI", 9, "italic"))
        self.chat.tag_configure("error", foreground=WARN)

        self.status = tk.Label(root, text="Starting...", anchor="w", bg=PANEL, fg=DIM,
                               font=("Segoe UI", 9), padx=10, pady=3)
        self.status.pack(fill="x")

        bottom = tk.Frame(root, bg=PANEL)
        bottom.pack(fill="x")
        self.entry = tk.Text(bottom, height=3, wrap="word", bg="#0b1118", fg=FG,
                             insertbackground=FG, font=("Segoe UI", 11), relief="flat",
                             padx=10, pady=8)
        self.entry.pack(side="left", fill="both", expand=True, padx=(10, 6), pady=10)
        self.send_btn = tk.Button(bottom, text="Send", command=self.send, bg=ACCENT,
                                  fg="#001018", activebackground="#7fd4ff", relief="flat",
                                  font=("Segoe UI", 10, "bold"), padx=18, pady=8)
        self.send_btn.pack(side="right", padx=(0, 10), pady=10)
        self.entry.bind("<Return>", self._on_enter)
        self.entry.focus_set()

        try:
            self.engine = Engine(self.events.put)
        except SetupProblem as e:
            self.engine = None
            self._line("JARVIS can't start yet", "error")
            self._line(str(e) + "\n")
            self.status.config(text="Setup needed - see the message above.")
            self.send_btn.config(state="disabled")
        else:
            self._line("JARVIS", "jarvis")
            self._line("Online. Type a message and press Enter. "
                       "(Shift+Enter makes a new line.)\n")
            self.status.config(text="Ready.")
        self.root.after(40, self._poll)

    # ---- writing into the chat area ----------------------------------------
    def _write(self, text: str, tag: str | None = None) -> None:
        self.chat.config(state="normal")
        self.chat.insert("end", text, tag or ())
        self.chat.config(state="disabled")
        self.chat.see("end")

    def _line(self, text: str, tag: str | None = None) -> None:
        self._write(text + "\n", tag)

    # ---- sending -----------------------------------------------------------
    def _on_enter(self, event):
        if event.state & 0x1:  # Shift held: let it make a new line
            return None
        self.send()
        return "break"

    def send(self) -> None:
        text = self.entry.get("1.0", "end").strip()
        if not text or self.busy or self.engine is None:
            return
        self.entry.delete("1.0", "end")
        self._line("You", "you")
        self._line(text + "\n")
        self._line("JARVIS", "jarvis")
        self.chat.mark_set("reply_start", "end-1c")
        self.chat.mark_gravity("reply_start", "left")
        self.busy = self.reply_open = True
        self.send_btn.config(state="disabled")
        self.status.config(text="Reflex brain is thinking...")
        threading.Thread(target=self.engine.handle, args=(text,), daemon=True).start()

    # ---- events coming back from the brains --------------------------------
    def _poll(self) -> None:
        try:
            while True:
                self._on_event(self.events.get_nowait())
        except queue.Empty:
            pass
        self.root.after(40, self._poll)

    def _on_event(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "delta":
            self._write(ev["text"])
        elif kind == "reset":
            self.chat.config(state="normal")
            self.chat.delete("reply_start", "end-1c")
            self.chat.insert("end", ev.get("text", ""))
            self.chat.config(state="disabled")
        elif kind == "status":
            self.status.config(text=ev["text"])
        elif kind == "error":
            self._write("\nSorry - " + ev["text"], "error")
        elif kind == "done":
            self._write("\n")
            self.today = ev["today"]
            self._line(f"{ev['brain']}  |  {ev['ms']:,} ms  |  {ev['tokens']:,} tokens  |  "
                       f"about ${ev['cost']:.4f}\n", "note")
            self.status.config(text=f"Ready.   Today so far: about ${self.today:.4f}")
            self.busy = self.reply_open = False
            self.send_btn.config(state="normal")
            for held in self.waiting_notices:
                self._show_notice(held)
            self.waiting_notices.clear()
        elif kind in ("job_done", "job_failed", "job_logged"):
            if self.reply_open:
                self.waiting_notices.append(ev)
            else:
                self._show_notice(ev)

    def _show_notice(self, ev: dict) -> None:
        if ev["type"] == "job_done":
            self.root.bell()
            self._line(f"JARVIS - background job #{ev['job']} is done", "jarvis")
            self._line(ev["text"])
            self._line(f"Saved as {ev['file']}", "note")
        elif ev["type"] == "job_failed":
            self.root.bell()
            self._line(f"JARVIS - background job #{ev['job']} did not finish", "jarvis")
            self._line("Sorry - " + ev["text"], "error")
        elif ev["type"] == "job_logged":
            self.today = ev["today"]
            self._line(f"deep brain  |  {ev['ms']:,} ms  |  about ${ev['cost']:.4f}\n", "note")
            if not self.busy:
                self.status.config(text=f"Ready.   Today so far: about ${self.today:.4f}")


def run() -> None:
    try:  # sharper text on high-resolution Windows screens
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    try:
        ChatWindow(root)
    except Exception as e:
        messagebox.showerror("JARVIS", f"JARVIS could not start: {type(e).__name__}: {e}")
        raise
    root.mainloop()
