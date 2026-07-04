from fastapi import APIRouter, Depends, HTTPException, Query
import aiosqlite
from typing import List, Dict, Any
from backend.models.database import get_db
from backend.models.schemas import TagItem, TagCreate, TagRename
from backend.services.tag_service import get_all_tags, ensure_tag_exists, delete_tag, rename_tag

router = APIRouter(prefix="/api/tags", tags=["tags"])

@router.get("", response_model=List[TagItem])
async def list_tags(db: aiosqlite.Connection = Depends(get_db)):
    tags = await get_all_tags(db)
    return tags

@router.post("", response_model=Dict[str, Any])
async def create_tag(request: TagCreate, db: aiosqlite.Connection = Depends(get_db)):
    tag_id = await ensure_tag_exists(db, request.full_tag)
    await db.commit()
    return {"status": "success", "tag_id": tag_id, "full_tag": request.full_tag}

@router.put("/{tag_id}", response_model=Dict[str, Any])
async def update_tag(tag_id: int, request: TagRename, db: aiosqlite.Connection = Depends(get_db)):
    try:
        new_id = await rename_tag(db, tag_id, request.new_full_tag)
        return {"status": "success", "new_tag_id": new_id, "full_tag": request.new_full_tag}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{tag_id}")
async def remove_tag(tag_id: int, reassign_parent: bool = True, db: aiosqlite.Connection = Depends(get_db)):
    await delete_tag(db, tag_id, reassign_parent=reassign_parent)
    return {"status": "success", "deleted_id": tag_id}
