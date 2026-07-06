import logging
import subprocess
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.models.database import init_db
from backend.routers import media, tags, browse, generate, websocket, thumbs, catalogs, xr, fiction, emulation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("toxik")

try:
    GIT_COMMIT = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, check=True, timeout=5
    ).stdout.strip()
except Exception:
    GIT_COMMIT = "unknown"

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Toxik database...")
    await init_db()
    from backend.services.job_runner import start_job_runner, stop_job_runner
    start_job_runner()
    logger.info("Toxik startup complete.")
    yield
    stop_job_runner()
    logger.info("Toxik shutdown.")

app = FastAPI(
    title=settings.app_name,
    description="Hyper-fast visual data curation and tagging platform",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router)
app.include_router(tags.router)
app.include_router(browse.router)
app.include_router(generate.router)
app.include_router(websocket.router)
app.include_router(thumbs.router)
app.include_router(catalogs.router)
app.include_router(xr.router)
app.include_router(fiction.router)
app.include_router(emulation.router)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.app_name, "git_commit": GIT_COMMIT}

if __name__ == "__main__":
    import argparse
    import os
    import uvicorn

    parser = argparse.ArgumentParser(description="Toxik Backend Server")
    parser.add_argument("-d", "--data-dir", help="Path to data directory for this collection")
    parser.add_argument("-p", "--port", type=int, default=settings.port, help="Port to bind server to")
    parser.add_argument("--host", default=settings.host, help="Host interface to bind server to")
    parser.add_argument("--db-path", help="Path to SQLite database")
    parser.add_argument("-c", "--catalog", help="Name of SQLite database catalog file inside data directory (e.g. project2.db)")
    parser.add_argument("--thumb-dir", help="Path to thumbnails directory")
    parser.add_argument("--comfyui-output-dir", help="Path to ComfyUI output directory")
    parser.add_argument("--comfyui-host", default=settings.comfyui_host, help="ComfyUI hostname (default: localhost)")
    parser.add_argument("--comfyui-port", type=int, default=settings.comfyui_port, help="ComfyUI port (default: 8188)")
    parser.add_argument("--no-reload", action="store_true", help="Disable uvicorn auto-reload")

    args, _ = parser.parse_known_args()

    if args.data_dir:
        os.environ["TOXIK_DATA_DIR"] = str(args.data_dir)
    if args.port:
        os.environ["TOXIK_PORT"] = str(args.port)
    if args.host:
        os.environ["TOXIK_HOST"] = str(args.host)
    if args.db_path:
        os.environ["TOXIK_DB_PATH"] = str(args.db_path)
    if args.thumb_dir:
        os.environ["TOXIK_THUMB_DIR"] = str(args.thumb_dir)
    if args.comfyui_output_dir:
        os.environ["TOXIK_COMFYUI_OUTPUT_DIR"] = str(args.comfyui_output_dir)
    if args.comfyui_host:
        os.environ["TOXIK_COMFYUI_HOST"] = str(args.comfyui_host)
    if args.comfyui_port:
        os.environ["TOXIK_COMFYUI_PORT"] = str(args.comfyui_port)

    settings.update_from_args(
        data_dir=args.data_dir,
        db_path=args.db_path,
        thumb_dir=args.thumb_dir,
        comfyui_output_dir=args.comfyui_output_dir,
        host=args.host,
        port=args.port,
        catalog=args.catalog,
    )

    uvicorn.run("backend.main:app", host=settings.host, port=settings.port, reload=not args.no_reload)

