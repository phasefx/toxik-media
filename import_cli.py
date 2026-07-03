#!/usr/bin/env python3
"""
Toxik CLI Media Importer
========================
A local-first, interactive command-line media ingestion script with real-time
progress bars, SHA-256 deduplication, automatic compound directory tagging,
signal trapping (Ctrl+C / SIGTERM), and checkpoint resumption (--resume).
"""

import sys
import os
import time
import asyncio
import argparse
import signal
import uuid
import json
from pathlib import Path
from typing import List, Dict, Set, Tuple, Optional

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).parent.resolve()))

from rich.console import Console
from rich.progress import (
    Progress, SpinnerColumn, TextColumn, BarColumn,
    TaskProgressColumn, MofNCompleteColumn,
    TimeRemainingColumn, TimeElapsedColumn
)
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint

from backend.models.database import get_db, init_db
from backend.config import settings
from backend.services.media_service import (
    IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, compute_file_hash, get_media_metadata,
    generate_thumbnail, get_directory_tag, batch_tag_media
)

console = Console()

def _get_state_file() -> Path:
    """Return the path to the temporary checkpoint file used for --resume."""
    return settings.db_path.parent / ".import_state.json"

def _save_state(index: int, files: List[str], custom_tags: List[str], rebuild_thumbs: bool,
                stats: Dict[str, int], imported_ids: List[Tuple[str, str]]):
    """Save current import progress to a checkpoint JSON file atomically."""
    state_file = _get_state_file()
    try:
        data = {
            "index": index,
            "total_files": len(files),
            "files": files,
            "custom_tags": custom_tags,
            "rebuild_thumbs": rebuild_thumbs,
            "stats": stats,
            "imported_ids": imported_ids,
            "timestamp": time.time()
        }
        temp_file = state_file.with_suffix(".tmp")
        temp_file.write_text(json.dumps(data))
        temp_file.replace(state_file)
    except Exception as e:
        console.print(f"[dim yellow]Warning: Failed to save checkpoint state: {e}[/dim yellow]")

def _clear_state():
    """Remove the checkpoint state file after a successful import session."""
    state_file = _get_state_file()
    if state_file.exists():
        try:
            os.remove(state_file)
        except Exception:
            pass

def parse_args():
    parser = argparse.ArgumentParser(
        description="Toxik CLI Media Importer - Fast local media ingestion with deduplication & compound tagging."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=[],
        help="One or more file or directory paths to scan and import. Can be omitted if --rebuild-thumbs or --resume is specified."
    )
    parser.add_argument(
        "-t", "--tag",
        action="append",
        default=[],
        dest="tags",
        help="Custom tag(s) to apply to all imported items (can be specified multiple times, e.g. -t Vacation -t Year.2026)."
    )
    parser.add_argument(
        "-r", "--rebuild-thumbs", "--regen-thumbs", "--regen",
        action="store_true",
        dest="rebuild_thumbs",
        help="Force regenerate static and animated thumbnails for matching media items, even if they already exist."
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume a previously interrupted ingestion session from where it left off."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and report what files would be imported without touching the database."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Print real-time status logs for every individual file processed."
    )
    parser.add_argument(
        "-d", "--data-dir",
        default=None,
        help="Path to the data directory (defaults to TOXIK_DATA_DIR env var or ./data)."
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the SQLite database file (overrides data-dir default)."
    )
    parser.add_argument(
        "--thumb-dir",
        default=None,
        help="Path to the thumbnails directory (overrides data-dir default)."
    )
    return parser.parse_args()

