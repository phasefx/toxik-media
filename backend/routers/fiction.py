"""Interactive Fiction router — serve story info and player URLs."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from backend.config import settings
from backend.services.media_service import get_media_item
from backend.services.fiction_service import fiction_info, load_ink_json
from backend.models.database import get_db

router = APIRouter(prefix="/api/fiction", tags=["fiction"])


@router.get("/{media_id}")
async def get_fiction_info(media_id: str, db=Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media not found")
    if item.media_type != "fiction":
        raise HTTPException(status_code=400, detail="Media is not an interactive fiction story")
    info = fiction_info(item.filepath)
    result = {**info, "media_id": media_id, "filename": item.filename}

    story_url = f"{settings.public_url}/api/media/{media_id}/file/{quote(item.filename)}"
    result["story_url"] = story_url

    if info.get("player_available") and info.get("format") != "Ink":
        result["parchment_url"] = f"{settings.parchment_url}/?story={quote(story_url)}"

    fmt = info.get("format", "")
    if fmt == "Ink" and item.filepath.lower().endswith(".ink.json"):
        story = await load_ink_json(item.filepath)
        if story is not None:
            result["story_json"] = story

    return result
