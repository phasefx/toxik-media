"""Emulation stub — detect ROM files and prepare for in-browser emulation.

Future: embed an emscripten-based emulator (e.g. Nestuary, RetroArch WASM)
and serve the ROM + emulator core for client-side play.
"""

ROM_EXTS = {
    ".nes", ".fds", ".unf",   # NES / Famicom
    ".smc", ".sfc", ".fig",   # SNES / Super Famicom
    ".gb",  ".gbc", ".gba",   # Game Boy / Color / Advance
    ".nds",                    # Nintendo DS
    ".n64", ".z64", ".v64",   # Nintendo 64
    ".gen", ".md", ".smd",    # Genesis / Mega Drive
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
    ".3ds",                    # Nintendo 3DS
    ".psx", ".ps1",           # PlayStation
    ".p64",                    # PlayStation (PSX) — alternate
    "._p64",                   # PocketStation
    ".iso", ".cue", ".bin",   # CD-based (generic)
    ".chd",                    # Compressed Hunks of Data
    ".m3u",                    # M3U playlist (multi-disc)
}

def is_rom(filepath: str) -> bool:
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    return f".{ext}" in ROM_EXTS


def rom_info(filepath: str) -> dict:
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    system_map = {
        ".nes":  "Nintendo Entertainment System",
        ".fds":  "Famicom Disk System",
        ".smc":  "Super Nintendo",
        ".sfc":  "Super Nintendo",
        ".gb":   "Game Boy",
        ".gbc":  "Game Boy Color",
        ".gba":  "Game Boy Advance",
        ".gen":  "Sega Genesis",
        ".md":   "Sega Mega Drive",
        ".n64":  "Nintendo 64",
        ".psx":  "PlayStation",
        ".ps1":  "PlayStation",
        ".nds":  "Nintendo DS",
        ".3ds":  "Nintendo 3DS",
    }
    return {
        "is_rom": True,
        "extension": f".{ext}",
        "system": system_map.get(f".{ext}", "Unknown"),
        "emulator_available": False,
    }