def scan_paths(paths: List[str]) -> Tuple[List[str], int, int, int]:
    files_to_import = []
    seen_paths = set()
    total_bytes_found = 0
    img_count = 0
    vid_count = 0

    data_dir_resolved = settings.data_dir.resolve()

    for p in paths:
        path = Path(p).resolve()
        if not path.exists():
            console.print(f"[yellow]⚠️  Warning: Path does not exist and will be skipped:[/yellow] [dim]{p}[/dim]")
            continue

        try:
            if path.is_relative_to(data_dir_resolved):
                console.print(f"[yellow]⚠️  Warning: Skipping target inside Toxik data directory:[/yellow] [dim]{p}[/dim]")
                continue
        except AttributeError:
            if str(path).startswith(str(data_dir_resolved)):
                console.print(f"[yellow]⚠️  Warning: Skipping target inside Toxik data directory:[/yellow] [dim]{p}[/dim]")
                continue

        targets = []
        if path.is_file():
            targets.append(path)
        elif path.is_dir():
            for root, dirs, files in os.walk(path):
                try:
                    dirs[:] = [d for d in dirs if not Path(root, d).resolve().is_relative_to(data_dir_resolved)]
                except AttributeError:
                    dirs[:] = [d for d in dirs if not str(Path(root, d).resolve()).startswith(str(data_dir_resolved))]
                for file in files:
                    fpath = Path(root, file).resolve()
                    try:
                        if fpath.is_relative_to(data_dir_resolved):
                            continue
                    except AttributeError:
                        if str(fpath).startswith(str(data_dir_resolved)):
                            continue
                    targets.append(fpath)

        for fpath in targets:
            ext = fpath.suffix.lower()
            if ext in IMAGE_EXTS or ext in VIDEO_EXTS or ext in AUDIO_EXTS:
                fp = str(fpath)
                if fp not in seen_paths:
                    seen_paths.add(fp)
                    files_to_import.append(fp)
                    try:
                        total_bytes_found += fpath.stat().st_size
                    except Exception:
                        pass
                    if ext in IMAGE_EXTS:
                        img_count += 1
                    elif ext in VIDEO_EXTS:
                        vid_count += 1

    return files_to_import, img_count, vid_count, total_bytes_found

async def _rebuild_item_thumb(db, filepath: str, media_id: str, media_type: str = None) -> bool:
    if not media_type:
        ext = Path(filepath).suffix.lower()
        if ext in IMAGE_EXTS: media_type = "image"
        elif ext in VIDEO_EXTS: media_type = "video"
        else: media_type = "audio"

    thumb_p = settings.thumb_dir / f"{media_id}.webp"
    static_p = settings.thumb_dir / f"{media_id}_static.webp"
    if thumb_p.exists():
        try: os.remove(thumb_p)
        except Exception: pass
    if static_p.exists():
        try: os.remove(static_p)
        except Exception: pass

    rel_thumb = await generate_thumbnail(filepath, media_id, media_type)
    if rel_thumb:
        await db.execute("UPDATE media SET thumb_path = ? WHERE id = ?", (rel_thumb, media_id))
        await db.commit()
        return True
    return False

