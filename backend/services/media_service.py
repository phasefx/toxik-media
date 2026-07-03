import os
import uuid
import hashlib
import json
import asyncio
from pathlib import Path
from typing import List, Optional, Dict, Any
import aiosqlite
from backend.models.schemas import MediaItem
from backend.services.thumbnail_service import generate_thumbnail, get_media_metadata
from backend.services.tag_service import ensure_tag_exists
from backend.routers.websocket import manager
import logging
import time

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus"}

def compute_file_hash(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

async def get_media_item(db: aiosqlite.Connection, media_id: str) -> Optional[MediaItem]:
    cursor = await db.execute("SELECT * FROM media WHERE id = ?", (media_id,))
    row = await cursor.fetchone()
    if not row:
        return None

    # Get tags
    t_cursor = await db.execute("""
        SELECT t.full_tag FROM tags t
        JOIN media_tags mt ON t.id = mt.tag_id
        WHERE mt.media_id = ?
        ORDER BY t.full_tag ASC
    """, (media_id,))
    t_rows = await t_cursor.fetchall()
    tags = [r["full_tag"] for r in t_rows]

    metadata = {}
    if row["metadata"]:
        try:
            metadata = json.loads(row["metadata"])
        except Exception:
            pass

    return MediaItem(
        id=row["id"],
        filename=row["filename"],
        filepath=row["filepath"],
        file_hash=row["file_hash"],
        media_type=row["media_type"],
        mime_type=row["mime_type"],
        width=row["width"],
        height=row["height"],
        duration_ms=row["duration_ms"],
        file_size=row["file_size"],
        thumb_url=f"/thumbs/{row['id']}.webp" if row["media_type"] in ("image", "video") else None,
        created_at=str(row["created_at"]) if row["created_at"] else None,
        modified_at=str(row["modified_at"]) if row["modified_at"] else None,
        metadata=metadata,
        tags=tags
    )

def get_directory_tag(filepath: str) -> str:
    dir_path = Path(filepath).parent.resolve()
    parts = [
        p.replace(".", "_").replace(":", "").strip("/\\")
        for p in dir_path.parts
        if p not in ("/", "\\") and p.strip("/\\")
    ]
    return ".".join(parts) if parts else "root"

async def import_media(db: aiosqlite.Connection, paths: List[str], tags: List[str] = []) -> List[MediaItem]:
    t_start = time.time()
    logger.info(f"[Ingest] Starting scan of {len(paths)} target path(s)...")
    try:
        await manager.broadcast({
            "type": "ingest_start",
            "status": "scanning",
            "message": f"Scanning {len(paths)} target path(s) for media files..."
        })
    except Exception:
        pass

    files_to_import = []
    seen_paths = set()
    from backend.config import settings

    for p in paths:
        path = Path(p).resolve()
        if settings.is_protected_from_ingest(path):
            logger.info(f"[Ingest] Skipping target inside protected data directory: {path}")
            continue

        if path.is_file():
            if path.suffix.lower() in IMAGE_EXTS or path.suffix.lower() in VIDEO_EXTS or path.suffix.lower() in AUDIO_EXTS:
                fp = str(path)
                if fp not in seen_paths:
                    seen_paths.add(fp)
                    files_to_import.append(fp)
        elif path.is_dir():
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if not settings.is_protected_from_ingest(Path(root, d))]
                for file in files:
                    fpath = Path(root, file).resolve()
                    if settings.is_protected_from_ingest(fpath):
                        continue
                    ext = fpath.suffix.lower()
                    if ext in IMAGE_EXTS or ext in VIDEO_EXTS or ext in AUDIO_EXTS:
                        fp = str(fpath)
                        if fp not in seen_paths:
                            seen_paths.add(fp)
                            files_to_import.append(fp)

    total_files = len(files_to_import)
    logger.info(f"[Ingest] Found {total_files} media file(s) to process.")
    try:
        await manager.broadcast({
            "type": "ingest_progress",
            "status": "processing",
            "total": total_files,
            "message": f"Found {total_files} media file(s) to ingest."
        })
    except Exception:
        pass

    imported_ids = []
    for idx, filepath in enumerate(files_to_import, 1):
        if idx == 1 or idx % 25 == 0 or idx == total_files:
            logger.info(f"[Ingest] Processing file {idx}/{total_files}: {filepath}")
            try:
                await manager.broadcast({
                    "type": "ingest_progress",
                    "current": idx,
                    "total": total_files,
                    "filepath": filepath,
                    "message": f"Ingesting ({idx}/{total_files}): {Path(filepath).name}"
                })
            except Exception:
                pass

        # Check by filepath first
        cursor = await db.execute("SELECT id FROM media WHERE filepath = ?", (filepath,))
        existing = await cursor.fetchone()
        if existing:
            imported_ids.append((filepath, existing["id"]))
            continue

        # Compute SHA-256 for deduplication
        try:
            file_hash = await asyncio.to_thread(compute_file_hash, filepath)
        except Exception as e:
            logger.error(f"Failed to read file {filepath}: {e}")
            continue

        cursor = await db.execute("SELECT id FROM media WHERE file_hash = ?", (file_hash,))
        dup = await cursor.fetchone()
        if dup:
            # File already exists under another path or same hash
            imported_ids.append((filepath, dup["id"]))
            continue

        ext = Path(filepath).suffix.lower()
        if ext in IMAGE_EXTS:
            media_type = "image"
            mime_type = f"image/{ext[1:]}"
        elif ext in VIDEO_EXTS:
            media_type = "video"
            mime_type = f"video/{ext[1:]}"
        else:
            media_type = "audio"
            mime_type = f"audio/{ext[1:]}"
        media_id = str(uuid.uuid4())
        filename = Path(filepath).name

        # Extract metadata
        meta = await get_media_metadata(filepath, media_type)

        # Generate thumbnail
        thumb_path = await generate_thumbnail(filepath, media_id, media_type)

        try:
            await db.execute("""
                INSERT INTO media (
                    id, filename, filepath, file_hash, media_type, mime_type,
                    width, height, duration_ms, file_size, thumb_path, created_at, modified_at, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                media_id, filename, filepath, file_hash, media_type, mime_type,
                meta["width"], meta["height"], meta["duration_ms"], meta["file_size"],
                thumb_path, meta.get("created_at"), meta.get("modified_at"), json.dumps({})
            ))
            await db.commit()
            imported_ids.append((filepath, media_id))

        except Exception as e:
            # If UNIQUE constraint or race condition happens, grab existing record
            cursor = await db.execute("SELECT id FROM media WHERE filepath = ? OR file_hash = ?", (filepath, file_hash))
            ex_row = await cursor.fetchone()
            if ex_row:
                imported_ids.append((filepath, ex_row["id"]))
            else:
                logger.error(f"Failed to insert media {filepath}: {e}")

    if imported_ids:
        all_imported_mids = [mid for _, mid in imported_ids]
        await auto_tag_media(db, all_imported_mids)
        if tags:
            await batch_tag_media(db, all_imported_mids, add_tags=tags)

    imported_items = []
    seen_ids = set()
    for _, mid in imported_ids:
        if mid in seen_ids:
            continue
        seen_ids.add(mid)
        item = await get_media_item(db, mid)
        if item:
            imported_items.append(item)

    elapsed = int((time.time() - t_start) * 1000)
    logger.info(f"[Ingest] Completed! Imported/verified {len(imported_items)} unique item(s) in {elapsed}ms.")
    try:
        await manager.broadcast({
            "type": "ingest_complete",
            "status": "done",
            "total": len(imported_items),
            "elapsed_ms": elapsed,
            "message": f"Ingest complete! Processed {len(imported_items)} item(s) in {elapsed}ms."
        })
    except Exception:
        pass

    return imported_items

async def extract_video_frame(db: aiosqlite.Connection, media_id: str, mode: str) -> MediaItem:
    """Extract first, random, or last frame from a video file and import it with parent's tags."""
    import random
    item = await get_media_item(db, media_id)
    if not item or not os.path.exists(item.filepath):
        raise FileNotFoundError("Media file not found on disk.")
    if item.media_type != "video":
        raise ValueError("Media item must be a video.")

    parent_dir = Path(item.filepath).parent
    base_name = Path(item.filepath).stem
    out_name = f"{base_name}_frame_{mode}_{int(time.time()*1000)}.jpg"

    try:
        if not os.access(parent_dir, os.W_OK):
            raise PermissionError()
        out_path = parent_dir / out_name
    except Exception:
        from backend.config import settings
        fallback_dir = settings.data_dir / "extracted_frames"
        fallback_dir.mkdir(parents=True, exist_ok=True)
        out_path = fallback_dir / out_name

    out_str = str(out_path)

    if mode == "first":
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", item.filepath, "-vframes", "1", "-q:v", "2", out_str,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        await proc.wait()
    elif mode == "last":
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-sseof", "-2", "-i", item.filepath, "-update", "1", "-q:v", "2", out_str,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        await proc.wait()
        if not (out_path.exists() and out_path.stat().st_size > 0):
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-i", item.filepath, "-update", "1", "-q:v", "2", out_str,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await proc.wait()
    elif mode == "random":
        dur_s = (item.duration_ms or 3000) / 1000.0
        max_seek = max(0.2, dur_s - 0.5)
        seek_s = random.uniform(0.2, max_seek)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-ss", f"{seek_s:.2f}", "-i", item.filepath, "-vframes", "1", "-q:v", "2", out_str,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        await proc.wait()
        if not (out_path.exists() and out_path.stat().st_size > 0):
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-i", item.filepath, "-vframes", "1", "-q:v", "2", out_str,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await proc.wait()

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Failed to extract {mode} frame from video.")

    imported = await import_media(db, [out_str], tags=item.tags)
    if not imported:
        raise RuntimeError("Failed to ingest extracted frame into DB.")
    return imported[0]

async def delete_media_item(db: aiosqlite.Connection, media_id: str, delete_file: bool = False):
    cursor = await db.execute("SELECT filepath, thumb_path FROM media WHERE id = ?", (media_id,))
    row = await cursor.fetchone()
    if not row:
        return

    if delete_file and row["filepath"] and os.path.exists(row["filepath"]):
        try:
            os.remove(row["filepath"])
        except Exception as e:
            logger.error(f"Failed to delete file {row['filepath']}: {e}")

    if row["thumb_path"]:
        from backend.config import settings
        # thumb_path is relative like 'thumbs/uuid.webp'
        thumb_full = Path(row["thumb_path"]) if os.path.isabs(row["thumb_path"]) else settings.data_dir / row["thumb_path"]
        thumb_file = settings.thumb_dir / f"{media_id}.webp"
        if thumb_full.exists():
            try:
                os.remove(thumb_full)
            except Exception:
                pass
        if thumb_file.exists():
            try:
                os.remove(thumb_file)
            except Exception:
                pass

    await db.execute("DELETE FROM media WHERE id = ?", (media_id,))
    await db.commit()

async def auto_tag_media(db: aiosqlite.Connection, media_ids: List[str]) -> Dict[str, List[str]]:
    """Auto-tag media items based on directory path and workflow filename matching."""
    if not media_ids:
        return {}

    from backend.services.comfyui_service import get_all_workflows_metadata
    try:
        workflows = get_all_workflows_metadata()
    except Exception as e:
        logger.warning(f"Could not load workflows for auto-tagging: {e}")
        workflows = []

    # Build workflow matchers: list of (stem_lower, alt_stem_lower, alt2_l, [tags_to_add])
    wf_matchers = []
    for w in workflows:
        w_id = w.get("id", "")
        w_name = w.get("name", w_id)
        if not w_id: continue

        tags = ["AI", w_name]
        if w_id != w_name and w_id:
            tags.append(w_id)
        for t in w.get("tags_auto", []):
            if t not in tags:
                tags.append(t)

        stem_l = w_id.lower()
        alt_l = stem_l.replace("-", "_")
        alt2_l = stem_l.replace("_", "-")
        wf_matchers.append((stem_l, alt_l, alt2_l, tags))

    # Query media items
    placeholders = ",".join("?" for _ in media_ids)
    cursor = await db.execute(f"SELECT id, filename, filepath FROM media WHERE id IN ({placeholders})", media_ids)
    rows = await cursor.fetchall()

    tag_groups: Dict[tuple, List[str]] = {}
    item_tags_map: Dict[str, List[str]] = {}

    for r in rows:
        mid = r["id"]
        fn = (r["filename"] or "").lower()
        fp = (r["filepath"] or "").lower()

        tags_to_add = set()
        dir_tag = get_directory_tag(r["filepath"])
        if dir_tag:
            tags_to_add.add(dir_tag)

        # Check workflow matching
        for stem_l, alt_l, alt2_l, w_tags in wf_matchers:
            if stem_l in fn or alt_l in fn or alt2_l in fn or stem_l in fp or alt_l in fp or alt2_l in fp:
                for t in w_tags:
                    tags_to_add.add(t)

        if tags_to_add:
            t_tuple = tuple(sorted(tags_to_add))
            if t_tuple not in tag_groups:
                tag_groups[t_tuple] = []
            tag_groups[t_tuple].append(mid)
            item_tags_map[mid] = list(t_tuple)

    for t_tuple, mids in tag_groups.items():
        await batch_tag_media(db, mids, add_tags=list(t_tuple))

    return item_tags_map

async def batch_tag_media(
    db: aiosqlite.Connection,
    media_ids: List[str],
    add_tags: Optional[List[str]] = None,
    remove_tags: Optional[List[str]] = None,
    replace_tags: Optional[Dict[str, str]] = None,
    clear_all: bool = False
):
    add_tags = add_tags or []
    remove_tags = remove_tags or []
    for mid in media_ids:
        if clear_all:
            await db.execute("DELETE FROM media_tags WHERE media_id = ?", (mid,))

        if replace_tags:
            for old_t, new_t in replace_tags.items():
                # Check if item has old_t
                c = await db.execute("""
                    SELECT t.id FROM tags t JOIN media_tags mt ON t.id = mt.tag_id
                    WHERE mt.media_id = ? AND t.full_tag = ?
                """, (mid, old_t))
                r = await c.fetchone()
                if r:
                    old_id = r["id"]
                    await db.execute("DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?", (mid, old_id))
                    new_id = await ensure_tag_exists(db, new_t)
                    await db.execute("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)", (mid, new_id))

        for rt in remove_tags:
            c = await db.execute("SELECT id FROM tags WHERE full_tag = ?", (rt,))
            r = await c.fetchone()
            if r:
                await db.execute("DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?", (mid, r["id"]))

        for at in add_tags:
            tid = await ensure_tag_exists(db, at)
            await db.execute("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)", (mid, tid))

    await db.commit()
