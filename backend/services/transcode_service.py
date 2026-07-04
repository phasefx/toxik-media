import asyncio
import os
import time
import logging
import uuid
from pathlib import Path
from typing import List, Optional

from backend.config import settings

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv"}
AUDIO_EXTS = {".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma"}

TRANSCODE_DIR = settings.data_dir / "transcode_cache"
TRANSCODE_DIR.mkdir(parents=True, exist_ok=True)

TRANSCODE_FORMATS = {
    "image": {
        "png": {"target_ext": ".png",  "mime": "image/png"},
        "jpg":  {"target_ext": ".jpg",  "mime": "image/jpeg"},
        "webp": {"target_ext": ".webp", "mime": "image/webp"},
        "gif":  {"target_ext": ".gif",  "mime": "image/gif"},
    },
    "video": {
        "mp4":  {"target_ext": ".mp4",  "mime": "video/mp4"},
        "webm": {"target_ext": ".webm", "mime": "video/webm"},
        "gif":  {"target_ext": ".gif",  "mime": "image/gif"},
    },
    "audio": {
        "mp3":  {"target_ext": ".mp3",  "mime": "audio/mpeg"},
        "flac": {"target_ext": ".flac", "mime": "audio/flac"},
        "wav":  {"target_ext": ".wav",  "mime": "audio/wav"},
        "ogg":  {"target_ext": ".ogg",  "mime": "audio/ogg"},
    },
}

IMAGE_TO_IMAGE = {e for e in IMAGE_EXTS}
VIDEO_TO_VIDEO = {e for e in VIDEO_EXTS}
AUDIO_TO_AUDIO = {e for e in AUDIO_EXTS}


def _media_type_from_ext(ext: str) -> Optional[str]:
    ext = ext.lower()
    if ext in IMAGE_EXTS: return "image"
    if ext in VIDEO_EXTS: return "video"
    if ext in AUDIO_EXTS: return "audio"
    return None


def available_targets(source_ext: str) -> List[dict]:
    source_ext = source_ext.lower()
    mtype = _media_type_from_ext(source_ext)
    if not mtype:
        return []
    formats = TRANSCODE_FORMATS.get(mtype, {})
    results = []
    for fmt_key, fmt_info in formats.items():
        if fmt_info["target_ext"] == source_ext:
            continue
        results.append({
            "format": fmt_key,
            "target_ext": fmt_info["target_ext"],
            "mime": fmt_info["mime"],
        })
    if mtype == "video":
        for fmt_key, fmt_info in TRANSCODE_FORMATS["audio"].items():
            results.append({
                "format": fmt_key,
                "target_ext": fmt_info["target_ext"],
                "mime": fmt_info["mime"],
            })
    return results


async def transcode_file(source_path: str, target_format: str) -> str:
    source_path = str(source_path)
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source file not found: {source_path}")

    ext = Path(source_path).suffix.lower()
    mtype = _media_type_from_ext(ext)
    if not mtype:
        raise ValueError(f"Unsupported source format: {ext}")

    formats = TRANSCODE_FORMATS.get(mtype, {})
    if target_format not in formats:
        if mtype == "video" and target_format in TRANSCODE_FORMATS.get("audio", {}):
            fmt_info = TRANSCODE_FORMATS["audio"][target_format]
        else:
            raise ValueError(f"Unsupported target format '{target_format}' for source type '{mtype}'")
    else:
        fmt_info = formats[target_format]

    out_name = f"{uuid.uuid4().hex}_{Path(source_path).stem}{fmt_info['target_ext']}"
    out_path = str(TRANSCODE_DIR / out_name)

    if mtype == "image":
        await _transcode_image(source_path, out_path, target_format)
    elif mtype == "video":
        await _transcode_video(source_path, out_path, target_format)
    elif mtype == "audio":
        await _transcode_audio(source_path, out_path, target_format)

    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise RuntimeError(f"Transcoding produced empty or missing output: {out_path}")

    return out_path


async def _transcode_image(source: str, dest: str, target_format: str):
    if target_format == "gif":
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", source,
            "-vf", "fps=10,scale=320:-1:flags=lanczos",
            "-loop", "0", dest,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    else:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", source, dest,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()


async def _transcode_video(source: str, dest: str, target_format: str):
    target_ext = Path(dest).suffix.lower()
    if target_format == "gif":
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", source,
            "-vf", "fps=10,scale=320:-1:flags=lanczos",
            "-loop", "0", dest,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    elif target_format in ("mp3", "flac", "wav", "ogg"):
        acodec_map = {"mp3": "libmp3lame", "flac": "flac", "wav": "pcm_s16le", "ogg": "libvorbis"}
        codec = acodec_map.get(target_format, "copy")
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", source, "-vn", "-acodec", codec, "-q:a", "2", dest,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    else:
        vcodec_map = {"mp4": "libx264", "webm": "libvpx"}
        codec = vcodec_map.get(target_format, "libx264")
        oflag = "-movflags" if target_ext == ".mp4" else None
        args = ["ffmpeg", "-y", "-i", source, "-c:v", codec, "-c:a", "aac" if target_ext == ".mp4" else "libvorbis"]
        if oflag:
            args.extend([oflag, "+faststart"])
        args.extend(["-pix_fmt", "yuv420p", dest])
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()


async def _transcode_audio(source: str, dest: str, target_format: str):
    acodec_map = {
        "mp3": "libmp3lame",
        "flac": "flac",
        "wav": "pcm_s16le",
        "ogg": "libvorbis",
        "m4a": "aac",
        "aac": "aac",
    }
    codec = acodec_map.get(target_format, "copy")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", source, "-acodec", codec, "-q:a", "2", dest,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