async def run_ingestion(files: List[str], custom_tags: List[str], verbose: bool, rebuild_thumbs: bool = False,
                        start_index: int = 0, initial_stats: Optional[Dict[str, int]] = None,
                        initial_imported_ids: Optional[List[Tuple[str, str]]] = None):
    await init_db()
    db = await get_db()

    new_count = initial_stats.get("new_count", 0) if initial_stats else 0
    dedup_path_count = initial_stats.get("dedup_path_count", 0) if initial_stats else 0
    dedup_hash_count = initial_stats.get("dedup_hash_count", 0) if initial_stats else 0
    regen_count = initial_stats.get("regen_count", 0) if initial_stats else 0
    err_count = initial_stats.get("err_count", 0) if initial_stats else 0
    imported_ids: List[Tuple[str, str]] = list(initial_imported_ids) if initial_imported_ids else []

    start_time = time.time()
    last_save_time = time.time()
    idx = start_index

    def get_current_stats():
        return {
            "new_count": new_count,
            "dedup_path_count": dedup_path_count,
            "dedup_hash_count": dedup_hash_count,
            "regen_count": regen_count,
            "err_count": err_count
        }

    async def _tag_item(filepath: str, media_id: str):
        tags_to_add = []
        dir_tag = get_directory_tag(filepath)
        if dir_tag:
            tags_to_add.append(dir_tag)
        if custom_tags:
            for ct in custom_tags:
                if ct not in tags_to_add:
                    tags_to_add.append(ct)
        if tags_to_add:
            try:
                await batch_tag_media(db, [media_id], add_tags=tags_to_add)
            except Exception as e:
                if verbose:
                    console.print(f"[red]⚠️  Failed to apply tags to {filepath}: {e}[/red]")

    if imported_ids:
        with console.status("[bold magenta]🏷️  Catching up tags for previously imported items...") as status:
            dir_groups: Dict[str, List[str]] = {}
            for fpath, mid in imported_ids:
                dir_tag = get_directory_tag(fpath)
                if dir_tag:
                    if dir_tag not in dir_groups:
                        dir_groups[dir_tag] = []
                    dir_groups[dir_tag].append(mid)
            for dir_tag, mids in dir_groups.items():
                await batch_tag_media(db, mids, add_tags=[dir_tag])
            if custom_tags:
                all_ids = [mid for _, mid in imported_ids]
                await batch_tag_media(db, all_ids, add_tags=custom_tags)

    def sig_handler(signum, frame):
        _save_state(idx, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
        console.print("\n[bold yellow]🛑 Ingestion terminated by signal! Checkpoint saved.[/bold yellow]")
        console.print(f"[cyan]ℹ Run with [bold white]python import_cli.py --resume[/bold white] to continue from file {idx} of {len(files)}.[/cyan]")
        sys.exit(1)

    try:
        signal.signal(signal.SIGINT, sig_handler)
        signal.signal(signal.SIGTERM, sig_handler)
    except Exception:
        pass

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            BarColumn(bar_width=35),
            TaskProgressColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=console,
            transient=False
        ) as progress:
            task = progress.add_task("Ingesting media...", total=len(files), completed=start_index)

            for i in range(start_index, len(files)):
                idx = i
                filepath = files[i]
                fname = Path(filepath).name
                progress.update(task, description=f"Ingesting: [cyan]{fname[:22]}[/cyan]...")

                # 1. Check existing filepath
                try:
                    cursor = await db.execute("SELECT id, media_type FROM media WHERE filepath = ?", (filepath,))
                    existing = await cursor.fetchone()
                    if existing:
                        dedup_path_count += 1
                        imported_ids.append((filepath, existing["id"]))
                        await _tag_item(filepath, existing["id"])
                        if rebuild_thumbs:
                            progress.update(task, description=f"Rebuilding: [cyan]{fname[:22]}[/cyan]...")
                            if await _rebuild_item_thumb(db, filepath, existing["id"], existing["media_type"]):
                                regen_count += 1
                        if verbose:
                            progress.console.print(f"[yellow]✔ [DEDUP-PATH{' + REGEN' if rebuild_thumbs else ''}][/yellow] {filepath}")
                        progress.advance(task)
                        if (i - start_index) % 25 == 0 or (time.time() - last_save_time > 2.0):
                            _save_state(i + 1, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
                            last_save_time = time.time()
                        continue
                except Exception:
                    pass

                # 2. Compute SHA-256 for content deduplication
                try:
                    file_hash = await asyncio.to_thread(compute_file_hash, filepath)
                except Exception as e:
                    err_count += 1
                    if verbose:
                        progress.console.print(f"[red]✖ [ERROR-READ][/red] {filepath}: {e}")
                    progress.advance(task)
                    if (i - start_index) % 25 == 0 or (time.time() - last_save_time > 2.0):
                        _save_state(i + 1, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
                        last_save_time = time.time()
                    continue

                cursor = await db.execute("SELECT id, media_type FROM media WHERE file_hash = ?", (file_hash,))
                dup = await cursor.fetchone()
                if dup:
                    dedup_hash_count += 1
                    imported_ids.append((filepath, dup["id"]))
                    await _tag_item(filepath, dup["id"])
                    if rebuild_thumbs:
                        progress.update(task, description=f"Rebuilding: [cyan]{fname[:22]}[/cyan]...")
                        if await _rebuild_item_thumb(db, filepath, dup["id"], dup["media_type"]):
                            regen_count += 1
                    if verbose:
                        progress.console.print(f"[yellow]✔ [DEDUP-HASH{' + REGEN' if rebuild_thumbs else ''}][/yellow] {filepath} (id: {dup['id'][:8]}...)")
                    progress.advance(task)
                    if (i - start_index) % 25 == 0 or (time.time() - last_save_time > 2.0):
                        _save_state(i + 1, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
                        last_save_time = time.time()
                    continue

                # 3. Insert new item
                ext = Path(filepath).suffix.lower()
                if ext in IMAGE_EXTS:
                    media_type = "image"
                    mime_type = f"image/{ext[1:]}"
                elif ext in VIDEO_EXTS:
                    media_type = "video"
                    mime_type = f"video/{ext[1:]}"
                else:
                    media_type = "audio"
                    mime_type = f"audio/{ext[1:]}"
                media_id = str(uuid.uuid4())

                try:
                    meta = await get_media_metadata(filepath, media_type)
                    thumb_path = await generate_thumbnail(filepath, media_id, media_type)

                    await db.execute("""
                        INSERT INTO media (
                            id, filename, filepath, file_hash, media_type, mime_type,
                            width, height, duration_ms, file_size, thumb_path, metadata
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        media_id, fname, filepath, file_hash, media_type, mime_type,
                        meta["width"], meta["height"], meta["duration_ms"], meta["file_size"],
                        thumb_path, json.dumps({})
                    ))
                    await db.commit()
                    new_count += 1
                    imported_ids.append((filepath, media_id))
                    await _tag_item(filepath, media_id)
                    if verbose:
                        progress.console.print(f"[green]✔ [NEW][/green] {filepath}")
                except Exception as e:
                    # Collision recovery check
                    cursor = await db.execute("SELECT id, media_type FROM media WHERE filepath = ? OR file_hash = ?", (filepath, file_hash))
                    ex_row = await cursor.fetchone()
                    if ex_row:
                        dedup_hash_count += 1
                        imported_ids.append((filepath, ex_row["id"]))
                        await _tag_item(filepath, ex_row["id"])
                        if rebuild_thumbs:
                            if await _rebuild_item_thumb(db, filepath, ex_row["id"], ex_row["media_type"]):
                                regen_count += 1
                        if verbose:
                            progress.console.print(f"[yellow]✔ [DEDUP-RACE{' + REGEN' if rebuild_thumbs else ''}][/yellow] {filepath}")
                    else:
                        err_count += 1
                        if verbose:
                            progress.console.print(f"[red]✖ [ERROR-INSERT][/red] {filepath}: {e}")

                progress.advance(task)
                if (i - start_index) % 25 == 0 or (time.time() - last_save_time > 2.0):
                    _save_state(i + 1, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
                    last_save_time = time.time()

            idx = len(files)
            _save_state(idx, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)

        # Phase 3: Tagging
        if imported_ids:
            with console.status("[bold magenta]🏷️  Applying hierarchical directory & custom tags...") as status:
                dir_groups: Dict[str, List[str]] = {}
                for filepath, mid in imported_ids:
                    dir_tag = get_directory_tag(filepath)
                    if dir_tag:
                        if dir_tag not in dir_groups:
                            dir_groups[dir_tag] = []
                        dir_groups[dir_tag].append(mid)

                for dir_tag, mids in dir_groups.items():
                    await batch_tag_media(db, mids, add_tags=[dir_tag])

                if custom_tags:
                    all_ids = [mid for _, mid in imported_ids]
                    await batch_tag_media(db, all_ids, add_tags=custom_tags)

        elapsed = time.time() - start_time
        await db.close()
        _clear_state()

        # Phase 4: Final Report
        console.print()
        rep_table = Table(title="🎉 Ingestion Complete", show_header=True, header_style="bold green")
        rep_table.add_column("Metric / Status", style="cyan")
        rep_table.add_column("Count / Details", style="bold white")
        rep_table.add_row("Total Evaluated", str(len(files)))
        rep_table.add_row("✨ Newly Imported", f"[green]{new_count}[/green]")
        if rebuild_thumbs or regen_count > 0:
            rep_table.add_row("🖼️  Thumbnails Regenerated", f"[bold cyan]{regen_count}[/bold cyan]")
        rep_table.add_row("🔄 Deduped (Filepath Match)", f"[yellow]{dedup_path_count}[/yellow]")
        rep_table.add_row("🧬 Deduped (SHA-256 Match)", f"[yellow]{dedup_hash_count}[/yellow]")
        if err_count > 0:
            rep_table.add_row("❌ Errors encountered", f"[bold red]{err_count}[/bold red]")
        rep_table.add_row("🏷️  Custom Tags Applied", ", ".join(custom_tags) if custom_tags else "[dim]None (Directory tags only)[/dim]")
        rep_table.add_row("⏱️  Elapsed Time", f"{elapsed:.2f} s ({len(files)/max(elapsed,0.001):.1f} files/s)")
        console.print(rep_table)

    except (KeyboardInterrupt, asyncio.CancelledError):
        _save_state(idx, files, custom_tags, rebuild_thumbs, get_current_stats(), imported_ids)
        console.print("\n[bold yellow]🛑 Ingestion interrupted by user! Checkpoint saved.[/bold yellow]")
        console.print(f"[cyan]ℹ Run with [bold white]python import_cli.py --resume[/bold white] to continue from file {idx} of {len(files)}.[/cyan]")
        try:
            await db.close()
        except Exception:
            pass
        sys.exit(1)

def main():
    args = parse_args()
    settings.update_from_args(
        data_dir=args.data_dir,
        db_path=args.db_path,
        thumb_dir=args.thumb_dir,
    )

    if args.resume:
        state_file = _get_state_file()
        if not state_file.exists():
            console.print("[bold red]❌ No interrupted ingestion session found to resume.[/bold red]")
            sys.exit(1)
        try:
            state_data = json.loads(state_file.read_text())
            files = state_data.get("files", [])
            start_index = state_data.get("index", 0)
            custom_tags = list(set(state_data.get("custom_tags", []) + args.tags))
            rebuild_thumbs = state_data.get("rebuild_thumbs", False) or args.rebuild_thumbs
            initial_stats = state_data.get("stats", {})
            initial_imported_ids = [tuple(x) for x in state_data.get("imported_ids", [])]
        except Exception as e:
            console.print(f"[bold red]❌ Failed to read checkpoint state: {e}[/bold red]")
            sys.exit(1)

        if not files:
            console.print("[bold red]❌ Checkpoint state contains no files to import.[/bold red]")
            _clear_state()
            sys.exit(1)

        if args.paths:
            console.print("[dim yellow]Note: Ignoring specified command-line paths because --resume loads file paths from the saved checkpoint.[/dim yellow]")

        console.print(Panel.fit(
            "[bold cyan]⚡ Toxik Local Media Ingestion CLI (RESUMING)[/bold cyan]\n"
            "[dim]Resuming interrupted session from saved checkpoint.[/dim]",
            border_style="cyan"
        ))

        table = Table(title="🔄 Resuming Session Summary", show_header=True, header_style="bold magenta")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="bold white")
        table.add_row("Total Files in Session", str(len(files)))
        table.add_row("Already Processed", f"[green]{start_index}[/green] ({start_index/len(files)*100:.1f}%)")
        table.add_row("Remaining to Import", f"[bold yellow]{max(0, len(files) - start_index)}[/bold yellow]")
        table.add_row("Custom Tags", ", ".join(custom_tags) if custom_tags else "[dim]None[/dim]")
        table.add_row("Rebuild Thumbnails", "[bold cyan]YES[/bold cyan]" if rebuild_thumbs else "[dim]No[/dim]")
        console.print(table)
        console.print()

        if args.dry_run:
            console.print("[bold yellow]🚀 Dry run complete! Remove --dry-run to perform live resumed ingestion.[/bold yellow]")
            sys.exit(0)

        try:
            asyncio.run(run_ingestion(files, custom_tags, args.verbose, rebuild_thumbs, start_index, initial_stats, initial_imported_ids))
        except (KeyboardInterrupt, SystemExit):
            pass
        return

    # Normal new run
    if _get_state_file().exists():
        console.print("[dim yellow]Note: An old interrupted session checkpoint was reset. (Use --resume next time to continue an interrupted run).[/dim yellow]")
        _clear_state()

    if not args.paths:
        if args.rebuild_thumbs:
            console.print("[bold cyan]ℹ No paths specified; querying database for all existing media paths to regenerate thumbnails...[/bold cyan]")
            async def get_all_db_paths():
                await init_db()
                db = await get_db()
                cursor = await db.execute("SELECT filepath FROM media WHERE filepath IS NOT NULL")
                rows = await cursor.fetchall()
                await db.close()
                return [r["filepath"] for r in rows if os.path.exists(r["filepath"])]
            args.paths = asyncio.run(get_all_db_paths())
            if not args.paths:
                console.print("[bold red]❌ No existing media files found in database to regenerate.[/bold red]")
                sys.exit(0)
        else:
            console.print("[bold red]❌ Error: You must specify at least one target path (or pass --rebuild-thumbs / --regen without paths to regenerate all thumbnails in database).[/bold red]")
            sys.exit(1)

    console.print(Panel.fit(
        "[bold cyan]⚡ Toxik Local Media Ingestion CLI[/bold cyan]\n"
        "[dim]Fast, deduplicated, local-first media importing with hierarchical tagging.[/dim]",
        border_style="cyan"
    ))

    with console.status("[bold yellow]Scanning target paths for media files...") as status:
        files, img_count, vid_count, total_bytes = scan_paths(args.paths)
        time.sleep(0.3)  # Brief pause for UX feel

    if not files:
        console.print("[bold red]❌ No valid image or video files found in the specified paths.[/bold red]")
        sys.exit(0)

    table = Table(title="📦 Discovery Summary", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="bold white")
    table.add_row("Total Files Found", str(len(files)))
    table.add_row("📷 Images", str(img_count))
    table.add_row("🎬 Videos", str(vid_count))
    table.add_row("Total Size", f"{total_bytes / (1024*1024):.2f} MB")
    table.add_row("Custom Tags", ", ".join(args.tags) if args.tags else "[dim]None[/dim]")
    table.add_row("Rebuild Thumbnails", "[bold cyan]YES (--rebuild-thumbs)[/bold cyan]" if args.rebuild_thumbs else "[dim]No[/dim]")
    table.add_row("Mode", "[bold yellow]DRY RUN (No changes)[/bold yellow]" if args.dry_run else "[bold green]LIVE INGESTION[/bold green]")
    console.print(table)
    console.print()

    if args.dry_run:
        console.print("[bold yellow]🚀 Dry run complete! Remove --dry-run to perform live ingestion.[/bold yellow]")
        sys.exit(0)

    try:
        asyncio.run(run_ingestion(files, args.tags, args.verbose, args.rebuild_thumbs))
    except (KeyboardInterrupt, SystemExit):
        pass

if __name__ == "__main__":
    main()
