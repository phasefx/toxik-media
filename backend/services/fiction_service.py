"""Interactive fiction service — detect and serve IF story files for in-browser playback."""

import json
import os

IF_EXTS = {
    ".z1", ".z2", ".z3", ".z4", ".z5", ".z6", ".z7", ".z8",
    ".zblorb", ".blorb", ".gblorb", ".blb",
    ".ulx",
    ".gam",
    ".t3",
    ".ink.json",
    ".ink",
}

INK_JSON_SUFFIX = ".ink.json"

PARCHMENT_FORMATS = {".z1", ".z2", ".z3", ".z4", ".z5", ".z6", ".z7", ".z8", ".zblorb", ".blorb", ".gblorb", ".blb", ".ulx", ".gam", ".t3"}

FORMAT_NAMES = {
    ".z1": "Z-machine", ".z2": "Z-machine", ".z3": "Z-machine",
    ".z4": "Z-machine", ".z5": "Z-machine", ".z6": "Z-machine",
    ".z7": "Z-machine", ".z8": "Z-machine",
    ".zblorb": "Z-machine",
    ".blorb": "Blorb",
    ".gblorb": "Glulx",
    ".blb": "Blorb",
    ".ulx": "Glulx",
    ".gam": "TADS",
    ".t3": "TADS 3",
    ".ink.json": "Ink",
    ".ink": "Ink",
}


def _get_key(filepath: str) -> str:
    low = filepath.lower()
    if low.endswith(INK_JSON_SUFFIX):
        return INK_JSON_SUFFIX
    _, dot, ext = low.rpartition(".")
    return f".{ext}" if dot else ""


def is_interactive_fiction(filepath: str) -> bool:
    return _get_key(filepath) in IF_EXTS


def fiction_format(filepath: str) -> str:
    return FORMAT_NAMES.get(_get_key(filepath), "Unknown")


def player_available(filepath: str) -> bool:
    key = _get_key(filepath)
    if key == INK_JSON_SUFFIX:
        return True
    if key in PARCHMENT_FORMATS:
        return True
    return False


def fiction_info(filepath: str) -> dict:
    fmt = fiction_format(filepath)
    return {
        "is_interactive_fiction": True,
        "format": fmt,
        "player_available": player_available(filepath),
    }


async def load_ink_json(filepath: str) -> dict | None:
    """Load and parse an Ink JSON story file, returning the story object."""
    if not filepath.lower().endswith(INK_JSON_SUFFIX):
        return None
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None
