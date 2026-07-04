import os
import asyncio
import subprocess
import random
import shutil
from typing import Optional, List
from pathlib import Path
from PIL import Image
import aiosqlite
from backend.config import settings
from backend.routers.websocket import manager
import logging
import time

logger = logging.getLogger(__name__)

async def resolve_audio_thumbnail(media_id: str, filepath: str, db: Optional[aiosqlite.Connection] = None, force_rebuild: bool = False) -> str:
    """
    Resolves a thumbnail for an audio file based on two criteria:
    1. If there are videos or images in the same folder, randomly use one of those.
    2. Otherwise, try to re-use a thumbnail from media that has matching tags with the audio,
       with the most nested compound tags getting priority.
    """
    thumb_filename = f"{media_id}.webp"
    thumb_path = settings.thumb_dir / thumb_filename
    rel_path = f"thumbs/{thumb_filename}"

    if thumb_path.exists() and not force_rebuild:
        return rel_path

    if force_rebuild and thumb_path.exists():
        try:
            os.remove(thumb_path)
        except Exception:
            pass

    parent_dir = Path(filepath).parent
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}
    video_exts = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
    valid_exts = image_exts | video_exts

    # Criterion 1: Videos or images in the same folder (check filesystem first)
    candidates = []
    try:
        if parent_dir.exists() and parent_dir.is_dir():
            for f in parent_dir.iterdir():
                if f.is_file() and f.resolve() != Path(filepath).resolve() and f.suffix.lower() in valid_exts:
                    candidates.append(f)
    except Exception as e:
        logger.warning(f"Error scanning folder for audio thumb candidates: {e}")

    if candidates:
        chosen = random.choice(candidates)
        # Try to use existing thumbnail from DB if available
        if db is not None:
            try:
                cursor = await db.execute("SELECT id, thumb_path FROM media WHERE filepath = ?", (str(chosen),))
                row = await cursor.fetchone()
                if row and row["thumb_path"]:
                    existing_thumb = settings.thumb_dir / Path(row["thumb_path"]).name
                    if existing_thumb.exists():
                        await asyncio.to_thread(shutil.copy2, existing_thumb, thumb_path)
                        return rel_path
            except Exception:
                pass
        # Generate directly from chosen file
        try:
            if chosen.suffix.lower() in image_exts:
                await asyncio.to_thread(_process_image_thumb, str(chosen), str(thumb_path))
            elif chosen.suffix.lower() in video_exts:
                await _process_video_thumb(str(chosen), str(thumb_path))
            if thumb_path.exists():
                return rel_path
        except Exception as e:
            logger.warning(f"Failed to generate audio thumb from local file {chosen}: {e}")

    # Criterion 1 fallback: check DB for any image/video in exact same folder
    if db is not None:
        try:
            cursor = await db.execute("""
                SELECT id, filepath, thumb_path FROM media
                WHERE media_type IN ('image', 'video')
                  AND id != ?
                  AND thumb_path IS NOT NULL AND thumb_path != ''
            """, (media_id,))
            rows = await cursor.fetchall()
            db_candidates = []
            for r in rows:
                try:
                    if Path(r["filepath"]).parent.resolve() == parent_dir.resolve():
                        db_candidates.append(r)
                except Exception:
                    pass
            if db_candidates:
                chosen_row = random.choice(db_candidates)
                existing_thumb = settings.thumb_dir / Path(chosen_row["thumb_path"]).name
                if existing_thumb.exists():
                    await asyncio.to_thread(shutil.copy2, existing_thumb, thumb_path)
                    return rel_path
        except Exception as e:
            logger.warning(f"Error checking DB for same folder audio thumb: {e}")

    # Criterion 2: Try to re-use a thumbnail from media that has matching tags with the audio,
    # with the most nested compound tags getting priority.
    if db is not None:
        try:
            cursor = await db.execute("""
                SELECT m.id, m.thumb_path, MAX(t.depth) as max_depth
                FROM media m
                JOIN media_tags mt ON m.id = mt.media_id
                JOIN tags t ON mt.tag_id = t.id
                WHERE m.id != ?
                  AND m.thumb_path IS NOT NULL AND m.thumb_path != ''
                  AND mt.tag_id IN (
                      SELECT tag_id FROM media_tags WHERE media_id = ?
                  )
                GROUP BY m.id
                ORDER BY max_depth DESC
            """, (media_id, media_id))
            rows = await cursor.fetchall()
            if rows:
                best_depth = rows[0]["max_depth"]
                best_rows = [r for r in rows if r["max_depth"] == best_depth]
                chosen_row = random.choice(best_rows)
                existing_thumb = settings.thumb_dir / Path(chosen_row["thumb_path"]).name
                if existing_thumb.exists():
                    await asyncio.to_thread(shutil.copy2, existing_thumb, thumb_path)
                    return rel_path
        except Exception as e:
            logger.warning(f"Error resolving audio thumb from matching tags: {e}")

    return ""

