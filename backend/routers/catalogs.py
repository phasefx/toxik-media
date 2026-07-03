import os
import re
from pathlib import Path
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.config import settings
from backend.models.database import init_db

router = APIRouter(prefix="/api/catalogs", tags=["catalogs"])

class CatalogItem(BaseModel):
    name: str
    active: bool
    size_bytes: int
    modified_at: float

class SwitchCatalogRequest(BaseModel):
    name: str

@router.get("", response_model=List[CatalogItem])
async def list_catalogs():
    """List all database catalogs (.db files) in the data directory."""
    catalogs = []
    data_dir = settings.data_dir
    active_name = settings.db_path.name if settings.db_path else "toxik.db"

    if not data_dir.exists():
        return catalogs

    for file_path in data_dir.glob("*.db"):
        if file_path.is_file():
            stat = file_path.stat()
            catalogs.append(CatalogItem(
                name=file_path.name,
                active=(file_path.name == active_name),
                size_bytes=stat.st_size,
                modified_at=stat.st_mtime
            ))

    # Sort active catalog first, then alphabetically by name
    catalogs.sort(key=lambda c: (not c.active, c.name.lower()))
    return catalogs

@router.post("/switch", response_model=Dict[str, Any])
async def switch_catalog(request: SwitchCatalogRequest):
    """Switch the active SQLite database catalog to another file in data_dir (creating it if needed)."""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Catalog name cannot be empty")

    # Security/sanitization: ensure valid filename without path separators or traversal
    if re.search(r'[\\/]|(\.\.)', name):
        raise HTTPException(status_code=400, detail="Invalid catalog filename")

    if not name.endswith(".db"):
        name += ".db"

    new_db_path = (settings.data_dir / name).resolve()

    # Ensure it stays within data_dir
    if not str(new_db_path).startswith(str(settings.data_dir.resolve())):
        raise HTTPException(status_code=400, detail="Catalog path escaping data directory")

    settings.db_path = new_db_path

    # Initialize / migrate the database if new or schema changed
    await init_db()

    return {
        "status": "success",
        "active_catalog": name,
        "db_path": str(settings.db_path)
    }

@router.delete("/{name}", response_model=Dict[str, Any])
async def delete_catalog(name: str):
    """Delete an inactive SQLite database catalog file from data_dir."""
    name = name.strip()
    if re.search(r'[\\/]|(\.\.)', name) or not name.endswith(".db"):
        raise HTTPException(status_code=400, detail="Invalid catalog filename")

    active_name = settings.db_path.name if settings.db_path else "toxik.db"
    if name == active_name:
        raise HTTPException(status_code=400, detail="Cannot delete the currently active catalog")

    target_path = (settings.data_dir / name).resolve()
    if not str(target_path).startswith(str(settings.data_dir.resolve())):
        raise HTTPException(status_code=400, detail="Catalog path escaping data directory")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Catalog file not found")

    try:
        target_path.unlink()
        # Also clean up WAL or SHM files if they exist
        wal_path = Path(str(target_path) + "-wal")
        if wal_path.exists():
            wal_path.unlink()
        shm_path = Path(str(target_path) + "-shm")
        if shm_path.exists():
            shm_path.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete catalog file: {e}")

    return {"status": "success", "deleted": name}
