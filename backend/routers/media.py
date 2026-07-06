from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
import aiosqlite
from typing import List, Optional
import os
from pathlib import Path
from backend.models.database import get_db
from backend.models.schemas import MediaItem, MediaImportRequest, BatchTagRequest
from backend.services.media_service import import_media, get_media_item, delete_media_item, batch_tag_media, extract_video_frame
from backend.services.transcode_service import available_targets, transcode_file

router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("/import", response_model=List[MediaItem])
async def import_media_files(request: MediaImportRequest, db: aiosqlite.Connection = Depends(get_db)):
    items = await import_media(db, request.paths, request.tags)
    return items

@router.post("/upload", response_model=List[MediaItem])
async def upload_media_files(
    tags: str = Form(""),
    files: List[UploadFile] = File(...),
    db: aiosqlite.Connection = Depends(get_db)
):
    from backend.config import settings
    import uuid

    incoming_dir = settings.data_dir / "incoming"
    incoming_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    for f in files:
        ext = Path(f.filename).suffix if f.filename else ""
        unique_name = f"{uuid.uuid4()}{ext}"
        dest = incoming_dir / unique_name
        content = await f.read()
        dest.write_bytes(content)
        saved_paths.append(str(dest))

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    items = await import_media(db, saved_paths, tag_list)
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

@router.get("/{media_id}/transcode/formats")
async def get_transcode_formats(media_id: str, db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    ext = os.path.splitext(item.filepath)[1].lower() if item.filepath else ""
    formats = available_targets(ext)
    return {"formats": formats, "source_ext": ext, "source_media_type": item.media_type}

@router.post("/{media_id}/transcode")
async def transcode_media_endpoint(
    media_id: str,
    target_format: str = Query(..., description="Target format key (e.g. mp4, webp, flac)"),
    mode: str = Query("download", description="'download' returns the file; 'import' adds it to the library"),
    db: aiosqlite.Connection = Depends(get_db),
):
    item = await get_media_item(db, media_id)
    if not item or not os.path.exists(item.filepath):
        raise HTTPException(status_code=404, detail="Media file not found on disk")
    try:
        out_path = await transcode_file(item.filepath, target_format)
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    if mode == "import":
        imported = await import_media(db, [out_path], tags=item.tags)
        if not imported:
            raise HTTPException(status_code=500, detail="Transcoding succeeded but import into library failed")
        return imported[0]

    from mimetypes import guess_type
    mime, _ = guess_type(out_path)
    return FileResponse(
        path=out_path,
        media_type=mime or "application/octet-stream",
        filename=Path(out_path).name,
        content_disposition_type="attachment",
    )

@router.get("/{media_id}/file/{rest:path}")
@router.get("/{media_id}/file")
async def serve_media_file(media_id: str, rest: str = "", db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item or not os.path.exists(item.filepath):
        raise HTTPException(status_code=404, detail="Media file not found on disk")
    return FileResponse(
        path=item.filepath,
        media_type=item.mime_type,
        filename=item.filename,
        content_disposition_type="inline"
    )
@router.post("/{media_id}/upload_comfyui")
async def upload_media_to_comfyui(media_id: str, db: aiosqlite.Connection = Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item or not os.path.exists(item.filepath):
        raise HTTPException(status_code=404, detail="Media file not found on disk")
    try:
        from backend.config import settings
        from backend.services.comfyui_service import upload_to_comfyui
        res = await upload_to_comfyui(Path(item.filepath), settings.comfyui_host, settings.comfyui_port)
        return {"status": "success", "result": res, "filename": Path(item.filepath).name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ComfyUI upload failed: {e}")