async def resolve_missing_audio_thumbnails(db: aiosqlite.Connection, media_ids: Optional[List[str]] = None, force_rebuild: bool = False):
    """
    Attempts to resolve thumbnails for audio files that do not currently have one (or all if force_rebuild).
    """
    try:
        query = "SELECT id, filepath, thumb_path FROM media WHERE media_type = 'audio'"
        params = []
        if media_ids:
            placeholders = ",".join("?" for _ in media_ids)
            query += f" AND id IN ({placeholders})"
            params.extend(media_ids)
        if not force_rebuild:
            query += " AND (thumb_path IS NULL OR thumb_path = '')"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        for r in rows:
            rel_path = await resolve_audio_thumbnail(r["id"], r["filepath"], db=db, force_rebuild=force_rebuild)
            if rel_path:
                await db.execute("UPDATE media SET thumb_path = ? WHERE id = ?", (rel_path, r["id"]))
        await db.commit()
    except Exception as e:
        logger.warning(f"Error in resolve_missing_audio_thumbnails: {e}")

async def generate_thumbnail(filepath: str, media_id: str, media_type: str, db: Optional[aiosqlite.Connection] = None, force: bool = False, static_only: bool = False) -> str:
    """
    Generates a thumbnail for an image, video, or audio file.
    Returns the relative path to the thumbnail file (e.g. 'thumbs/{media_id}.webp').
    """
    thumb_filename = f"{media_id}.webp"
    thumb_path = settings.thumb_dir / thumb_filename
    static_path = settings.thumb_dir / f"{media_id}_static.webp"
    rel_path = f"thumbs/{thumb_filename}"

    if static_only and static_path.exists() and not force:
        return f"thumbs/{media_id}_static.webp"
    if not static_only and thumb_path.exists() and not force:
        return rel_path

    if force and thumb_path.exists():
        try:
            os.remove(thumb_path)
        except Exception:
            pass

    t0 = time.time()
    logger.info(f"[Thumbnail] Generating {media_type} thumbnail (static_only={static_only}) for ID {media_id} ({Path(filepath).name})...")
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
            if static_path != thumb_path and thumb_path.exists() and not static_path.exists():
                try:
                    shutil.copy2(thumb_path, static_path)
                except Exception:
                    pass
        elif media_type == "video":
            await _process_video_thumb(filepath, str(thumb_path), static_only=static_only)
        elif media_type == "audio":
            res = await resolve_audio_thumbnail(media_id, filepath, db=db, force_rebuild=force)
            if not res:
                return ""
            return res
        else:
            return ""

        elapsed = int((time.time() - t0) * 1000)
        ret_path = f"thumbs/{media_id}_static.webp" if (static_only and static_path.exists()) else rel_path
        logger.info(f"[Thumbnail] Success: generated {ret_path} in {elapsed}ms")
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

async def _process_video_thumb(filepath: str, dest_path: str, max_width: int = 500, static_only: bool = False):
    dest_p = Path(dest_path)
    static_dest = dest_p.with_name(f"{dest_p.stem}_static{dest_p.suffix}")

    # 1. Extract static 1-frame poster to <id>_static.webp
    if not static_dest.exists() or static_only:
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

    if static_only:
        if static_dest != dest_p and static_dest.exists() and not dest_p.exists():
            try:
                shutil.copy2(static_dest, dest_p)
            except Exception:
                pass
        return

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

