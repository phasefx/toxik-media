"""Interactive Fiction stub — detect IF story files for in-browser playback.

Future: embed Parchment (Z-machine) or ink.js runtime and serve the
story content for rendering in the detail-modal.
"""

IF_EXTS = {
    ".z1", ".z2", ".z3", ".z4", ".z5", ".z6", ".z7", ".z8",
    ".zblorb", ".blorb", ".gblorb",
    ".ulx",      # Glulx
    ".gblorb",   # Glulx blorb
    ".gam",      # TADS
    ".t3",       # TADS 3
    ".ink.json", # Inkle's ink format
    ".ink",      # Ink source
}

INK_JSON_SUFFIX = ".ink.json"


def is_interactive_fiction(filepath: str) -> bool:
    low = filepath.lower()
    if low.endswith(INK_JSON_SUFFIX):
        return True
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    return f".{ext}" in IF_EXTS


def fiction_info(filepath: str) -> dict:
    low = filepath.lower()
    if low.endswith(INK_JSON_SUFFIX):
        fmt = "Ink"
    else:
        ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
        fmt_map = {
            ".z3":  "Z-machine (Z3)",
            ".z5":  "Z-machine (Z5)",
            ".z8":  "Z-machine (Z8)",
            ".zblorb": "Z-machine blorb",
            ".gblorb": "Glulx blorb",
            ".ulx":  "Glulx",
            ".gam":  "TADS",
            ".t3":   "TADS 3",
            ".ink.json": "Ink",
        }
        fmt = fmt_map.get(f".{ext}", "Unknown")
    return {
        "is_interactive_fiction": True,
        "format": fmt,
        "player_available": False,
    }
