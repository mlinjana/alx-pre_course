"""Joins the ears, the brains and the mouth together, and times each step."""
import csv
import json
import queue
import threading
import time
from datetime import datetime
from pathlib import Path

import numpy as np

from . import settings
from .ears import RATE, Ears, Microphone, Transcriber, is_stop, strip_wake_word
from .mouth import VOICES, Mouth

MODELS = settings.BASE_DIR / "models"
PREFS = settings.BASE_DIR / "voice_prefs.json"
TIMING_COLUMNS = ["time", "source", "heard", "wait_for_silence_ms", "speech_to_text_ms",
                  "brain_first_sentence_ms", "voice_ms", "stop_to_first_word_ms"]


def models_ready() -> bool:
    return (MODELS / ".ready").exists()


def _beep(rate: int = 22050) -> np.ndarray:
    t = np.arange(int(rate * 0.09)) / rate
    tone = np.sin(2 * np.pi * 880 * t) * np.hanning(len(t)) * 0.25
    return (tone * 32767).astype(np.int16)


class Voice:
    """to_ui(event) receives: voice_state, heard, voice_timing.
    Engine events must be passed in through on_engine_event()."""

    def __init__(self, cfg: dict, to_ui, engine, mic=True, sink=None):
        self.cfg = cfg.get("voice", {}) or {}
        self.to_ui = to_ui
        self.engine = engine
        self.work: queue.Queue = queue.Queue()
        self.timing: dict | None = None     # timing of the spoken request in progress
        self.speak_reply = False
        self.hotkey_name = str(self.cfg.get("hotkey", "f9")).lower()
        self.hotkey_listener = None
        self.key_down = False
        self.listen_after_speech = False

        prefs = {}
        try:
            prefs = json.loads(PREFS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        self.mouth = Mouth(MODELS, prefs.get("voice") or self.cfg.get("voice", ""), sink=sink,
                           on_first_audio=self._first_audio, on_state=self._speaking_changed)
        self.stt = Transcriber(MODELS, self.cfg)
        if self.stt.note:
            engine.log.error("voice", self.stt.note)
        self.ears = Ears(MODELS, self.cfg, self.work.put)
        self.mic = Microphone(self.ears.feed) if mic else None
        threading.Thread(target=self._work_loop, daemon=True).start()
        if mic:
            self._start_hotkey()
        self._state("idle")

    # ---- small helpers ---------------------------------------------------
    def _state(self, state: str, detail: str = "") -> None:
        self.to_ui({"type": "voice_state", "state": state, "detail": detail})

    def idle_hint(self) -> str:
        chip = " (speech-to-text on graphics card)" if self.stt.device == "cuda" else ""
        return f"Say \"Jarvis\" or hold {self.hotkey_name.upper()} to talk{chip}"

    def voices(self) -> list[str]:
        return self.mouth.available_voices()

    def set_voice(self, label: str) -> None:
        self.mouth.set_voice(label)
        try:
            PREFS.write_text(json.dumps({"voice": label}), encoding="utf-8")
        except OSError:
            pass
        self.mouth.say("This is how I sound now.")

    def interrupt(self) -> None:
        """Stop talking and stop the reply that is being written."""
        self.listen_after_speech = False
        self.mouth.stop()
        if self.engine.confirm is None:    # answering a yes/no must not cancel the task
            self.engine.cancel()

    def close(self) -> None:
        if self.mic:
            self.mic.close()
        if self.hotkey_listener:
            self.hotkey_listener.stop()

    # ---- push-to-talk hotkey ---------------------------------------------
    def _start_hotkey(self) -> None:
        try:
            from pynput import keyboard
        except Exception:
            return  # the "Hold to talk" button in the window still works
        name = self.hotkey_name
        wanted = getattr(keyboard.Key, name, None) or keyboard.KeyCode.from_char(name[:1])

        def on_press(key):
            if key == wanted and not self.key_down:
                self.key_down = True
                self.talk_down()

        def on_release(key):
            if key == wanted and self.key_down:
                self.key_down = False
                self.talk_up()

        self.hotkey_listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        self.hotkey_listener.daemon = True
        self.hotkey_listener.start()

    def talk_down(self) -> None:
        self.interrupt()
        self.ears.ptt_down()

    def talk_up(self) -> None:
        self.ears.ptt_up()

    # ---- events from the ears (handled off the microphone thread) --------
    def _work_loop(self) -> None:
        while True:
            ev = self.work.get()
            try:
                self._on_ears(ev)
            except Exception as e:
                self.engine.log.error("voice", f"{type(e).__name__}: {e}")
                self._state("idle")

    def _on_ears(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "wake":
            self.interrupt()
            try:
                self.mouth.sink.write(_beep(), 22050)
            except Exception:
                pass
        elif kind == "listening":
            self._state("listening")
        elif kind in ("silence", "tap"):
            self._state("idle")
        elif kind == "utterance":
            self._state("transcribing")
            t0 = time.time()
            text = self.stt.transcribe(ev["audio"])
            stt_done = time.time()
            if ev["source"] == "wake":
                text = strip_wake_word(text)
                if not text:                 # only "Jarvis" was said: wait for the request
                    self.ears.listen_now()
                    return
            if not text.strip():
                self._state("idle", "I didn't catch that.")
                return
            if is_stop(text):
                self.to_ui({"type": "heard", "text": text, "stop": True})
                self._state("idle")
                return
            self.timing = {"source": ev["source"], "heard": text,
                           "t_stop": ev["speech_end"], "t_endpoint": ev["endpoint"],
                           "t_stt_start": t0, "t_stt_done": stt_done}
            self.to_ui({"type": "heard", "text": text, "stop": False})

    # ---- events from the brains ------------------------------------------
    def request_started(self, spoken: bool) -> None:
        """Called by the window just before a request is sent to the brains."""
        self.speak_reply = spoken or bool(self.cfg.get("speak_typed_replies", False))
        if not spoken:
            self.timing = None
        self.mouth.start_reply()
        if not self.speak_reply:
            self.mouth.first_pending = False

    def on_engine_event(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "delta" and self.speak_reply:
            if self.timing and "t_first_text" not in self.timing:
                self.timing["t_first_text"] = time.time()
            self.mouth.feed(ev["text"])
        elif kind == "reset" and self.speak_reply:
            self.mouth.start_reply()
            self.mouth.feed(ev.get("text", ""))
        elif kind == "done" and self.speak_reply:
            self.mouth.finish()
        elif kind == "error" and self.speak_reply:
            self.mouth.say("Sorry, something went wrong. The details are on screen.")
        elif kind == "job_done":
            self.mouth.say(f"Background job {ev['job']} is done. The report is on screen.")
        elif kind == "research_done":
            self._say_then_listen(ev["summary"] + " " + ev["question"])
        elif kind == "confirm":
            self._say_then_listen("Before I do this, I need your yes. " + ev["text"]
                                  + " Shall I go ahead?")
        elif kind == "killed":
            self.listen_after_speech = False
            self.mouth.stop()
        elif kind == "research_ask":
            self._say_then_listen(ev["text"])
        elif kind == "research_failed":
            self.mouth.say(f"Research job {ev['job']} did not finish. The reason is on screen.")
        elif kind == "job_failed":
            self.mouth.say(f"Background job {ev['job']} did not finish.")

    def _say_then_listen(self, text: str) -> None:
        """Speak, then listen for the answer without needing the wake word."""
        self.listen_after_speech = True
        self.mouth.say(text)

    def _speaking_changed(self, speaking: bool) -> None:
        if not speaking and self.listen_after_speech:
            self.listen_after_speech = False
            if self.mic is not None:
                self.ears.listen_now()
                return
        if self.ears.mode == "idle":      # don't overwrite "Listening..." on screen
            self._state("speaking" if speaking else "idle")

    def _first_audio(self, t_audio: float) -> None:
        t, self.timing = self.timing, None
        if not t or "t_first_text" not in t:
            return
        ms = lambda a, b: int((b - a) * 1000)
        row = {
            "source": t["source"], "heard": t["heard"],
            "wait_for_silence_ms": ms(t["t_stop"], t["t_endpoint"]),
            "speech_to_text_ms": ms(t["t_endpoint"], t["t_stt_done"]),
            "brain_first_sentence_ms": ms(t["t_stt_done"], t["t_first_text"]),
            "voice_ms": ms(t["t_first_text"], t_audio),
            "stop_to_first_word_ms": ms(t["t_stop"], t_audio),
        }
        self.to_ui({"type": "voice_timing", **row})
        try:
            path = settings.LOGS / f"voice-{datetime.now().strftime('%Y-%m-%d')}.csv"
            new = not path.exists()
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if new:
                    w.writerow(TIMING_COLUMNS)
                w.writerow([datetime.now().strftime("%H:%M:%S")]
                           + [row[c] for c in TIMING_COLUMNS[1:]])
        except OSError:
            pass
