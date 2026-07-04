import os
from pathlib import Path
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse
import aiosqlite
from backend.models.database import get_db
from backend.config import settings
from backend.services.thumbnail_service import generate_thumbnail
from backend.routers.websocket import manager
import logging
import time

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/thumbs", tags=["thumbs"])

class ReingestRequest(BaseModel):
    media_ids: List[str]

@router.post("/rebuild/{media_id}")
async def rebuild_thumbnail(media_id: str, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT filepath, media_type FROM media WHERE id = ?", (media_id,))
    row = await cursor.fetchone()
    if not row:
        return Response(status_code=404, content="Media not found")

    filepath = row["filepath"]
    media_type = row["media_type"]
    if not os.path.exists(filepath):
        return Response(status_code=404, content="File not found on disk")

    thumb_filename = f"{media_id}.webp"
    thumb_path = settings.thumb_dir / thumb_filename
    if thumb_path.exists():
        try:
            os.remove(thumb_path)
        except Exception as e:
            logger.warning(f"Could not remove old thumbnail {thumb_path}: {e}")

    logger.info(f"[Thumbnail] Rebuilding thumbnail for ID {media_id} ({Path(filepath).name})...")
    rel_thumb = await generate_thumbnail(filepath, media_id, media_type, db=db, force=True)
    from backend.services.thumbnail_service import get_media_metadata
    meta = await get_media_metadata(filepath, media_type)
    from backend.services.media_service import auto_tag_media
    await auto_tag_media(db, [media_id])
    if rel_thumb and thumb_path.exists():
        await db.execute("""
            UPDATE media SET
                thumb_path = ?, width = ?, height = ?, duration_ms = ?, file_size = ?,
                created_at = COALESCE(?, created_at), modified_at = COALESCE(?, modified_at)
            WHERE id = ?
        """, (rel_thumb, meta.get("width"), meta.get("height"), meta.get("duration_ms"), meta.get("file_size"), meta.get("created_at"), meta.get("modified_at"), media_id))
        await db.commit()
        return {"status": "ok", "thumb_url": f"/thumbs/{media_id}.webp?t={int(time.time())}"}
    return Response(status_code=500, content="Failed to generate thumbnail")

@router.post("/reingest")
async def reingest_media_batch(req: ReingestRequest, db: aiosqlite.Connection = Depends(get_db)):
    from backend.services.media_service import auto_tag_media
    t_start = time.time()
    total = len(req.media_ids)
    logger.info(f"[Re-Ingest] Starting re-ingest for {total} media items...")

    try:
        await manager.broadcast({
            "type": "ingest_start",
            "status": "scanning",
            "message": f"Re-ingesting {total} displayed media items..."
        })
    except Exception:
        pass

    processed = 0
    for idx, mid in enumerate(req.media_ids, 1):
        cursor = await db.execute("SELECT filepath, media_type FROM media WHERE id = ?", (mid,))
        row = await cursor.fetchone()
        if not row: continue
        filepath = row["filepath"]
        media_type = row["media_type"]
        if not os.path.exists(filepath): continue

        if idx == 1 or idx % 10 == 0 or idx == total:
            try:
                await manager.broadcast({
                    "type": "ingest_progress",
                    "current": idx,
                    "total": total,
                    "filepath": filepath,
                    "message": f"Re-ingesting ({idx}/{total}): {Path(filepath).name}"
                })
            except Exception:
                pass

        thumb_filename = f"{mid}.webp"
        thumb_path = settings.thumb_dir / thumb_filename
        if thumb_path.exists():
            try: os.remove(thumb_path)
            except Exception: pass

        rel_thumb = await generate_thumbnail(filepath, mid, media_type, db=db, force=True)
        from backend.services.thumbnail_service import get_media_metadata
        meta = await get_media_metadata(filepath, media_type)
        if rel_thumb and thumb_path.exists():
            await db.execute("""
                UPDATE media SET
                    thumb_path = ?, width = ?, height = ?, duration_ms = ?, file_size = ?,
                    created_at = COALESCE(?, created_at), modified_at = COALESCE(?, modified_at)
                WHERE id = ?
            """, (rel_thumb, meta.get("width"), meta.get("height"), meta.get("duration_ms"), meta.get("file_size"), meta.get("created_at"), meta.get("modified_at"), mid))
        processed += 1

    await db.commit()

    # Run auto-tagging on all requested media IDs
    await auto_tag_media(db, req.media_ids)

    elapsed = int((time.time() - t_start) * 1000)
    logger.info(f"[Re-Ingest] Completed for {processed} items in {elapsed}ms.")
    try:
        await manager.broadcast({
            "type": "ingest_complete",
            "status": "done",
            "total": processed,
            "elapsed_ms": elapsed,
            "message": f"Re-ingest complete! Processed {processed} item(s) in {elapsed}ms."
        })
    except Exception:
        pass

    return {"status": "ok", "processed": processed}

@router.get("/{filename}")
async def serve_thumbnail(filename: str, db: aiosqlite.Connection = Depends(get_db)):
    thumb_path = settings.thumb_dir / filename
    if thumb_path.exists():
        return FileResponse(thumb_path)

    # On-demand thumbnail generation if missing
    if "." in filename and filename != "placeholder.webp":
        media_id = filename.rsplit(".", 1)[0].replace("_static", "")
        try:
            cursor = await db.execute("SELECT filepath, media_type FROM media WHERE id = ?", (media_id,))
            row = await cursor.fetchone()
            if row and os.path.exists(row["filepath"]):
                logger.info(f"[On-Demand Thumb] Missing thumbnail for {filename}; triggering generation for ID {media_id} ({Path(row['filepath']).name})...")
                rel_thumb = await generate_thumbnail(row["filepath"], media_id, row["media_type"], db=db)
                if rel_thumb and thumb_path.exists():
                    try:
                        await db.execute("UPDATE media SET thumb_path = ? WHERE id = ? AND (thumb_path IS NULL OR thumb_path = '')", (rel_thumb, media_id))
                        await db.commit()
                    except Exception as e:
                        logger.warning(f"Could not update db after on-demand thumb: {e}")
                    return FileResponse(thumb_path)
        except Exception as e:
            logger.error(f"On-demand thumbnail generation failed for {filename}: {e}")

    # Fallback placeholder
    placeholder = settings.thumb_dir / "placeholder.webp"
    if placeholder.exists():
        return FileResponse(placeholder)

    placeholder_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300" fill="#141720">
      <rect width="300" height="300" fill="#141720"/>
      <path d="M150 110 C130 110 115 125 115 145 C115 165 130 180 150 180 C170 180 185 165 185 145 C185 125 170 110 150 110 Z" fill="#2a2f42"/>
      <text x="50%" y="65%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#6c7293">No Preview</text>
    </svg>"""
    return Response(content=placeholder_svg, media_type="image/svg+xml")
