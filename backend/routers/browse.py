from fastapi import APIRouter, Depends, Query, Response
import aiosqlite
from typing import Optional
from backend.models.database import get_db
from backend.models.schemas import BrowseResponse
from backend.services.browse_service import browse_media
from backend.services.tag_service import get_matching_media_ids

router = APIRouter(prefix="/api/browse", tags=["browse"])

@router.get("", response_model=BrowseResponse)
async def browse(
    filter: Optional[str] = Query(None, description="Tag filter pattern (prefix or wildcard)"),
    view: str = Query("grid", description="View mode: grid, montage, or viewport"),
    media_type: Optional[str] = Query(None, description="Filter by media type: image or video"),
    sort_by: str = Query("creation_date", description="Sort by field"),
    sort_dir: str = Query("desc", description="Sort direction: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    threshold: int = Query(1, ge=0, description="Aggregate card threshold"),
    db: aiosqlite.Connection = Depends(get_db)
):
    res = await browse_media(db, filter_pattern=filter, page=page, limit=limit, aggregate_threshold=threshold, media_type=media_type, sort_by=sort_by, sort_dir=sort_dir)
    return res

@router.get("/playlist")
async def download_playlist(
    filter: Optional[str] = Query(None, description="Tag filter pattern"),
    media_type: Optional[str] = Query(None, description="Filter by media type: image, video, or audio"),
    db: aiosqlite.Connection = Depends(get_db)
):
    matching_ids, _, _, _ = await get_matching_media_ids(db, filter, media_type)

    if not matching_ids:
        return Response(
            content="#EXTM3U\n",
            media_type="application/vnd.apple.mpegurl",
            headers={"Content-Disposition": 'attachment; filename="playlist.m3u8"'}
        )

    cursor = await db.execute("SELECT id, filename, filepath, duration_ms FROM media ORDER BY created_at DESC")
    rows = await cursor.fetchall()

    lines = ["#EXTM3U"]
    for row in rows:
        if row["id"] in matching_ids:
            dur_ms = row["duration_ms"]
            dur = int(dur_ms / 1000) if dur_ms and dur_ms > 0 else -1
            lines.append(f"#EXTINF:{dur},{row['filename']}")
            lines.append(row["filepath"])

    content = "\n".join(lines) + "\n"
    filename = f"toxik_{filter or 'all'}.m3u8".replace(" ", "_").replace("/", "_")
    return Response(
        content=content,
        media_type="application/vnd.apple.mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

