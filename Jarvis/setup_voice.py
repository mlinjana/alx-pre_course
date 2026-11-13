"""One-time download of the speech models into the models folder (about 350 MB).
After this, listening and speaking work without internet."""
import sys
import tarfile
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
MODELS = BASE / "models"
GITHUB = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
KWS = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"


def fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"  downloading {dest.name} ...", flush=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)


def main() -> int:
    sys.path.insert(0, str(BASE))
    import yaml
    cfg = (yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8")) or {}).get("voice", {})
    (MODELS / "kws").mkdir(parents=True, exist_ok=True)
    (MODELS / "piper").mkdir(exist_ok=True)
    (MODELS / "whisper").mkdir(exist_ok=True)

    print("1/4 Wake word model")
    if not (MODELS / "kws" / KWS / "tokens.txt").exists():
        archive = MODELS / "kws" / "kws.tar.bz2"
        fetch(f"{GITHUB}/kws-models/{KWS}.tar.bz2", archive)
        with tarfile.open(archive) as tar:
            tar.extractall(MODELS / "kws", filter="data")
        archive.unlink()

    print("2/4 End-of-speech detector")
    fetch(f"{GITHUB}/asr-models/silero_vad.onnx", MODELS / "silero_vad.onnx")

    print("3/4 Voices")
    from piper.download_voices import download_voice
    from jarvis.mouth import VOICES
    for label, name in VOICES.items():
        if not (MODELS / "piper" / f"{name}.onnx").exists():
            print(f"  downloading voice: {label} ...", flush=True)
            download_voice(name, MODELS / "piper")

    print("4/4 Speech-to-text model")
    from faster_whisper import WhisperModel
    WhisperModel(cfg.get("whisper_model", "base.en"), device="cpu", compute_type="int8",
                 download_root=str(MODELS / "whisper"))

    (MODELS / ".ready").write_text("ok", encoding="utf-8")
    print("\nVoice is set up. Start JARVIS with start_jarvis.bat.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"\nVoice setup did not finish: {type(e).__name__}: {e}")
        print("Check your internet connection and run setup_voice.bat again.")
        sys.exit(1)
