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
        self.voice = None                # set once the voice parts have loaded
        self.waiting_voice_text = None   # a spoken request that arrived mid-reply
        self.confirming = False          # a tier 2 action is waiting for yes or no
        self.kill_listener = None

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
        self.chat.tag_configure("ask", foreground="#ffd479", font=("Consolas", 10))

        self.status = tk.Label(root, text="Starting...", anchor="w", bg=PANEL, fg=DIM,
                               font=("Segoe UI", 9), padx=10, pady=3)
        self.status.pack(fill="x")

        vbar = tk.Frame(root, bg=PANEL)
        vbar.pack(fill="x")
        self.voice_label = tk.Label(vbar, text="Voice: off", anchor="w", bg=PANEL, fg=ACCENT,
                                    font=("Segoe UI", 9, "bold"), padx=10, pady=3)
        self.voice_label.pack(side="left", fill="x", expand=True)
        self.voice_choice = tk.StringVar(value="")
        self.voice_menu = tk.OptionMenu(vbar, self.voice_choice, "")
        self.voice_menu.config(bg=PANEL, fg=FG, activebackground=BG, activeforeground=FG,
                               relief="flat", highlightthickness=0, font=("Segoe UI", 9))
        self.stop_btn = tk.Button(vbar, text="Stop talking", command=self._stop_talking,
                                  bg=PANEL, fg=FG, relief="flat", font=("Segoe UI", 9))
        self.talk_btn = tk.Button(vbar, text="Hold to talk", bg=PANEL, fg=FG, relief="flat",
                                  font=("Segoe UI", 9))
        tk.Button(vbar, text="STOP ALL", command=self._kill, bg="#b3261e", fg="white",
                  activebackground="#d9392f", relief="flat",
                  font=("Segoe UI", 9, "bold")).pack(side="right", padx=(0, 10), pady=2)
        self.talk_btn.bind("<ButtonPress-1>", lambda e: self.voice and self.voice.talk_down())
        self.talk_btn.bind("<ButtonRelease-1>", lambda e: self.voice and self.voice.talk_up())

        self.confirm_bar = tk.Frame(root, bg="#3a2a00")
        tk.Label(self.confirm_bar, text="JARVIS is waiting for your answer:", bg="#3a2a00",
                 fg="#ffd479", font=("Segoe UI", 10, "bold"), padx=10, pady=6).pack(side="left")
        tk.Button(self.confirm_bar, text="No, don't", command=lambda: self._answer(False),
                  bg=PANEL, fg=FG, relief="flat", font=("Segoe UI", 10, "bold"),
                  padx=14).pack(side="right", padx=(0, 10), pady=5)
        tk.Button(self.confirm_bar, text="Yes, do it", command=lambda: self._answer(True),
                  bg="#2e7d32", fg="white", relief="flat", font=("Segoe UI", 10, "bold"),
                  padx=14).pack(side="right", padx=(0, 6), pady=5)

        bottom = tk.Frame(root, bg=PANEL)
        self.bottom = bottom
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
            self.engine = Engine(self._from_engine)
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
            self._start_voice()
            self._start_kill_switch()
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.root.after(20, self._poll)

    # ---- voice -------------------------------------------------------------
    def _from_engine(self, ev: dict) -> None:
        """Brain events go to the voice straight away, then to the window."""
        if self.voice is not None:
            try:
                self.voice.on_engine_event(ev)
            except Exception:
                pass
        self.events.put(ev)

    def _start_voice(self) -> None:
        vcfg = self.engine.cfg.get("voice") or {}
        if not vcfg.get("enabled", True):
            self.voice_label.config(text="Voice: switched off in config.yaml")
            return
        self.voice_label.config(text="Voice: starting up...")

        def load():
            try:
                from . import voice as voice_mod
                if not voice_mod.models_ready():
                    raise RuntimeError("not set up yet - double-click setup_voice.bat")
                v = voice_mod.Voice(self.engine.cfg, self.events.put, self.engine)
                self.events.put({"type": "voice_ready", "voice": v})
            except Exception as e:
                self.engine.log.error("voice", f"start-up: {type(e).__name__}: {e}")
                self.events.put({"type": "voice_off", "reason": str(e) or type(e).__name__})

        threading.Thread(target=load, daemon=True).start()

    def _voice_ready(self, v) -> None:
        self.voice = v
        voices = v.voices()
        menu = self.voice_menu["menu"]
        menu.delete(0, "end")
        for label in voices:
            menu.add_command(label=label, command=lambda l=label: self._pick_voice(l))
        self.voice_choice.set(v.mouth.voice_label)
        self.talk_btn.pack(side="right", padx=(0, 10))
        self.stop_btn.pack(side="right", padx=(0, 6))
        self.voice_menu.pack(side="right", padx=(0, 6))
        self.voice_label.config(text="Voice: " + v.idle_hint())

    def _pick_voice(self, label: str) -> None:
        self.voice_choice.set(label)
        threading.Thread(target=self.voice.set_voice, args=(label,), daemon=True).start()

    def _stop_talking(self) -> None:
        if self.voice:
            self.voice.interrupt()

    # ---- safety: yes/no answers and the kill switch -------------------------
    def _answer(self, yes) -> None:
        if self.confirming and self.engine:
            self.engine.answer_confirm(yes)

    def _kill(self) -> None:
        """Stop every action and background job. Safe to call from any thread."""
        if self.engine:
            self.engine.kill()
        if self.voice:
            self.voice.interrupt()

    def _start_kill_switch(self) -> None:
        combo = str((self.engine.cfg.get("computer_control") or {})
                    .get("kill_switch_hotkey", "ctrl+alt+k")).lower().replace(" ", "")
        self.kill_combo = combo.upper().replace("+", " + ")
        try:
            from .control import HotkeyWatcher
            self.kill_listener = HotkeyWatcher(combo, self._kill)
            self._line(f"Kill switch: press {self.kill_combo} (or the red STOP ALL button) to "
                       "stop everything at once.\n", "note")
        except Exception as e:
            self.engine.log.error("kill switch", f"{type(e).__name__}: {e}")
            self._line("The kill-switch hotkey could not be set up; use the red STOP ALL "
                       "button instead.\n", "error")

    def _close(self) -> None:
        if self.kill_listener:
            self.kill_listener.stop()
        if self.voice:
            self.voice.close()
        self.root.destroy()

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

    def send(self, spoken_text: str | None = None) -> None:
        spoken = spoken_text is not None
        if self.engine is None:
            return
        if self.confirming:             # whatever is typed or said now is the yes/no answer
            text = spoken_text if spoken else self.entry.get("1.0", "end").strip()
            if text:
                if not spoken:
                    self.entry.delete("1.0", "end")
                self._write(f"\nYou answered: \"{text}\"\n", "you")
                self.engine.answer_confirm(text)
            return
        if spoken and self.busy:        # the old reply is being stopped; send when it ends
            self.waiting_voice_text = spoken_text
            return
        text = spoken_text if spoken else self.entry.get("1.0", "end").strip()
        if not text or self.busy:
            return
        if not spoken:
            self.entry.delete("1.0", "end")
        if self.voice:
            self.voice.request_started(spoken)
        self._line("You (JARVIS heard)" if spoken else "You", "you")
        self._line(text + "\n")
        self._line("JARVIS", "jarvis")
        self.chat.mark_set("reply_start", "end-1c")
        self.chat.mark_gravity("reply_start", "left")
        self.busy = self.reply_open = True
        self.send_btn.config(state="disabled")
        self.status.config(text="Reflex brain is thinking...")
        threading.Thread(target=self.engine.handle, args=(text, spoken), daemon=True).start()

    # ---- events coming back from the brains --------------------------------
    def _poll(self) -> None:
        try:
            while True:
                self._on_event(self.events.get_nowait())
        except queue.Empty:
            pass
        self.root.after(20, self._poll)

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
            if self.waiting_voice_text:
                text, self.waiting_voice_text = self.waiting_voice_text, None
                self.send(text)
        elif kind == "confirm":
            self.confirming = True
            self.root.bell()
            self._write("\n\nMAY I DO THIS?\n", "jarvis")
            self._write(ev["text"] + "\n", "ask")
            self._write("Answer yes or no - click a button, type it, or say it.\n", "note")
            self.confirm_bar.pack(fill="x", before=self.bottom)
            self.send_btn.config(state="normal")
            self.root.deiconify()
        elif kind == "confirm_closed":
            self.confirming = False
            self.confirm_bar.pack_forget()
            if self.busy:
                self.send_btn.config(state="disabled")
            self._write("Approved - doing it now.\n\n" if ev["yes"] else
                        ("No answer in time, so I did NOT do it.\n\n" if ev["timed_out"]
                         else "Not done.\n\n"), "note")
        elif kind == "killed":
            self._write("\nKILL SWITCH: everything has been stopped.\n", "error")
        elif kind == "voice_ready":
            self._voice_ready(ev["voice"])
        elif kind == "voice_off":
            self.voice_label.config(text="Voice: off (" + ev["reason"][:90] + "). "
                                         "Typing still works.")
        elif kind == "voice_state":
            if self.voice:
                key = self.voice.hotkey_name.upper()
                text = {"idle": self.voice.idle_hint(),
                        "listening": "Listening...",
                        "transcribing": "Working out what you said...",
                        "speaking": f"Speaking - say \"Jarvis, stop\" or press {key} to "
                                    "interrupt"}.get(ev["state"], ev["state"])
                if ev.get("detail"):
                    text = ev["detail"] + "  " + text
                self.voice_label.config(text="Voice: " + text)
        elif kind == "heard":
            if ev.get("stop") and self.confirming:
                self._answer(False)
            elif ev.get("stop"):
                self.waiting_notices.append(ev) if self.reply_open else self._show_notice(ev)
            else:
                self.send(ev["text"])
        elif kind in ("job_done", "job_failed", "job_logged", "voice_timing",
                      "research_ask", "research_done", "research_failed"):
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
        elif ev["type"] == "research_ask":
            self.root.bell()
            self._line(f"JARVIS - research job #{ev['job']} needs your answer", "jarvis")
            self._line(ev["text"])
            self._line("Answer by typing or saying: continue, write it up, or cancel.\n", "note")
        elif ev["type"] == "research_done":
            self.root.bell()
            self._line(f"JARVIS - research job #{ev['job']} is done: {ev['title']}", "jarvis")
            self._line(ev["summary"])
            self._line(f"Saved as {ev['file']}   ({ev['searches']} searches, {ev['pages']} "
                       f"pages opened, about ${ev['cost']:.2f}, {ev['checks']} automatic "
                       "check notes in the report)", "note")
            if not ev["word"]:
                self._line("The Word-file part is not installed, so this was saved as a "
                           "text file. Run start_jarvis.bat again to update.", "error")
            self._line(ev["question"] + "\n")
        elif ev["type"] == "research_failed":
            self.root.bell()
            self._line(f"JARVIS - research job #{ev['job']} did not finish", "jarvis")
            self._line("Sorry - " + ev["text"] + "\n", "error")
        elif ev["type"] == "heard":
            self._line(f"JARVIS heard: \"{ev['text']}\" - stopped.\n", "note")
        elif ev["type"] == "voice_timing":
            self._line(f"voice: {ev['stop_to_first_word_ms']:,} ms from when you stopped "
                       f"speaking to my first word  (waiting for silence "
                       f"{ev['wait_for_silence_ms']:,}, speech-to-text "
                       f"{ev['speech_to_text_ms']:,}, brain {ev['brain_first_sentence_ms']:,}, "
                       f"voice {ev['voice_ms']:,})\n", "note")
        elif ev["type"] == "job_logged":
            self.today = ev["today"]
            self._line(f"background job #{ev['job']}  |  {ev['ms']:,} ms  |  "
                       f"about ${ev['cost']:.4f}\n", "note")
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
