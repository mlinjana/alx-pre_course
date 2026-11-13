"""JARVIS's ears: wake word, end-of-speech detection, push-to-talk and
speech-to-text. Everything here runs on the PC; no audio leaves it."""
import re
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np

RATE = 16000                 # samples per second used by every listening model
KWS_DIR = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
KWS_PREFIX = "epoch-12-avg-2-chunk-16-left-64.onnx"

# What the transcript may start with when the wake word was heard. Whisper
# sometimes spells the name differently, so a few near-misses are accepted.
_WAKE = re.compile(r"^.{0,40}?\b(?:hey[,\s]+)?(?:jarvis|jervis|jarvas|javis|jarvus)\b[\s,.!?:;-]*",
                   re.I | re.S)
STOP_PHRASES = {"stop", "stop it", "stop talking", "please stop", "be quiet", "quiet",
                "cancel", "cancel that", "shut up", "enough", "that's enough",
                "thats enough", "never mind", "nevermind", "ok stop", "okay stop",
                "thank you stop", "silence"}


def strip_wake_word(text: str) -> str:
    return _WAKE.sub("", text.strip(), count=1).strip()


def is_stop(text: str) -> bool:
    return re.sub(r"[^a-z' ]", "", text.lower()).strip() in STOP_PHRASES


class Ears:
    """Feed it microphone audio with feed(); it calls on_event with:
       {"type": "wake"}                      the wake word was heard
       {"type": "listening", "source": ...}  now recording a request
       {"type": "utterance", "audio", "speech_end", "endpoint", "source"}
       {"type": "silence"}                   nothing was said after the wake word
       {"type": "tap"}                       hotkey pressed and released at once
    speech_end / endpoint are clock times (time.time())."""

    def __init__(self, models_dir: Path, cfg: dict, on_event):
        import sherpa_onnx  # imported here so text chat works without it
        self.sherpa = sherpa_onnx
        self.on_event = on_event
        self.lock = threading.RLock()
        self.end_silence = float(cfg.get("end_silence_seconds", 0.6))
        self.wait_for_speech = float(cfg.get("wait_for_speech_seconds", 6))
        self.max_seconds = float(cfg.get("max_request_seconds", 30))
        self.wake_enabled = True

        kws = models_dir / "kws" / KWS_DIR
        keywords = models_dir / "kws" / "keywords.txt"
        # The wake word written as the model's sound pieces: "JARVIS".
        keywords.write_text("▁JA R VI S @JARVIS\n", encoding="utf-8")
        self.spotter = sherpa_onnx.KeywordSpotter(
            tokens=str(kws / "tokens.txt"),
            encoder=str(kws / f"encoder-{KWS_PREFIX}"),
            decoder=str(kws / f"decoder-{KWS_PREFIX}"),
            joiner=str(kws / f"joiner-{KWS_PREFIX}"),
            keywords_file=str(keywords),
            num_threads=1,
            keywords_score=float(cfg.get("wake_word_boost", 1.0)),
            keywords_threshold=float(cfg.get("wake_word_threshold", 0.25)),
        )
        self.kws_stream = self.spotter.create_stream()
        self.vad_model = str(models_dir / "silero_vad.onnx")
        self.vad = None

        self.pre = deque()            # the last ~1.5 s of audio, kept while idle
        self.pre_len = 0
        self.mode = "idle"            # idle | listening | held
        self.buf: list[np.ndarray] = []
        self.buf_len = 0
        self.preroll = 0              # samples in buf that came from before the wake word
        self.source = "wake"
        self.heard_speech = False

    # ---- helpers ---------------------------------------------------------
    def _new_vad(self):
        cfg = self.sherpa.VadModelConfig()
        cfg.silero_vad.model = self.vad_model
        cfg.silero_vad.min_silence_duration = self.end_silence
        cfg.silero_vad.min_speech_duration = 0.15
        cfg.sample_rate = RATE
        return self.sherpa.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)

    def _start_listening(self, source: str, with_preroll: bool) -> None:
        self.mode, self.source, self.heard_speech = "listening", source, False
        self.vad = self._new_vad()
        self.buf = list(self.pre) if with_preroll else []
        self.buf_len = sum(len(f) for f in self.buf)
        self.preroll = self.buf_len
        for f in self.buf:
            self.vad.accept_waveform(f)
        self.on_event({"type": "listening", "source": source})

    def _to_idle(self) -> None:
        self.mode = "idle"
        self.buf, self.buf_len = [], 0
        self.pre.clear()
        self.pre_len = 0
        self.kws_stream = self.spotter.create_stream()

    # ---- controls --------------------------------------------------------
    def listen_now(self) -> None:
        """Record a request straight away (used after 'Jarvis' said on its own)."""
        with self.lock:
            if self.mode == "idle":
                self._start_listening("wake", with_preroll=False)

    def ptt_down(self) -> None:
        with self.lock:
            if self.mode == "held":
                return
            self.mode, self.source = "held", "hotkey"
            self.buf, self.buf_len = [], 0
            self.on_event({"type": "listening", "source": "hotkey"})

    def ptt_up(self) -> None:
        with self.lock:
            if self.mode != "held":
                return
            now = time.time()
            audio = np.concatenate(self.buf) if self.buf else np.zeros(0, np.float32)
            self._to_idle()
        if len(audio) < 0.35 * RATE:
            self.on_event({"type": "tap"})
        else:
            self.on_event({"type": "utterance", "audio": audio, "speech_end": now,
                           "endpoint": now, "source": "hotkey"})

    # ---- audio in --------------------------------------------------------
    def feed(self, frame: np.ndarray, now: float) -> None:
        """frame: mono float32 at 16 kHz. now: clock time at the end of the frame."""
        auto_release = False
        with self.lock:
            if self.mode == "idle":
                self._feed_idle(frame)
            elif self.mode == "held":
                self.buf.append(frame)
                self.buf_len += len(frame)
                auto_release = self.buf_len > self.max_seconds * RATE
            else:
                self._feed_listening(frame, now)
        if auto_release:
            self.ptt_up()

    def _feed_idle(self, frame: np.ndarray) -> None:
        self.pre.append(frame)
        self.pre_len += len(frame)
        while self.pre_len - len(self.pre[0]) > 1.5 * RATE:
            self.pre_len -= len(self.pre.popleft())
        if not self.wake_enabled:
            return
        self.kws_stream.accept_waveform(RATE, frame)
        while self.spotter.is_ready(self.kws_stream):
            self.spotter.decode_stream(self.kws_stream)
            if self.spotter.get_result(self.kws_stream):
                self.spotter.reset_stream(self.kws_stream)
                self.on_event({"type": "wake"})
                self._start_listening("wake", with_preroll=True)
                return

    def _feed_listening(self, frame: np.ndarray, now: float) -> None:
        self.buf.append(frame)
        self.buf_len += len(frame)
        self.vad.accept_waveform(frame)
        if self.vad.is_speech_detected():
            self.heard_speech = True
        too_long = self.buf_len - self.preroll > self.max_seconds * RATE
        if too_long:
            self.vad.flush()
        while not self.vad.empty():
            seg = self.vad.front
            start, end = seg.start, seg.start + len(seg.samples)
            self.vad.pop()
            # Speech that finished well before the wake word is not the request.
            if end < self.preroll - 0.8 * RATE:
                continue
            audio = np.concatenate(self.buf)
            a = max(0, start - int(0.25 * RATE))
            b = min(len(audio), end + int(0.2 * RATE))
            speech_end = now - (self.buf_len - end) / RATE
            source = self.source
            self._to_idle()
            self.on_event({"type": "utterance", "audio": audio[a:b],
                           "speech_end": speech_end, "endpoint": now, "source": source})
            return
        waited = (self.buf_len - self.preroll) / RATE
        if too_long or (not self.heard_speech and waited > self.wait_for_speech):
            self._to_idle()
            self.on_event({"type": "silence"})


