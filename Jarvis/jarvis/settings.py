"""Loads config.yaml, personality.md and the API key from .env."""
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE = BASE_DIR / "workspace"
LOGS = BASE_DIR / "logs"
DB_PATH = BASE_DIR / "jarvis_memory.db"

DEFAULT_PERSONALITY = (
    "You are JARVIS, a personal AI assistant. Be helpful, clear and concise."
)


class SetupProblem(Exception):
    """Something the user has to fix before JARVIS can run. Message is plain words."""


def load_config() -> dict:
    path = BASE_DIR / "config.yaml"
    if not path.exists():
        raise SetupProblem(f"I can't find config.yaml in {BASE_DIR}.")
    try:
        cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise SetupProblem(f"config.yaml has a typing mistake in it: {e}")
    for brain in ("reflex", "main", "deep"):
        if not (cfg.get("brains", {}).get(brain, {}).get("model")):
            raise SetupProblem(f"config.yaml is missing the model for the '{brain}' brain.")
    cfg.setdefault("prices", {})
    cfg.setdefault("memory", {})
    cfg.setdefault("apps", {})
    return cfg


def load_personality() -> str:
    path = BASE_DIR / "personality.md"
    if path.exists():
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    return DEFAULT_PERSONALITY


def load_api_key() -> str:
    """Read the key from .env. The key is never printed or written to a log."""
    load_dotenv(BASE_DIR / ".env")
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key or key.startswith("paste-"):
        raise SetupProblem(
            "I can't find your API key. Open the file named .env in the Jarvis "
            "folder with Notepad and put your key after ANTHROPIC_API_KEY= "
            "then start me again."
        )
    return key


def ensure_folders() -> None:
    WORKSPACE.mkdir(exist_ok=True)
    LOGS.mkdir(exist_ok=True)
