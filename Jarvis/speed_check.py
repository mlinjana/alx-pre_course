"""Voice speed check: measures the time from the end of a spoken request to
JARVIS's first spoken word, for 5 quick and 5 normal requests.

Run from the Jarvis folder:   .venv\\Scripts\\python.exe speed_check.py

So the test is repeatable, the requests are spoken by a computer voice and fed
straight into JARVIS's ears (wake word, end-of-speech detection, speech-to-text,
brains, voice) at normal speaking speed. Your microphone is not used. You will
hear the replies. It makes real API calls. Add --silent to play no sound."""
import os
import queue
import sys
import threading
import time

os.environ.setdefault("JARVIS_DRY_RUN", "1")   # never really open apps during the test

import numpy as np  # noqa: E402

from jarvis.engine import Engine  # noqa: E402
from jarvis.ears import RATE  # noqa: E402
from jarvis import voice as voice_mod  # noqa: E402

REQUESTS = [
    ("quick", "What time is it?"),
    ("quick", "Hello, how are you today?"),
    ("quick", "What is today's date?"),
    ("quick", "What is the capital of France?"),
    ("quick", "Thank you, that is all for now."),
    ("normal", "Explain in a few sentences how a home wifi router works."),
    ("normal", "Give me three tips for sleeping better."),
    ("normal", "What is the difference between a virus and a bacterium?"),
    ("normal", "Suggest a simple dinner I can make with chicken and rice."),
    ("normal", "Explain why the sky is blue."),
]


class SilentSink:
    def write(self, samples, rate):
        time.sleep(len(samples) / rate)      # take as long as real speakers would


def make_speech(text: str) -> np.ndarray:
    """Say the text with a computer voice and return it as 16 kHz audio."""
    from piper import PiperVoice
    global _test_voice
    if "_test_voice" not in globals():
        _test_voice = PiperVoice.load(str(voice_mod.MODELS / "piper" / "en_US-ryan-medium.onnx"))
    a = np.concatenate([c.audio_int16_array for c in _test_voice.synthesize(text)])
    a = a.astype(np.float32) / 32768
    n = int(len(a) * RATE / _test_voice.config.sample_rate)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


def run(silent: bool, engine=None) -> list[dict]:
    ui: queue.Queue = queue.Queue()
    holder = {}

    def from_engine(ev):
        if "voice" in holder:
            holder["voice"].on_engine_event(ev)
        ui.put(ev)

    engine = engine or Engine(from_engine)
    engine.emit = from_engine
    voice = voice_mod.Voice(engine.cfg, ui.put, engine, mic=False,
                            sink=SilentSink() if silent else None)
    holder["voice"] = voice
    rows = []
    for kind, text in REQUESTS:
        speech = make_speech("Jarvis, " + text)
        audio = np.concatenate([np.zeros(RATE // 2, np.float32), speech])
        row = {"kind": kind, "said": text, "heard": "", "brain": "", "total": None}
        state = {"done": False, "timing": None, "t_true_stop": None, "t_first": None}
        voice.mouth.on_first_audio = lambda t, s=state, v=voice: (s.update(t_first=t),
                                                                 v._first_audio(t))
        start = time.time()
        i = 0
        deadline = None
        while True:
            # feed audio at normal speaking speed, then silence
            due = start + (i + 512) / RATE
            time.sleep(max(0.0, due - time.time()))
            frame = audio[i:i + 512] if i < len(audio) else np.zeros(512, np.float32)
            if len(frame) < 512:
                frame = np.concatenate([frame, np.zeros(512 - len(frame), np.float32)])
            if i < len(audio) <= i + 512:
                state["t_true_stop"] = time.time()
                deadline = time.time() + 90
            voice.ears.feed(frame, time.time())
            i += 512
            try:
                while True:
                    ev = ui.get_nowait()
                    if ev["type"] == "heard" and not ev.get("stop"):
                        row["heard"] = ev["text"]
                        voice.request_started(True)
                        threading.Thread(target=engine.handle, args=(ev["text"], True),
                                         daemon=True).start()
                    elif ev["type"] == "voice_timing":
                        state["timing"] = ev
                    elif ev["type"] == "done":
                        row["brain"] = ev["brain"] if ev["ok"] else "FAILED"
                        state["done"] = True
                    elif ev["type"] == "error":
                        row["error"] = ev["text"]
            except queue.Empty:
                pass
            if state["done"] and "t_done" not in state:
                state["t_done"] = time.time()
            quiet = (not voice.mouth.speaking and voice.mouth.sentences.empty()
                     and voice.mouth.audio.empty())
            if "t_done" in state and quiet and time.time() - state["t_done"] > 0.8:
                break
            if deadline and time.time() > deadline:
                row["error"] = row.get("error", "timed out")
                break
        t = state["timing"]
        if t and state["t_first"]:
            row.update(total=int((state["t_first"] - state["t_true_stop"]) * 1000),
                       silence=t["wait_for_silence_ms"], stt=t["speech_to_text_ms"],
                       llm=t["brain_first_sentence_ms"], tts=t["voice_ms"])
        rows.append(row)
        print(f"  {kind:6} {text[:44]:<46} -> "
              f"{(str(row['total']) + ' ms') if row['total'] is not None else row.get('error', 'no speech')}",
              flush=True)
        time.sleep(1.0)
    return rows


def show(rows: list[dict]) -> None:
    line = "-" * 118
    print("\nAll times in milliseconds. TOTAL = end of the spoken request to JARVIS's first spoken word.")
    print(line)
    print(f"{'Type':<7}{'Request':<40}{'Brain':<22}{'Silence':>8}{'Speech':>8}{'Brain':>8}"
          f"{'Voice':>7}{'TOTAL':>8}  Heard correctly?")
    print(f"{'':<7}{'':<40}{'':<22}{'wait':>8}{'to text':>8}{'':>8}{'':>7}{'':>8}")
    print(line)
    for r in rows:
        if r["total"] is None:
            print(f"{r['kind']:<7}{r['said'][:38]:<40}{r['brain'][:20]:<22}"
                  f"  no result: {r.get('error', 'nothing was spoken')}")
            continue
        norm = lambda s: "".join(c for c in s.lower() if c.isalnum())
        same = "yes" if norm(r["heard"]) == norm(r["said"]) else f"heard: {r['heard']}"
        print(f"{r['kind']:<7}{r['said'][:38]:<40}{r['brain'][:20]:<22}{r['silence']:>8,}"
              f"{r['stt']:>8,}{r['llm']:>8,}{r['tts']:>7,}{r['total']:>8,}  {same}")
    print(line)
    for kind in ("quick", "normal"):
        got = sorted(r["total"] for r in rows if r["kind"] == kind and r["total"] is not None)
        if got:
            print(f"{kind:<7}middle value {got[len(got) // 2]:,} ms   fastest {got[0]:,}   "
                  f"slowest {got[-1]:,}   ({len(got)} of 5 measured)")


if __name__ == "__main__":
    if not voice_mod.models_ready():
        sys.exit("Voice is not set up yet. Double-click setup_voice.bat first.")
    show(run(silent="--silent" in sys.argv))
