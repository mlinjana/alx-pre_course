"""JARVIS's voice: turns the reply into speech sentence by sentence, so the
first sentence is spoken while the rest is still arriving. Uses Piper, which
runs on the PC with no internet."""
import queue
import re
import threading
import time
from pathlib import Path

import numpy as np

# Voices offered in the window. All three work offline once downloaded.
VOICES = {
    "Alan (British man)": "en_GB-alan-medium",
    "Ryan (American man)": "en_US-ryan-medium",
    "Alba (Scottish woman)": "en_GB-alba-medium",
}

_ABBREVIATIONS = ("mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "vs.", "e.g.", "i.e.", "etc.",
                  "no.", "approx.")
_BOUNDARY = re.compile(r"([.!?]+[\"')\]]*)(\s+)|(\n+)")


def clean_for_speech(text: str) -> str:
    """Remove things that sound wrong when read aloud (markdown, links)."""
    text = re.sub(r"```.*?(```|$)", " (code is shown on screen) ", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "a link", text)
    text = re.sub(r"^\s*(#{1,6}|[-*+]|\d+[.)])\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`#>|~]", "", text)
    return re.sub(r"\s+", " ", text).strip()


class SentenceSplitter:
    """Collects streamed text and hands back whole sentences as they complete."""

    def __init__(self):
        self.buf = ""

    def feed(self, text: str) -> list[str]:
        self.buf += text
        out = []
        pos = 0
        for m in _BOUNDARY.finditer(self.buf):
            piece = self.buf[pos:m.end()]
            words = piece.strip().lower().split()
            if m.group(1) and words and words[-1] in _ABBREVIATIONS:
                continue                      # "Dr." is not the end of a sentence
            if len(piece.strip()) < 3:
                continue
            out.append(piece)
            pos = m.end()
        self.buf = self.buf[pos:]
        if len(self.buf) > 240:               # a very long sentence: speak what we have
            cut = max(self.buf.rfind(", ", 0, 240), self.buf.rfind(" ", 0, 240))
            if cut > 0:
                out.append(self.buf[:cut + 1])
                self.buf = self.buf[cut + 1:]
        return [s for s in (clean_for_speech(x) for x in out) if s]

    def flush(self) -> list[str]:
        rest, self.buf = clean_for_speech(self.buf), ""
        return [rest] if rest else []


class Speaker:
    """Plays sound through the default speakers."""

    def __init__(self):
        import sounddevice as sd
        self.sd = sd
        self.stream = None
        self.rate = None
        self.lock = threading.Lock()

    def write(self, samples: np.ndarray, rate: int) -> None:
        with self.lock:
            self._write(samples, rate)

    def _write(self, samples: np.ndarray, rate: int) -> None:
        if self.stream is None or rate != self.rate:
            if self.stream is not None:
                self.stream.close()
            self.stream = self.sd.OutputStream(samplerate=rate, channels=1, dtype="int16",
                                               latency="low")
            self.stream.start()
            self.rate = rate
        self.stream.write(samples)


class Mouth:
    def __init__(self, models_dir: Path, voice_label: str, sink=None,
                 on_first_audio=None, on_state=None):
        from piper import PiperVoice
        self._PiperVoice = PiperVoice
        self.dir = models_dir / "piper"
        self.sink = sink or Speaker()
        self.on_first_audio = on_first_audio or (lambda t: None)
        self.on_state = on_state or (lambda speaking: None)
        self.voice = None
        self.voice_label = None
        self.set_voice(voice_label if voice_label in VOICES else next(iter(VOICES)))
        self.generation = 0          # goes up on every stop(); older sound is dropped
        self.first_pending = False
        self.splitter = SentenceSplitter()
        self.sentences: queue.Queue = queue.Queue()
        self.audio: queue.Queue = queue.Queue()
        self.speaking = False
        self.synth_busy = False
        self.lock = threading.Lock()
        threading.Thread(target=self._synth_loop, daemon=True).start()
        threading.Thread(target=self._play_loop, daemon=True).start()

    def available_voices(self) -> list[str]:
        return [label for label, name in VOICES.items()
                if (self.dir / f"{name}.onnx").exists()]

    def set_voice(self, label: str) -> None:
        path = self.dir / f"{VOICES[label]}.onnx"
        if not path.exists():
            raise FileNotFoundError(f"The voice '{label}' has not been downloaded.")
        voice = self._PiperVoice.load(str(path))
        list(voice.synthesize("Ready."))     # warm up so the first sentence is quick
        self.voice, self.voice_label = voice, label

    # ---- what to say -----------------------------------------------------
    def start_reply(self) -> None:
        self.stop()
        self.splitter = SentenceSplitter()
        self.first_pending = True

    def feed(self, text: str) -> None:
        for s in self.splitter.feed(text):
            self.sentences.put((self.generation, s))

    def finish(self) -> None:
        for s in self.splitter.flush():
            self.sentences.put((self.generation, s))

    def say(self, text: str) -> None:
        if self.speaking:                     # add to what is being said, don't cut it off
            self.sentences.put((self.generation, clean_for_speech(text)))
            return
        self.start_reply()
        self.first_pending = False
        self.feed(text + "\n")

    def stop(self) -> None:
        """Go quiet immediately and forget anything not yet spoken."""
        with self.lock:
            self.generation += 1
            self.splitter = SentenceSplitter()
            self.first_pending = False
        for q in (self.sentences, self.audio):
            try:
                while True:
                    q.get_nowait()
            except queue.Empty:
                pass

    # ---- background workers ----------------------------------------------
    def _synth_loop(self) -> None:
        while True:
            gen, sentence = self.sentences.get()
            if gen != self.generation:
                continue
            self.synth_busy = True
            try:
                voice = self.voice
                for chunk in voice.synthesize(sentence):
                    if gen != self.generation:
                        break
                    self.audio.put((gen, chunk.audio_int16_array, voice.config.sample_rate))
            except Exception:
                pass                          # one bad sentence must not silence the rest
            self.synth_busy = False

    def _play_loop(self) -> None:
        while True:
            try:
                gen, samples, rate = self.audio.get(timeout=0.25)
            except queue.Empty:
                if self.speaking and self.sentences.empty() and not self.synth_busy:
                    self.speaking = False
                    self.on_state(False)
                continue
            if gen != self.generation:
                continue
            if not self.speaking:
                self.speaking = True
                self.on_state(True)
            block = max(256, int(rate * 0.04))   # ~40 ms pieces so stop() is near-instant
            for i in range(0, len(samples), block):
                if gen != self.generation:
                    break
                if self.first_pending:
                    self.first_pending = False
                    self.on_first_audio(time.time())
                try:
                    self.sink.write(samples[i:i + block], rate)
                except Exception:
                    break