class Transcriber:
    """Speech-to-text with faster-whisper (a Whisper-based library)."""

    def __init__(self, models_dir: Path, cfg: dict):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(
            cfg.get("whisper_model", "base.en"), device="cpu", compute_type="int8",
            download_root=str(models_dir / "whisper"))
        self.transcribe(np.zeros(RATE, np.float32))  # warm up so the first request is fast

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _info = self.model.transcribe(
            audio, language="en", beam_size=1, condition_on_previous_text=False,
            without_timestamps=True, hotwords="Jarvis")
        return " ".join(s.text.strip() for s in segments).strip()


class Microphone:
    """Reads the default microphone and passes 16 kHz audio to callback(frame, now)."""

    def __init__(self, callback):
        import sounddevice as sd
        self.callback = callback
        self.step = 1.0
        try:
            self.stream = sd.InputStream(samplerate=RATE, channels=1, dtype="float32",
                                         blocksize=512, callback=self._on_audio)
        except Exception:
            # Some sound cards refuse 16 kHz: use their own rate and convert.
            rate = int(sd.query_devices(kind="input")["default_samplerate"])
            self.step = rate / RATE
            self.stream = sd.InputStream(samplerate=rate, channels=1, dtype="float32",
                                         blocksize=int(0.032 * rate), callback=self._on_audio)
        self.stream.start()

    def _on_audio(self, indata, frames, time_info, status) -> None:
        mono = indata[:, 0]
        if self.step != 1.0:
            n = int(len(mono) / self.step)
            mono = np.interp(np.arange(n) * self.step, np.arange(len(mono)), mono)
        self.callback(mono.astype(np.float32), time.time())

    def close(self) -> None:
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass
