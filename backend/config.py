import os
import re
from pathlib import Path
from typing import Optional, Union
from pydantic import model_validator
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
THUMB_DIR = DATA_DIR / "thumbs"
WORKFLOWS_DIR = BASE_DIR / "workflows"

class Settings(BaseSettings):
    app_name: str = "Toxik"
    host: str = "0.0.0.0"
    port: int = 8000
    data_dir: Path = DATA_DIR
    db_path: Optional[Path] = None
    thumb_dir: Optional[Path] = None
    workflows_dir: Path = WORKFLOWS_DIR
    max_concurrent_jobs: int = 1
    comfyui_host: str = "localhost"
    comfyui_port: int = 8188
    comfyui_workflow_dir: Optional[Path] = None
    comfyui_output_dir: Optional[Path] = None
    auto_unload: bool = True

    class Config:
        env_prefix = "TOXIK_"
        env_file = BASE_DIR / ".env"
        env_file_encoding = "utf-8"

    @model_validator(mode="after")
    def setup_paths(self):
        self.data_dir = Path(self.data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.db_path or str(self.db_path) == '.':
            self.db_path = self.data_dir / "toxik.db"
        else:
            self.db_path = Path(self.db_path).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.thumb_dir or str(self.thumb_dir) == '.':
            self.thumb_dir = self.data_dir / "thumbs"
        else:
            self.thumb_dir = Path(self.thumb_dir).resolve()
        self.thumb_dir.mkdir(parents=True, exist_ok=True)

        if not self.comfyui_output_dir or str(self.comfyui_output_dir) == '.':
            self.comfyui_output_dir = self.data_dir / "comfyui_outputs"
        else:
            self.comfyui_output_dir = Path(self.comfyui_output_dir).resolve()
        self.comfyui_output_dir.mkdir(parents=True, exist_ok=True)

        self.workflows_dir = Path(self.workflows_dir).resolve()
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        if not self.comfyui_workflow_dir or str(self.comfyui_workflow_dir) == '.':
            self.comfyui_workflow_dir = None
        else:
            self.comfyui_workflow_dir = Path(self.comfyui_workflow_dir).resolve()
        return self

    def update_from_args(
        self,
        data_dir: Optional[Union[str, Path]] = None,
        db_path: Optional[Union[str, Path]] = None,
        thumb_dir: Optional[Union[str, Path]] = None,
        comfyui_output_dir: Optional[Union[str, Path]] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        catalog: Optional[str] = None,
    ):
        if data_dir is not None:
            self.data_dir = Path(data_dir).resolve()
            self.data_dir.mkdir(parents=True, exist_ok=True)
            if not db_path and not catalog:
                self.db_path = self.data_dir / "toxik.db"
            if thumb_dir is None:
                self.thumb_dir = self.data_dir / "thumbs"
            if comfyui_output_dir is None and (self.comfyui_output_dir is None or self.comfyui_output_dir.name in ("comfyui_outputs", "comfyui_output")):
                self.comfyui_output_dir = self.data_dir / "comfyui_outputs"
        if catalog is not None and db_path is None:
            cat_name = str(catalog).strip()
            if "\0" in cat_name or any(ord(c) < 32 for c in cat_name) or re.search(r'[\\/]|(\.\.)', cat_name) or not re.match(r'^[a-zA-Z0-9_.-]+$', cat_name) or cat_name.startswith('.'):
                raise ValueError(f"Invalid catalog filename: {cat_name}")
            if not cat_name.endswith(".db"):
                cat_name += ".db"
            self.db_path = (self.data_dir / cat_name).resolve()
        if db_path is not None:
            if isinstance(db_path, str) and not db_path.strip():
                self.db_path = None
            else:
                self.db_path = Path(db_path).resolve()
        if thumb_dir is not None:
            if isinstance(thumb_dir, str) and not thumb_dir.strip():
                self.thumb_dir = None
            else:
                self.thumb_dir = Path(thumb_dir).resolve()
        if comfyui_output_dir is not None:
            if isinstance(comfyui_output_dir, str) and not comfyui_output_dir.strip():
                self.comfyui_output_dir = None
            else:
                self.comfyui_output_dir = Path(comfyui_output_dir).resolve()

        if not self.db_path:
            self.db_path = (self.data_dir if not catalog else self.db_path) / "toxik.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if self.thumb_dir:
            self.thumb_dir.mkdir(parents=True, exist_ok=True)
        if self.comfyui_output_dir:
            self.comfyui_output_dir.mkdir(parents=True, exist_ok=True)

        if host is not None:
            self.host = host
        if port is not None:
            self.port = int(port)

    def is_protected_from_ingest(self, path: Union[str, Path]) -> bool:
        """Check if a path is inside the protected data directory, while exempting ComfyUI output dirs."""
        try:
            path_res = Path(path).resolve()
            data_res = self.data_dir.resolve()

            is_inside_data = path_res.is_relative_to(data_res) if hasattr(path_res, "is_relative_to") else str(path_res).startswith(str(data_res))
            if not is_inside_data:
                return False

            exempted_dirs = [
                (self.data_dir / "comfyui_outputs").resolve(),
                (self.data_dir / "comfyui_output").resolve(),
            ]
            if self.comfyui_output_dir:
                exempted_dirs.append(Path(self.comfyui_output_dir).resolve())

            for ex_dir in exempted_dirs:
                is_exempt = path_res.is_relative_to(ex_dir) if hasattr(path_res, "is_relative_to") else str(path_res).startswith(str(ex_dir))
                if is_exempt or path_res == ex_dir:
                    return False

            return True
        except Exception:
            return False

settings = Settings()

