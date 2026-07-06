"""Emulation service — detect ROM files and prepare for in-browser EmulatorJS play."""

from typing import Optional

from backend.config import settings

ROM_EXTS = {
    ".nes", ".fds", ".unf",   # NES / Famicom
    ".smc", ".sfc", ".fig",   # SNES / Super Famicom
    ".gb",  ".gbc", ".gba",   # Game Boy / Color / Advance
    ".nds",                    # Nintendo DS
    ".3ds",                    # Nintendo 3DS
    ".n64", ".z64", ".v64",   # Nintendo 64
    ".gen", ".md",  ".smd",   # Genesis / Mega Drive
    ".pce", ".sgx",           # PC Engine
    ".sms", ".gg",            # Master System / Game Gear
    ".ws",  ".wsc",           # WonderSwan
    ".a26", ".a78",           # Atari 2600 / 7800
    ".lnx",                    # Atari Lynx
    ".j64", ".jag",           # Atari Jaguar
    ".ngp", ".ngc",           # Neo Geo Pocket
    ".neo",                    # Neo Geo
    ".col", ".cv",            # ColecoVision
    ".int",                    # Intellivision
    ".vb",                     # Virtual Boy
    ".psx", ".ps1",           # PlayStation
    ".p64",                    # PlayStation (PSX) — alternate
    "._p64",                   # PocketStation
    ".iso", ".cue", ".bin",   # CD-based (generic)
    ".chd",                    # Compressed Hunks of Data
    ".m3u",                    # M3U playlist (multi-disc)
}


def is_rom(filepath: str) -> bool:
    parts = filepath.rsplit(".", 1)
    if len(parts) < 2:
        return False
    return f".{parts[-1].lower()}" in ROM_EXTS


def emulator_available() -> bool:
    return bool(settings.emulatorjs_url)


def rom_system(filepath: str) -> Optional[str]:
    parts = filepath.rsplit(".", 1)
    if len(parts) < 2:
        return None
    ext = f".{parts[-1].lower()}"

    system_map = {
        ".nes": "Nintendo Entertainment System",
        ".fds": "Famicom Disk System",
        ".unf": "Nintendo Entertainment System",
        ".smc": "Super Nintendo",
        ".sfc": "Super Nintendo",
        ".fig": "Super Nintendo",
        ".gb":  "Game Boy",
        ".gbc": "Game Boy Color",
        ".gba": "Game Boy Advance",
        ".nds": "Nintendo DS",
        ".3ds": "Nintendo 3DS",
        ".n64": "Nintendo 64",
        ".z64": "Nintendo 64",
        ".v64": "Nintendo 64",
        ".gen": "Sega Genesis",
        ".md":  "Sega Mega Drive",
        ".smd": "Sega Mega Drive",
        ".pce": "PC Engine",
        ".sgx": "PC Engine",
        ".sms": "Master System",
        ".gg":  "Game Gear",
        ".ws":  "WonderSwan",
        ".wsc": "WonderSwan Color",
        ".a26": "Atari 2600",
        ".a78": "Atari 7800",
        ".lnx": "Atari Lynx",
        ".j64": "Atari Jaguar",
        ".ngp": "Neo Geo Pocket",
        ".neo": "Neo Geo",
        ".col": "ColecoVision",
        ".int": "Intellivision",
        ".vb":  "Virtual Boy",
        ".psx": "PlayStation",
        ".ps1": "PlayStation",
    }
    return system_map.get(ext)


EMULATORJS_CORE_MAP = {
    ".nes": "nes",
    ".fds": "nes",
    ".unf": "nes",
    ".smc": "snes",
    ".sfc": "snes",
    ".fig": "snes",
    ".gb":  "gb",
    ".gbc": "gb",
    ".gba": "gba",
    ".nds": "nds",
    ".3ds": "3ds",
    ".n64": "n64",
    ".z64": "n64",
    ".v64": "n64",
    ".gen": "segaMD",
    ".md":  "segaMD",
    ".smd": "segaMD",
    ".pce": "pce",
    ".sgx": "pce",
    ".sms": "segaMS",
    ".gg":  "segaGG",
    ".ws":  "ws",
    ".wsc": "ws",
    ".a26": "atari2600",
    ".a78": "atari7800",
    ".lnx": "lynx",
    ".j64": "jaguar",
    ".ngp": "ngp",
    ".neo": "neo",
    ".col": "coleco",
    ".int": "intellivision",
    ".vb":  "vb",
    ".psx": "psx",
    ".ps1": "psx",
}


def emulatorjs_core(filepath: str) -> str:
    parts = filepath.rsplit(".", 1)
    if len(parts) < 2:
        return ""
    ext = f".{parts[-1].lower()}"
    return EMULATORJS_CORE_MAP.get(ext, "")


def emulation_info(filepath: str) -> dict:
    return {
        "is_rom": True,
        "system": rom_system(filepath) or "Unknown",
        "emulator_available": emulator_available(),
    }
