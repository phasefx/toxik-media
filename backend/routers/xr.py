"""XR / Stereogram / VR router — stub endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from backend.services.media_service import get_media_item
from backend.models.database import get_db
from backend.services.xr_service import can_view_in_vr

router = APIRouter(prefix="/api/xr", tags=["xr"])


@router.get("/view/{media_id}")
async def view_in_vr(media_id: str, db=Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media not found")
    if not can_view_in_vr(item.media_type, item.mime_type):
        raise HTTPException(status_code=400, detail="Media type not supported for VR viewing")
    return {
        "viewer": "stub",
        "media_id": media_id,
        "message": "VR viewer coming soon.",
    }
