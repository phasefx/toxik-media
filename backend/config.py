import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

THUMB_DIR = DATA_DIR / "thumbs"
THUMB_DIR.mkdir(parents=True, exist_ok=True)

WORKFLOWS_DIR = BASE_DIR / "workflows"
WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)

class Settings(BaseSettings):
    app_name: str = "Toxik"
    host: str = "0.0.0.0"
    port: int = 8000
    db_path: Path = DATA_DIR / "toxik.db"
    thumb_dir: Path = THUMB_DIR
    workflows_dir: Path = WORKFLOWS_DIR
    max_concurrent_jobs: int = 1
    comfyui_host: str = "localhost"
    comfyui_port: int = 9988
    comfyui_workflow_dir: Optional[Path] = None
    auto_unload: bool = True

    class Config:
        env_prefix = "TOXIK_"

settings = Settings()
