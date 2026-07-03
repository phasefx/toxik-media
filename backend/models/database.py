import aiosqlite
import logging
from pathlib import Path
from backend.config import settings

logger = logging.getLogger(__name__)

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS media (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    filepath    TEXT NOT NULL UNIQUE,
    file_hash   TEXT,
    media_type  TEXT NOT NULL,
    mime_type   TEXT,
    width       INTEGER,
    height      INTEGER,
    duration_ms INTEGER,
    file_size   INTEGER,
    thumb_path  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_file_hash ON media(file_hash);

CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    full_tag    TEXT NOT NULL UNIQUE,
    depth       INTEGER NOT NULL,
    parent_tag  TEXT,
    FOREIGN KEY (parent_tag) REFERENCES tags(full_tag) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tag_segments (
    tag_id      INTEGER NOT NULL,
    segment     TEXT NOT NULL,
    position    INTEGER NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tag_segments_segment ON tag_segments(segment);

CREATE TABLE IF NOT EXISTS media_tags (
    media_id    TEXT NOT NULL,
    tag_id      INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_id, tag_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id          TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    inputs      TEXT NOT NULL,
    workflow_json TEXT,
    comfyui_id  TEXT,
    progress    REAL DEFAULT 0,
    output_ids  TEXT,
    error       TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

-- Future Canvas Mode 2.0 tables (prepared in advance)
CREATE TABLE IF NOT EXISTS canvases (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    tag_id      INTEGER NOT NULL,
    viewport_x  REAL DEFAULT 0,
    viewport_y  REAL DEFAULT 0,
    viewport_zoom REAL DEFAULT 1.0,
    bg_color    TEXT DEFAULT '#0a0a0a',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS canvas_items (
    canvas_id   TEXT NOT NULL,
    media_id    TEXT NOT NULL,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    width       REAL NOT NULL,
    height      REAL NOT NULL,
    z_index     INTEGER DEFAULT 0,
    rotation    REAL DEFAULT 0,
    locked      BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (canvas_id, media_id),
    FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
"""

async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(settings.db_path, timeout=30.0)
    await db.execute("PRAGMA journal_mode = WAL;")
    await db.execute("PRAGMA synchronous = NORMAL;")
    await db.execute("PRAGMA foreign_keys = ON;")
    db.row_factory = aiosqlite.Row
    return db

async def run_migrations(db: aiosqlite.Connection):
    """
    Lightweight in-place schema migrations for development.
    Checks existing tables and adds any missing columns automatically using ALTER TABLE.
    """
    expected_columns = {
        "media": [
            ("duration_ms", "INTEGER"),
            ("file_hash", "TEXT"),
            ("mime_type", "TEXT"),
            ("width", "INTEGER"),
            ("height", "INTEGER"),
            ("thumb_path", "TEXT"),
            ("metadata", "TEXT")
        ],
        "tags": [
            ("parent_tag", "TEXT")
        ],
        "canvases": [
            ("viewport_x", "REAL DEFAULT 0"),
            ("viewport_y", "REAL DEFAULT 0"),
            ("viewport_zoom", "REAL DEFAULT 1.0"),
            ("bg_color", "TEXT DEFAULT '#0a0a0a'")
        ],
        "canvas_items": [
            ("z_index", "INTEGER DEFAULT 0"),
            ("rotation", "REAL DEFAULT 0"),
            ("locked", "BOOLEAN DEFAULT FALSE")
        ],
        "generation_jobs": [
            ("workflow_json", "TEXT")
        ]
    }

    db.row_factory = aiosqlite.Row
    for table, columns in expected_columns.items():
        try:
            cursor = await db.execute(f"PRAGMA table_info({table})")
            existing_cols = {row["name"] for row in await cursor.fetchall()}
            for col_name, col_def in columns:
                if col_name not in existing_cols:
                    try:
                        await db.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")
                        logger.info(f"Migration: added column {col_name} to table {table}")
                    except Exception as e:
                        logger.warning(f"Migration warning for {table}.{col_name}: {e}")
        except Exception as e:
            logger.warning(f"Could not inspect table {table}: {e}")
    await db.commit()

async def init_db():
    async with aiosqlite.connect(settings.db_path, timeout=30.0) as db:
        await db.execute("PRAGMA journal_mode = WAL;")
        await db.execute("PRAGMA synchronous = NORMAL;")
        await db.execute("PRAGMA foreign_keys = ON;")
        for statement in CREATE_TABLES_SQL.split(";"):
            if statement.strip():
                await db.execute(statement)
        await db.commit()
        await run_migrations(db)

