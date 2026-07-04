import aiosqlite
import json
import logging
from typing import Optional, Set
from pathlib import Path

logger = logging.getLogger(__name__)

async def rebuild_media_fts(db: aiosqlite.Connection):
    """Rebuild the entire FTS index from scratch."""
    try:
        await db.execute("DELETE FROM media_fts")
    except Exception:
        pass
    cursor = await db.execute("SELECT id, filename, filepath, metadata FROM media")
    rows = await cursor.fetchall()
    for row in rows:
        mid = row["id"]
        filename = row["filename"] or ""
        filepath = row["filepath"] or ""
        metadata = row["metadata"] or "{}"
        doc_content = ""
        dc = await db.execute("SELECT content FROM document_content WHERE media_id = ?", (mid,))
        dc_row = await dc.fetchone()
        if dc_row:
            doc_content = dc_row["content"] or ""
        try:
            metadata_str = json.dumps(metadata) if isinstance(metadata, dict) else str(metadata)
        except Exception:
            metadata_str = str(metadata)
        await db.execute(
            "INSERT INTO media_fts (media_id, filename, filepath, metadata, document_content) VALUES (?, ?, ?, ?, ?)",
            (mid, filename, filepath, metadata_str, doc_content)
        )
    await db.commit()
    logger.info(f"Rebuilt FTS index for {len(rows)} media items")

async def upsert_media_fts(db: aiosqlite.Connection, media_id: str, filename: str, filepath: str, metadata: str = "{}", document_content: str = ""):
    """Insert or replace an entry in the FTS index."""
    try:
        await db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    except Exception:
        pass
    try:
        metadata_str = json.dumps(metadata) if isinstance(metadata, dict) else str(metadata)
    except Exception:
        metadata_str = str(metadata)
    await db.execute(
        "INSERT INTO media_fts (media_id, filename, filepath, metadata, document_content) VALUES (?, ?, ?, ?, ?)",
        (media_id, filename, filepath, metadata_str, document_content)
    )

async def delete_media_fts(db: aiosqlite.Connection, media_id: str):
    """Remove an entry from the FTS index."""
    try:
        await db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    except Exception:
        pass

async def search_media_fts(db: aiosqlite.Connection, query: str) -> Set[str]:
    """
    Full-text search across filename, filepath, metadata, and document content.
    Returns a set of matching media IDs.
    """
    if not query or not query.strip():
        return set()
    query = query.strip()
    try:
        cursor = await db.execute(
            "SELECT media_id FROM media_fts WHERE media_fts MATCH ?",
            (query,)
        )
        rows = await cursor.fetchall()
        return {r["media_id"] for r in rows}
    except Exception as e:
        logger.warning(f"FTS query failed ('{query}'): {e}")
        return set()

async def extract_document_content(filepath: str) -> str:
    """Extract text content from a document file."""
    path = Path(filepath)
    ext = path.suffix.lower()
    try:
        if ext in (".md", ".txt", ".rst", ".html", ".htm", ".xml", ".json", ".yaml", ".yml",
                   ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".scss", ".less",
                   ".sh", ".bash", ".zsh", ".rs", ".go", ".c", ".cpp", ".h", ".hpp",
                   ".java", ".cs", ".rb", ".swift", ".kt", ".lua",
                   ".sql", ".toml", ".ini", ".cfg", ".conf", ".env", ".php", ".log"):
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        elif ext == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(filepath)
                return " ".join(page.extract_text() for page in reader.pages if page.extract_text())
            except ImportError:
                logger.debug("pypdf not available, skipping PDF text extraction")
                return ""
        elif ext == ".epub":
            try:
                import ebooklib
                from ebooklib import epub
                book = epub.read_epub(filepath)
                texts = []
                for item in book.get_items():
                    if item.get_type() == ebooklib.ITEM_DOCUMENT:
                        texts.append(item.get_content().decode("utf-8", errors="replace"))
                return " ".join(texts)
            except ImportError:
                logger.debug("ebooklib not available, skipping EPUB text extraction")
                return ""
        else:
            return ""
    except Exception as e:
        logger.warning(f"Failed to extract content from {filepath}: {e}")
        return ""
