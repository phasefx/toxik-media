from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
import aiosqlite
from typing import List, Optional
import os
from backend.models.database import get_db
from backend.models.schemas import MediaItem, MediaImportRequest, BatchTagRequest
from backend.services.media_service import import_media, get_media_item, delete_media_item, batch_tag_media, extract_video_frame

router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("/import", response_model=List[MediaItem])
async def import_media_files(request: MediaImportRequest, db: aiosqlite.Connection = Depends(get_db)):
    items = await import_media(db, request.paths, request.tags)
    return items

@router.get("/{media_id}", response_model=MediaItem)
async def get_single_media(media_id: str, db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    return item

@router.delete("/{media_id}")
async def delete_single_media(media_id: str, delete_file: bool = False, db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    await delete_media_item(db, media_id, delete_file)
    return {"status": "success", "deleted_id": media_id}

@router.post("/batch/tags")
async def batch_tag(request: BatchTagRequest, db: aiosqlite.Connection = Depends(get_db)):
    await batch_tag_media(
        db=db,
        media_ids=request.media_ids,
        add_tags=request.add_tags,
        remove_tags=request.remove_tags,
        replace_tags=request.replace_tags,
        clear_all=request.clear_all
    )
    return {"status": "success", "updated_count": len(request.media_ids)}

@router.post("/{media_id}/extract_frame", response_model=MediaItem)
async def extract_frame_endpoint(media_id: str, mode: str = Query("first"), db: aiosqlite.Connection = Depends(get_db)):
    if mode not in ("first", "random", "last"):
        raise HTTPException(status_code=400, detail="mode must be first, random, or last")
    try:
        item = await extract_video_frame(db, media_id, mode)
        return item
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")

@router.get("/{media_id}/file")
async def serve_media_file(media_id: str, db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item or not os.path.exists(item.filepath):
        raise HTTPException(status_code=404, detail="Media file not found on disk")
    return FileResponse(
        path=item.filepath,
        media_type=item.mime_type,
        filename=item.filename
    )

