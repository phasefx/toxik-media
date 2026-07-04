import aiosqlite
from typing import List, Dict, Any, Optional, Union, Set
from backend.models.schemas import BrowseResponse, AggregateResult, ItemResult, RepresentativeThumb
from backend.services.tag_service import get_matching_media_ids
from backend.services.search_service import search_media_fts
from backend.services.media_service import get_media_item
import logging

logger = logging.getLogger(__name__)

async def browse_media(
    db: aiosqlite.Connection,
    filter_pattern: Optional[str] = None,
    search_query: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    aggregate_threshold: int = 1,
    media_type: Optional[str] = None,
    sort_by: str = "creation_date",
    sort_dir: str = "desc"
) -> BrowseResponse:
    # Step 1: Tag-based matching for the chip-context filter
    tag_matching_ids, media_next_seg, media_all_tags, group_parent = await get_matching_media_ids(db, filter_pattern, media_type)

    # Step 2: Search-based matching (FTS + tag OR)
    search_matched_ids: Set[str] = set()
    if search_query and search_query.strip():
        sq = search_query.strip()
        # FTS search
        fts_ids = await search_media_fts(db, sq)
        search_matched_ids.update(fts_ids)
        # Tag matching for search query tokens (OR'ed)
        search_tokens = sq.split()
        for tok in search_tokens:
            tok_tag_ids, _, _, _ = await get_matching_media_ids(db, tok, media_type)
            search_matched_ids.update(tok_tag_ids)

    # Step 3: Combine
    if tag_matching_ids and search_matched_ids:
        matching_ids = tag_matching_ids & search_matched_ids
    elif search_matched_ids:
        matching_ids = search_matched_ids
    else:
        matching_ids = tag_matching_ids

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

    # Sort aggregates
    sort_keys = [k.strip() for k in sort_by.split(",") if k.strip()]
    sort_dirs = [d.strip() for d in sort_dir.split(",") if d.strip()]
    while len(sort_dirs) < len(sort_keys):
        sort_dirs.append(sort_dirs[-1] if sort_dirs else "desc")

    for k, d in reversed(list(zip(sort_keys, sort_dirs))):
        rev = (d.lower() == "desc")
        if k in ("tag_count", "file_size", "pixel_count", "duration"):
            results.sort(key=lambda x: x.count if isinstance(x, AggregateResult) else 0, reverse=rev)
        else:
            results.sort(key=lambda x: x.label.lower() if isinstance(x, AggregateResult) else "", reverse=rev)

    # Always process direct items so non-aggregated entries are displayed alongside tag groups
    if direct_items:
        from backend.services.media_service import get_media_items_bulk
        direct_media_items = await get_media_items_bulk(db, direct_items, media_all_tags)

        # Sort direct items with multi-column sub-sort support (stable sort in reverse order)
        def get_tag_abetical_key(item):
            if not item.tags:
                return ""
            best_tag = max(item.tags, key=lambda t: (t.count('.'), len(t), t))
            return best_tag.lower()

        for k, d in reversed(list(zip(sort_keys, sort_dirs))):
            reverse = (d.lower() == "desc")
            if k == "asciibetical":
                direct_media_items.sort(key=lambda x: (x.filename or "").lower(), reverse=reverse)
            elif k == "modification_date":
                direct_media_items.sort(key=lambda x: x.modified_at or x.created_at or "", reverse=reverse)
            elif k == "file_size":
                direct_media_items.sort(key=lambda x: x.file_size or 0, reverse=reverse)
            elif k == "pixel_count":
                direct_media_items.sort(key=lambda x: (x.width or 0) * (x.height or 0), reverse=reverse)
            elif k == "duration":
                direct_media_items.sort(key=lambda x: x.duration_ms or 0, reverse=reverse)
            elif k == "tag_count":
                direct_media_items.sort(key=lambda x: len(x.tags) if x.tags else 0, reverse=reverse)
            elif k == "tag_abetical":
                direct_media_items.sort(key=lambda x: get_tag_abetical_key(x), reverse=reverse)
            elif k == "file_extension":
                direct_media_items.sort(key=lambda x: (x.filename.rsplit('.', 1)[-1].lower() if '.' in (x.filename or '') else ''), reverse=reverse)
            elif k == "random":
                import random
                random.shuffle(direct_media_items)
            else: # default creation_date
                direct_media_items.sort(key=lambda x: x.created_at or "", reverse=reverse)

        for item in direct_media_items:
            results.append(ItemResult(media=item))

    total_items = len(results)

    # Always paginate to prevent overloading frontend DOM and network connections
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
