import os
import asyncio
import subprocess
from pathlib import Path
from PIL import Image
from backend.config import settings
from backend.routers.websocket import manager
import logging
import time

logger = logging.getLogger(__name__)

async def generate_thumbnail(filepath: str, media_id: str, media_type: str) -> str:
    """
    Generates a thumbnail for an image or video file.
    Returns the relative path to the thumbnail file (e.g. 'thumbs/{media_id}.webp').
    """
    thumb_filename = f"{media_id}.webp"
    thumb_path = settings.thumb_dir / thumb_filename
    rel_path = f"thumbs/{thumb_filename}"

    if thumb_path.exists():
        return rel_path

    t0 = time.time()
    logger.info(f"[Thumbnail] Generating {media_type} thumbnail for ID {media_id} ({Path(filepath).name})...")
    try:
        await manager.broadcast({
            "type": "thumbnail_start",
            "media_id": media_id,
            "media_type": media_type,
            "filepath": filepath,
            "message": f"Generating thumbnail for {Path(filepath).name}..."
        })
    except Exception:
        pass

    try:
        if media_type == "image":
            await asyncio.to_thread(_process_image_thumb, filepath, str(thumb_path))
        elif media_type == "video":
            await _process_video_thumb(filepath, str(thumb_path))
        else:
            return ""

        elapsed = int((time.time() - t0) * 1000)
        logger.info(f"[Thumbnail] Success: generated {rel_path} in {elapsed}ms")
        try:
            await manager.broadcast({
                "type": "thumbnail_complete",
                "media_id": media_id,
                "rel_path": rel_path,
                "elapsed_ms": elapsed,
                "message": f"Thumbnail generated in {elapsed}ms for {Path(filepath).name}"
            })
        except Exception:
            pass
        return rel_path
    except Exception as e:
        elapsed = int((time.time() - t0) * 1000)
        logger.error(f"[Thumbnail] Failed to generate thumbnail for {filepath} after {elapsed}ms: {e}")
        try:
            await manager.broadcast({
                "type": "thumbnail_error",
                "media_id": media_id,
                "filepath": filepath,
                "error": str(e),
                "message": f"Thumbnail generation failed for {Path(filepath).name}"
            })
        except Exception:
            pass
        return ""

def _process_image_thumb(filepath: str, dest_path: str, max_width: int = 500):
    with Image.open(filepath) as img:
        img = img.convert("RGB")
        width, height = img.size
        if width > max_width:
            ratio = max_width / float(width)
            new_height = int(float(height) * float(ratio))
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
        img.save(dest_path, "WEBP", quality=85)

async def _process_video_thumb(filepath: str, dest_path: str, max_width: int = 500):
    dest_p = Path(dest_path)
    static_dest = dest_p.with_name(f"{dest_p.stem}_static{dest_p.suffix}")

    # 1. Extract static 1-frame poster to <id>_static.webp
    cmd_static = [
        "ffmpeg", "-y",
        "-ss", "00:00:00.5",
        "-i", filepath,
        "-vframes", "1",
        "-vf", f"scale={max_width}:-1",
        "-c:v", "libwebp",
        "-q:v", "80",
        str(static_dest)
    ]
    process = await asyncio.create_subprocess_exec(*cmd_static, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    await process.communicate()
    if process.returncode != 0 or not static_dest.exists():
        cmd_static_fb = [
            "ffmpeg", "-y", "-i", filepath, "-vframes", "1", "-vf", f"scale={max_width}:-1", "-c:v", "libwebp", "-q:v", "80", str(static_dest)
        ]
        proc_fb = await asyncio.create_subprocess_exec(*cmd_static_fb, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc_fb.communicate()

    # 2. Generate animated WebP clip (2.5s at 8fps) as the primary thumbnail (<id>.webp)
    cmd_anim = [
        "ffmpeg", "-y",
        "-ss", "00:00:00.5",
        "-t", "2.5",
        "-i", filepath,
        "-vf", f"fps=8,scale={max_width}:-1:flags=lanczos",
        "-c:v", "libwebp",
        "-loop", "0",
        "-preset", "default",
        "-q:v", "60",
        str(dest_p)
    ]
    proc_anim = await asyncio.create_subprocess_exec(*cmd_anim, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    await proc_anim.communicate()
    if proc_anim.returncode != 0 or not dest_p.exists():
        cmd_anim_fb = [
            "ffmpeg", "-y", "-t", "2.5", "-i", filepath, "-vf", f"fps=8,scale={max_width}:-1:flags=lanczos", "-c:v", "libwebp", "-loop", "0", "-preset", "default", "-q:v", "60", str(dest_p)
        ]
        proc_anim_fb = await asyncio.create_subprocess_exec(*cmd_anim_fb, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc_anim_fb.communicate()

    # Fallback if animated generation fails: copy static thumbnail
    if not dest_p.exists() and static_dest.exists():
        import shutil
        shutil.copy2(static_dest, dest_p)

async def get_media_metadata(filepath: str, media_type: str) -> dict:
    """
    Extracts width, height, duration_ms, file_size, created_at, modified_at.
    """
    from datetime import datetime, timezone
    stat = os.stat(filepath)
    file_size = stat.st_size
    created_at = datetime.fromtimestamp(stat.st_ctime, timezone.utc).isoformat()
    modified_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
    width, height, duration_ms = None, None, None

    if media_type == "image":
        try:
            def _get_size():
                with Image.open(filepath) as img:
                    return img.size
            width, height = await asyncio.to_thread(_get_size)
        except Exception as e:
            logger.error(f"Error reading image metadata for {filepath}: {e}")
    elif media_type == "video":
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                filepath
            ]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            if process.returncode == 0:
                parts = stdout.decode().strip().split("\n")
                if len(parts) >= 2:
                    width = int(parts[0]) if parts[0].isdigit() else None
                    height = int(parts[1]) if parts[1].isdigit() else None
                if len(parts) >= 3 and parts[2] and parts[2] != "N/A":
                    try:
                        duration_ms = int(float(parts[2]) * 1000)
                    except ValueError:
                        pass
        except Exception as e:
            logger.error(f"Error reading video metadata for {filepath}: {e}")
    elif media_type == "audio":
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                filepath
            ]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            if process.returncode == 0:
                val = stdout.decode().strip()
                if val and val != "N/A":
                    try:
                        duration_ms = int(float(val) * 1000)
                    except ValueError:
                        pass
        except Exception as e:
            logger.error(f"Error reading audio metadata for {filepath}: {e}")

    return {
        "width": width,
        "height": height,
        "duration_ms": duration_ms,
        "file_size": file_size,
        "created_at": created_at,
        "modified_at": modified_at
    }

