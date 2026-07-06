"""Emulation router — serve ROM info and EmulatorJS play page."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from httpx import AsyncClient
from backend.config import settings
from backend.services.media_service import get_media_item
from backend.services.emulation_service import emulation_info, emulatorjs_core
from backend.models.database import get_db

router = APIRouter(prefix="/api/emulation", tags=["emulation"])

PLAY_PAGE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EmulatorJS — {name}</title>
<style>
  body, html {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }}
</style>
</head>
<body>
<div id="game"></div>
<script>
  window.EJS_player = "#game";
  window.EJS_gameName = "{name}";
  window.EJS_gameUrl = "{rom_url}";
  window.EJS_core = "{core}";
  window.EJS_pathtodata = "/api/emulation/proxy/data/";
  window.EJS_startOnLoaded = true;
  window.EJS_askBeforeExit = false;
</script>
<script src="/api/emulation/proxy/data/loader.js"></script>
</body>
</html>
"""


@router.get("/proxy/data/{rest:path}")
async def proxy_emulatorjs_data(rest: str):
    target = f"{settings.emulatorjs_url.rstrip('/')}/data/{rest}"
    async with AsyncClient() as client:
        resp = await client.get(target)
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type"),
        )


@router.get("/{media_id}")
async def get_emulation_info(media_id: str, db=Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media not found")
    if item.media_type != "game":
        raise HTTPException(status_code=400, detail="Media is not a game ROM")
    info = emulation_info(item.filepath)
    result = {**info, "media_id": media_id, "filename": item.filename}
    result["story_url"] = f"{settings.public_url}/api/media/{media_id}/file/{quote(item.filename)}"
    return result


@router.get("/{media_id}/play", response_class=HTMLResponse)
async def play_rom(media_id: str, db=Depends(get_db)):
    item = await get_media_item(db, media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media not found")
    if item.media_type != "game":
        raise HTTPException(status_code=400, detail="Media is not a game ROM")

    rom_url = f"/api/media/{media_id}/file/{quote(item.filename)}"
    core = emulatorjs_core(item.filepath) or ""

    return PLAY_PAGE.format(
        name=item.filename,
        rom_url=rom_url,
        core=core,
    )
