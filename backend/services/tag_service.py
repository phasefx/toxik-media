import aiosqlite
from typing import List, Dict, Any, Optional, Tuple, Set
from backend.models.schemas import TagItem, TagCreate
import logging

logger = logging.getLogger(__name__)

async def ensure_tag_exists(db: aiosqlite.Connection, full_tag: str) -> int:
    """
    Ensures that full_tag and all its parent prefixes exist in the database.
    Returns the tag ID of full_tag.
    """
    segments = [s.strip() for s in full_tag.split(".") if s.strip()]
    if not segments:
        raise ValueError("Invalid tag")

    current_path = ""
    last_id = -1
    for i, seg in enumerate(segments):
        parent_path = current_path if current_path else None
        current_path = f"{current_path}.{seg}" if current_path else seg
        depth = i + 1

        # Check if exists
        cursor = await db.execute("SELECT id FROM tags WHERE full_tag = ?", (current_path,))
        row = await cursor.fetchone()
        if row:
            last_id = row["id"]
        else:
            cursor = await db.execute(
                "INSERT INTO tags (full_tag, depth, parent_tag) VALUES (?, ?, ?)",
                (current_path, depth, parent_path)
            )
            last_id = cursor.lastrowid

            # Insert tag segments for indexing
            for pos, s in enumerate(current_path.split(".")):
                await db.execute(
                    "INSERT INTO tag_segments (tag_id, segment, position) VALUES (?, ?, ?)",
                    (last_id, s, pos)
                )
    await db.commit()
    return last_id

async def get_all_tags(db: aiosqlite.Connection) -> List[TagItem]:
    """
    Returns all tags with count of associated media items (including descendant tags).
    """
    cursor = await db.execute("""
        SELECT t.id, t.full_tag, t.depth, t.parent_tag,
               (SELECT COUNT(DISTINCT mt.media_id)
                FROM media_tags mt
                JOIN tags t2 ON mt.tag_id = t2.id
                WHERE t2.full_tag = t.full_tag OR t2.full_tag LIKE t.full_tag || '.%') as count
        FROM tags t
        ORDER BY t.full_tag ASC
    """)
    rows = await cursor.fetchall()
    return [TagItem(
        id=row["id"],
        full_tag=row["full_tag"],
        depth=row["depth"],
        parent_tag=row["parent_tag"],
        count=row["count"]
    ) for row in rows]

async def delete_tag(db: aiosqlite.Connection, tag_id: int, reassign_parent: bool = True):
    """
    Deletes a tag. By default, reassigns child tags to parent_tag per locked decision #10.
    """
    cursor = await db.execute("SELECT id, full_tag, parent_tag FROM tags WHERE id = ?", (tag_id,))
    row = await cursor.fetchone()
    if not row:
        return

    full_tag = row["full_tag"]
    parent_tag = row["parent_tag"]

    if reassign_parent and parent_tag:
        # Get parent ID
        p_cursor = await db.execute("SELECT id FROM tags WHERE full_tag = ?", (parent_tag,))
        p_row = await p_cursor.fetchone()
        if p_row:
            parent_id = p_row["id"]
            # Reassign media items tagged with this tag to parent tag if they aren't already
            await db.execute("""
                INSERT OR IGNORE INTO media_tags (media_id, tag_id)
                SELECT media_id, ? FROM media_tags WHERE tag_id = ?
            """, (parent_id, tag_id))

    # Delete the tag (cascade will clean up tag_segments and media_tags)
    await db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    await db.commit()

async def rename_tag(db: aiosqlite.Connection, tag_id: int, new_full_tag: str) -> int:
    """
    Renames a tag (and all its descendant tags) to new_full_tag.
    Returns the new tag ID.
    """
    new_full_tag = new_full_tag.strip()
    if not new_full_tag:
        raise ValueError("New tag name cannot be empty")

    cursor = await db.execute("SELECT id, full_tag FROM tags WHERE id = ?", (tag_id,))
    row = await cursor.fetchone()
    if not row:
        raise ValueError("Tag not found")

    old_full_tag = row["full_tag"]
    if old_full_tag == new_full_tag:
        return tag_id

    # Find old tag and all descendant tags
    cursor = await db.execute("""
        SELECT id, full_tag FROM tags
        WHERE full_tag = ? OR full_tag LIKE ? || '.%'
        ORDER BY LENGTH(full_tag) ASC
    """, (old_full_tag, old_full_tag))
    rows = await cursor.fetchall()

    target_id = -1
    for r in rows:
        t_id = r["id"]
        t_str = r["full_tag"]

        # Replace prefix
        if t_str == old_full_tag:
            updated_str = new_full_tag
        else:
            suffix = t_str[len(old_full_tag):] # starts with .
            updated_str = f"{new_full_tag}{suffix}"

        new_id = await ensure_tag_exists(db, updated_str)
        if t_id == tag_id:
            target_id = new_id

        # Move all media associations from t_id to new_id
        await db.execute("""
            INSERT OR IGNORE INTO media_tags (media_id, tag_id)
            SELECT media_id, ? FROM media_tags WHERE tag_id = ?
        """, (new_id, t_id))
        await db.execute("DELETE FROM media_tags WHERE tag_id = ?", (t_id,))

        # Delete old tag record
        await db.execute("DELETE FROM tags WHERE id = ?", (t_id,))

    await db.commit()
    return target_id

