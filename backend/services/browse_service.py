import aiosqlite
from typing import List, Dict, Any, Optional, Union
from backend.models.schemas import BrowseResponse, AggregateResult, ItemResult, RepresentativeThumb
from backend.services.tag_service import get_matching_media_ids
from backend.services.media_service import get_media_item
import logging

logger = logging.getLogger(__name__)

async def browse_media(
    db: aiosqlite.Connection,
    filter_pattern: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    aggregate_threshold: int = 1,
    media_type: Optional[str] = None,
    sort_by: str = "creation_date",
    sort_dir: str = "desc"
) -> BrowseResponse:
    matching_ids, media_next_seg, media_all_tags, group_parent = await get_matching_media_ids(db, filter_pattern, media_type)

    total_cursor = await db.execute("SELECT COUNT(*) FROM media")
    total_row = await total_cursor.fetchone()
    total_library_items = total_row[0] if total_row else 0

    # Group by next segment
    groups: Dict[str, List[str]] = {}
    direct_items: List[str] = []

    for mid in matching_ids:
        n_seg = media_next_seg.get(mid)
        if n_seg is None:
            direct_items.append(mid)
        else:
            if n_seg not in groups:
                groups[n_seg] = []
            groups[n_seg].append(mid)

    results: List[Union[AggregateResult, ItemResult]] = []

    # Process groups
    for seg_label, group_mids in groups.items():
        if len(group_mids) >= aggregate_threshold:
            # Create aggregate card
            # Find representative item (first one or most recent)
            rep_id = group_mids[0]
            rep_item = await get_media_item(db, rep_id)
            rep_thumb = None
            if rep_item:
                rep_thumb = RepresentativeThumb(
                    id=rep_item.id,
                    thumb_url=rep_item.thumb_url or "",
                    media_type=rep_item.media_type
                )

            # Build full_filter for drill-down
            if not filter_pattern or filter_pattern == "All":
                full_filter = seg_label
            else:
                parent = group_parent.get(seg_label)
                tokens = filter_pattern.split()
                new_tokens = []
                replaced = False
                for tok in tokens:
                    clean_tok = tok[1:] if tok.startswith('+') or tok.startswith('-') or tok.startswith('~') else tok
                    if clean_tok.lower() == "orphan" or clean_tok.lower().startswith("orphan."):
                        continue
                    if parent and clean_tok == parent and not replaced:
                        if tok.startswith('+'):
                            new_tokens.append(f"+{parent}.{seg_label}")
                        else:
                            new_tokens.append(f"{parent}.{seg_label}")
                        replaced = True
                    else:
                        new_tokens.append(tok)
                if not replaced:
                    if not new_tokens:
                        full_filter = seg_label
                    else:
                        full_filter = " ".join(new_tokens) + f" {seg_label}"
                else:
                    full_filter = " ".join(new_tokens)

            results.append(AggregateResult(
                label=seg_label,
                full_filter=full_filter,
                count=len(group_mids),
                representative=rep_thumb,
                item_ids=group_mids
            ))
        else:
            # Threshold not met, show items directly
            direct_items.extend(group_mids)

    # Sort aggregates by label alphabetically
    results.sort(key=lambda x: x.label.lower() if isinstance(x, AggregateResult) else "")

    has_aggregates = any(isinstance(r, AggregateResult) for r in results)

    # Process direct items ONLY when no Tag Groups are being displayed in this set
    if not has_aggregates:
        # Fetch full media items for direct_items
        direct_media_items = []
        for mid in direct_items:
            item = await get_media_item(db, mid)
            if item:
                direct_media_items.append(item)

        # Sort direct items
        reverse = (sort_dir.lower() == "desc")
        if sort_by == "asciibetical":
            direct_media_items.sort(key=lambda x: (x.filename or "").lower(), reverse=reverse)
        elif sort_by == "modification_date":
            direct_media_items.sort(key=lambda x: x.modified_at or x.created_at or "", reverse=reverse)
        elif sort_by == "file_size":
            direct_media_items.sort(key=lambda x: x.file_size or 0, reverse=reverse)
        elif sort_by == "pixel_count":
            direct_media_items.sort(key=lambda x: (x.width or 0) * (x.height or 0), reverse=reverse)
        elif sort_by == "duration":
            direct_media_items.sort(key=lambda x: x.duration_ms or 0, reverse=reverse)
        elif sort_by == "tag_count":
            direct_media_items.sort(key=lambda x: len(x.tags) if x.tags else 0, reverse=reverse)
        elif sort_by == "random":
            import random
            random.shuffle(direct_media_items)
        else: # default creation_date
            direct_media_items.sort(key=lambda x: x.created_at or "", reverse=reverse)

        for item in direct_media_items:
            results.append(ItemResult(media=item))

    total_items = len(results)

    # Pagination: When going into a leaf tag (no tag groups displayed, specific tag active), remove any caps
    if not has_aggregates and filter_pattern and filter_pattern != "All":
        paginated_results = results
        limit = max(total_items, 1)
    else:
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_results = results[start_idx:end_idx]

    return BrowseResponse(
        filter=filter_pattern,
        total_items=total_items,
        total_library_items=total_library_items,
        page=page,
        limit=limit,
        results=paginated_results
    )
