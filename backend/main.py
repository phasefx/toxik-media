import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.models.database import init_db
from backend.routers import media, tags, browse, generate, websocket, thumbs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("toxik")

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

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.app_name}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.host, port=settings.port, reload=True)