def match_tag_pattern(tag_str: str, filter_pattern: str) -> Optional[Tuple[str, Optional[str]]]:
    """
    Checks if tag_str matches filter_pattern per §2.2.
    Returns None if no match.
    Returns (matched_prefix, next_segment) if matched.
    next_segment is None if the match consumes all segments of tag_str.
    """
    if not filter_pattern or filter_pattern == "All":
        return "", tag_str.split(".")[0] if tag_str else None

    tag_segs = tag_str.split(".")
    filter_segs = filter_pattern.split(".")

    # Simple recursive matcher for pattern segments against tag segments
    def _search(t_idx: int, f_idx: int) -> Optional[int]:
        if f_idx == len(filter_segs):
            return t_idx
        if t_idx == len(tag_segs):
            # If remaining filter segments are all '**', they can match 0 segments
            if all(s == '**' for s in filter_segs[f_idx:]):
                return t_idx
            return None

        f_seg = filter_segs[f_idx]
        if f_seg == '**':
            # '**' can match 0 or more segments
            # Try matching 0 segments first, then 1, etc., returning the shortest match
            for k in range(t_idx, len(tag_segs) + 1):
                res = _search(k, f_idx + 1)
                if res is not None:
                    return res
            return None
        elif f_seg == '*' or f_seg.lower() == tag_segs[t_idx].lower():
            return _search(t_idx + 1, f_idx + 1)
        else:
            return None

    matched_end_idx = _search(0, 0)
    if matched_end_idx is None:
        return None

    matched_prefix = ".".join(tag_segs[:matched_end_idx]) if matched_end_idx > 0 else ""
    next_seg = tag_segs[matched_end_idx] if matched_end_idx < len(tag_segs) else None
    return matched_prefix, next_seg

async def get_matching_media_ids(db: aiosqlite.Connection, filter_pattern: Optional[str], media_type: Optional[str] = None) -> Tuple[Set[str], Dict[str, str], Dict[str, List[str]]]:
    """
    Finds all media IDs matching filter_pattern and optionally media_type.
    Returns:
      - matching_media_ids: set of media_id
      - media_next_segment: dict mapping media_id -> next_segment (if aggregate applicable, or None if direct item)
      - media_all_tags: dict mapping media_id -> list of all full_tag strings for that media
    """
    valid_media_ids = None
    if media_type:
        type_cursor = await db.execute("SELECT id FROM media WHERE media_type = ?", (media_type,))
        type_rows = await type_cursor.fetchall()
        valid_media_ids = {r["id"] for r in type_rows}

    cursor = await db.execute("""
        SELECT mt.media_id, t.full_tag
        FROM media_tags mt
        JOIN tags t ON mt.tag_id = t.id
    """)
    rows = await cursor.fetchall()

    media_all_tags: Dict[str, List[str]] = {}
    for row in rows:
        mid = row["media_id"]
        if valid_media_ids is not None and mid not in valid_media_ids:
            continue
        ft = row["full_tag"]
        if mid not in media_all_tags:
            media_all_tags[mid] = []
        media_all_tags[mid].append(ft)

    # If no filter or empty, return all media in database matching media_type
    if not filter_pattern or filter_pattern == "All":
        if media_type:
            all_media_cursor = await db.execute("SELECT id FROM media WHERE media_type = ?", (media_type,))
        else:
            all_media_cursor = await db.execute("SELECT id FROM media")
        all_rows = await all_media_cursor.fetchall()
        matching_ids = set()
        media_next_seg = {}
        for r in all_rows:
            mid = r["id"]
            matching_ids.add(mid)
            media_next_seg[mid] = None
        return matching_ids, media_next_seg, media_all_tags

    matching_media_ids: Set[str] = set()
    media_next_segment: Dict[str, str] = {}

    for mid, tags in media_all_tags.items():
        if valid_media_ids is not None and mid not in valid_media_ids:
            continue
        best_next_seg = None
        matched = False
        for tag_str in tags:
            res = match_tag_pattern(tag_str, filter_pattern)
            if res is not None:
                matched = True
                matched_prefix, next_seg = res
                # Prefer specific child subcategories (next_seg is not None) over generic direct parent tags
                if next_seg is not None:
                    if best_next_seg is None:
                        best_next_seg = next_seg
        if matched:
            matching_media_ids.add(mid)
            media_next_segment[mid] = best_next_seg

    return matching_media_ids, media_next_segment, media_all_tags
