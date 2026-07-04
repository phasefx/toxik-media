import asyncio
import json
import logging
import time
import random
import uuid
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

from backend.config import settings
from backend.models.database import get_db
from backend.routers.websocket import manager

logger = logging.getLogger(__name__)

_runner_task: Optional[asyncio.Task] = None

def start_job_runner():
    """Start the background job runner. Called during app startup."""
    global _runner_task
    _runner_task = asyncio.create_task(_job_loop())
    logger.info("ComfyUI job runner started.")

def stop_job_runner():
    """Stop the background job runner. Called during app shutdown."""
    global _runner_task
    if _runner_task:
        _runner_task.cancel()
        _runner_task = None
        logger.info("ComfyUI job runner stopped.")

async def _job_loop():
    """Main loop: poll for queued jobs and execute them."""
    while True:
        try:
            db = await get_db()
            try:
                cursor = await db.execute(
                    "SELECT * FROM generation_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
                )
                row = await cursor.fetchone()
                if row:
                    await _execute_job(db, dict(row))
            finally:
                await db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Job runner error: {e}", exc_info=True)
        await asyncio.sleep(1)

async def _update_job(db, job_id: str, **fields):
    """Update a generation_jobs row and broadcast the change via WebSocket."""
    sets = []
    values = []
    for k, v in fields.items():
        sets.append(f"{k} = ?")
        if isinstance(v, (dict, list)):
            values.append(json.dumps(v))
        else:
            values.append(v)
    values.append(job_id)
    await db.execute(f"UPDATE generation_jobs SET {', '.join(sets)} WHERE id = ?", values)
    await db.commit()

    status = fields.get("status")
    progress = fields.get("progress")
    event_type = "job_completed" if status in ("completed", "error") else "job_progress"
    try:
        await manager.broadcast({
            "type": event_type,
            "job_id": job_id,
            "status": status,
            "progress": progress,
            "message": fields.get("error", ""),
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast job update: {e}")

def _get_workflow_dirs() -> List[Path]:
    """Get all directories to search for workflow JSON files."""
    dirs = [settings.workflows_dir]
    if hasattr(settings, 'comfyui_workflow_dir') and settings.comfyui_workflow_dir:
        dirs.append(settings.comfyui_workflow_dir)
    return dirs

def _find_workflow_path(workflow_id: str) -> Optional[Path]:
    """Find a workflow file by id across workflow dirs, checking exact paths and recursive subdirectories."""
    for search_dir in _get_workflow_dirs():
        candidate = search_dir / f"{workflow_id}.json"
        if candidate.exists():
            return candidate
        for match in search_dir.rglob(f"{workflow_id}.json"):
            if match.exists():
                return match
        for match in search_dir.rglob("*.json"):
            if match.stem == workflow_id or match.name == f"{workflow_id}.json":
                return match
    return None

async def extract_last_frame(video_path: str, output_dir: Path) -> str:
    """Extract the last frame of a video file to be used as an image input for I2 workflows."""
    import hashlib
    file_hash = hashlib.md5(video_path.encode()).hexdigest()[:10]
    out_img = output_dir / f"extracted_last_frame_{file_hash}.jpg"
    if out_img.exists() and out_img.stat().st_size > 0:
        return str(out_img)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-sseof", "-2", "-i", video_path,
        "-update", "1", "-q:v", "2", str(out_img),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
    )
    await proc.wait()
    if out_img.exists() and out_img.stat().st_size > 0:
        return str(out_img)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", video_path,
        "-update", "1", "-q:v", "2", str(out_img),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
    )
    await proc.wait()
    if out_img.exists() and out_img.stat().st_size > 0:
        return str(out_img)

    return video_path

async def compute_patched_workflow(workflow_id: str, inputs: dict, seed: Optional[int] = None) -> dict:
    """Compute the runtime patched ComfyUI workflow JSON for a given workflow and inputs."""
    from backend.services.comfyui_service import discover_workflow, assemble, apply_patches, Patch, build_prefix

    workflow_path = _find_workflow_path(workflow_id)

    if not workflow_path:
        raise FileNotFoundError(f"Workflow '{workflow_id}' not found in any workflow directory.")

    wf = discover_workflow(workflow_id, workflow_path)
    if wf.is_utility:
        return wf.nodes

    recipe = assemble(workflow_id, wf)
    inputs_copy = dict(inputs)
    inputs_copy.pop("_front", False)
    patchable_values = {}

    for i, ff in enumerate(wf.form_fields):
        key = ff.field_name
        unique_label = f"{ff.node_id} - {ff.label}" if ff.node_id else ff.label
        val = inputs_copy.get(unique_label, inputs_copy.get(ff.label, inputs_copy.get(key, ff.default)))

        if key in ("_count", "_chain") or key.startswith("_"):
            continue
        else:
            if ff.type in ("number", "combo_number"):
                try: val = float(val)
                except: val = 0.0
            elif ff.type == "checkbox":
                if isinstance(val, str):
                    val = val.lower() in ("true", "1", "t", "yes", "on")
                else:
                    val = bool(val)
            elif isinstance(val, str) and val.lower() in ("true", "false") and ff.type not in ("string", "textarea"):
                val = (val.lower() == "true")
            patchable_values[f"form_{i}"] = val

    if seed is None:
        try:
            seed = int(inputs_copy.get("seed", random.randint(0, 2**31 - 1)))
        except Exception:
            seed = random.randint(0, 2**31 - 1)

    values = {
        **patchable_values,
        "prefix": build_prefix(None, f"-{workflow_id}"),
        "seed": seed,
    }

    output_dir = settings.comfyui_output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if "primary_input" in inputs_copy:
        val = inputs_copy["primary_input"]
        if val and any(str(val).lower().endswith(ext) for ext in (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")):
            if wf.load_image and not wf.load_video:
                try:
                    val = await extract_last_frame(str(val), output_dir)
                except Exception as e:
                    logger.warning(f"Failed to auto-extract frame for JSON inspection: {e}")
        values["primary_input"] = val
    if "audio_input" in inputs_copy:
        values["audio_input"] = inputs_copy["audio_input"]
    if "mask_input" in inputs_copy:
        values["mask_input"] = inputs_copy["mask_input"]

    form_patches = [
        Patch(node_id=ff.node_id, field=ff.field_name, source=f"form_{i}")
        for i, ff in enumerate(wf.form_fields)
        if ff.node_id and not ff.field_name.startswith("_")
    ]
    all_patches = recipe.patches + form_patches
    patched = apply_patches(wf, all_patches, values)
    return patched

async def _execute_job(db, job: dict):
    """Execute a single generation job against ComfyUI."""
    from backend.services.comfyui_service import (
        discover_workflow, assemble, apply_patches, build_prefix,
        collect_outputs, submit_to_comfyui, poll_comfyui_history,
        download_comfyui_output, upload_to_comfyui, Patch
    )
    from backend.services.media_service import import_media

    job_id = job["id"]
    workflow_id = job["workflow_id"]
    inputs = json.loads(job["inputs"]) if isinstance(job["inputs"], str) else (job["inputs"] or {})
    tags = inputs.pop("_tags", [])

    logger.info(f"Executing job {job_id}: workflow={workflow_id}")

    try:
        await _update_job(db, job_id, status="running", progress=0.0)

        workflow_path = _find_workflow_path(workflow_id)

        if not workflow_path:
            raise FileNotFoundError(f"Workflow '{workflow_id}' not found in any workflow directory.")

        wf = discover_workflow(workflow_id, workflow_path)
        recipe = assemble(workflow_id, wf)

        if wf.is_utility:
            await _run_utility_workflow(db, job_id, wf, inputs)
            return

        front = inputs.pop("_front", False)
        upload_mode = inputs.pop("_upload_mode", "no_upload")
        path_mode = inputs.pop("_path_mode", "full_path")
        path_prefix = inputs.pop("_path_prefix", "")

        count = 1
        chain_count = 1
        inputs_copy = dict(inputs)
        for key in ("_count", "Count", "_chain", "Chain"):
            if key in inputs_copy:
                val = inputs_copy.pop(key)
                if key in ("_count", "Count"):
                    try: count = max(1, int(float(val)))
                    except: pass
                else:
                    try: chain_count = max(1, int(float(val)))
                    except: pass

        patchable_values = {}

        for i, ff in enumerate(wf.form_fields):
            key = ff.field_name
            unique_label = f"{ff.node_id} - {ff.label}" if ff.node_id else ff.label
            val = inputs.get(unique_label, inputs.get(ff.label, inputs.get(key, ff.default)))

            if key == "_count":
                try: count = max(1, int(float(val)))
                except: pass
            elif key == "_chain":
                try: chain_count = max(1, int(float(val)))
                except: pass
            elif key.startswith("_"):
                continue
            else:
                if ff.type in ("number", "combo_number"):
                    try: val = float(val)
                    except: val = 0.0
                elif ff.type == "checkbox":
                    if isinstance(val, str):
                        val = val.lower() in ("true", "1", "t", "yes", "on")
                    else:
                        val = bool(val)
                elif isinstance(val, str) and val.lower() in ("true", "false") and ff.type not in ("string", "textarea"):
                    val = (val.lower() == "true")
                patchable_values[f"form_{i}"] = val

        total_iterations = count * chain_count
        completed = 0
        all_output_ids = []

        output_dir = settings.comfyui_output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        for iteration in range(total_iterations):
            cursor = await db.execute("SELECT status FROM generation_jobs WHERE id = ?", (job_id,))
            row = await cursor.fetchone()
            if row and row["status"] in ("canceled", "cancelled"):
                logger.info(f"Job {job_id} was canceled before iteration {iteration+1}.")
                return

            seed = random.randint(0, 2**31 - 1)

            values = {
                **patchable_values,
                "prefix": build_prefix(None, f"-{workflow_id}"),
                "seed": seed,
            }

            if "primary_input" in inputs:
                val = inputs["primary_input"]
                if val and any(str(val).lower().endswith(ext) for ext in (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")):
                    if wf.load_image and not wf.load_video:
                        logger.info(f"Auto-extracting last frame from video for I2 workflow: {val}")
                        val = await extract_last_frame(str(val), output_dir)
                values["primary_input"] = val
            if "audio_input" in inputs:
                values["audio_input"] = inputs["audio_input"]
            if "mask_input" in inputs:
                values["mask_input"] = inputs["mask_input"]

            for pk, pv in list(values.items()):
                if isinstance(pv, str) and os.path.exists(pv) and any(pv.lower().endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".wav", ".mp3", ".flac", ".ogg")):
                    filepath = Path(pv).resolve()
                    if upload_mode == "upload":
                        try:
                            logger.info(f"Uploading file {filepath} to ComfyUI for field {pk}")
                            await upload_to_comfyui(filepath, settings.comfyui_host, settings.comfyui_port)
                        except Exception as e:
                            logger.warning(f"Failed to upload {filepath} to ComfyUI: {e}")

                    if path_mode == "filename_only":
                        transformed = filepath.name
                    elif path_mode == "rel_comfyui_outputs":
                        try:
                            transformed = str(filepath.relative_to(settings.comfyui_output_dir.resolve()))
                        except ValueError:
                            transformed = os.path.relpath(filepath, settings.comfyui_output_dir.resolve())
                    else:
                        transformed = str(filepath)

                    if path_prefix:
                        transformed = f"{path_prefix}{transformed}"

                    values[pk] = transformed

            form_patches = [
                Patch(node_id=ff.node_id, field=ff.field_name, source=f"form_{i}")
                for i, ff in enumerate(wf.form_fields)
                if ff.node_id and not ff.field_name.startswith("_")
            ]
            all_patches = recipe.patches + form_patches

            patched = apply_patches(wf, all_patches, values)

            prompt_id = await submit_to_comfyui(
                patched, settings.comfyui_host, settings.comfyui_port, front=front
            )
            await _update_job(db, job_id, comfyui_id=prompt_id, workflow_json=patched, progress=completed / total_iterations + 0.05 / total_iterations)

            max_polls = 2400
            for poll in range(max_polls):
                cursor = await db.execute("SELECT status FROM generation_jobs WHERE id = ?", (job_id,))
                row = await cursor.fetchone()
                if row and row["status"] in ("canceled", "cancelled"):
                    logger.info(f"Job {job_id} was canceled while polling ComfyUI.")
                    return

                try:
                    entry = await poll_comfyui_history(
                        prompt_id, settings.comfyui_host, settings.comfyui_port
                    )
                except RuntimeError as e:
                    raise RuntimeError(f"ComfyUI error on iteration {iteration+1}: {e}")

                if entry is not None:
                    break

                base_progress = completed / total_iterations
                poll_progress = min(poll / 100, 0.9)
                await _update_job(
                    db, job_id,
                    progress=base_progress + (poll_progress / total_iterations)
                )
                await asyncio.sleep(3)
            else:
                raise TimeoutError(f"Timed out waiting for ComfyUI on iteration {iteration+1}")

            generated = collect_outputs(entry, recipe.output_ext)

            if generated:
                downloaded_paths = []
                for filename in generated:
                    try:
                        data = await download_comfyui_output(
                            filename, settings.comfyui_host, settings.comfyui_port
                        )
                        dest = output_dir / filename
                        dest.write_bytes(data)
                        downloaded_paths.append(str(dest))
                    except Exception as e:
                        logger.warning(f"Failed to download output {filename}: {e}")

                if downloaded_paths:
                    try:
                        imported_items = await import_media(db, downloaded_paths, tags=tags)
                        for item in imported_items:
                            all_output_ids.append(item.id)
                    except Exception as e:
                        logger.error(f"Failed to import downloaded files: {e}")

            completed += 1
            await _update_job(db, job_id, progress=completed / total_iterations)

        await _update_job(
            db, job_id,
            status="completed",
            progress=1.0,
            output_ids=all_output_ids,
            completed_at=datetime.now().isoformat()
        )
        logger.info(f"Job {job_id} completed with {len(all_output_ids)} outputs.")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        await _update_job(
            db, job_id,
            status="error",
            error=str(e),
            completed_at=datetime.now().isoformat()
        )

async def _run_utility_workflow(db, job_id: str, wf, inputs: dict):
    """Run a utility workflow (no outputs expected, like unload_all)."""
    import copy
    from backend.services.comfyui_service import submit_to_comfyui, poll_comfyui_history

    patched = copy.deepcopy(wf.nodes)

    prompt_id = await submit_to_comfyui(
        patched, settings.comfyui_host, settings.comfyui_port, front=True
    )
    await _update_job(db, job_id, comfyui_id=prompt_id, progress=0.5)

    for _ in range(200):
        try:
            entry = await poll_comfyui_history(
                prompt_id, settings.comfyui_host, settings.comfyui_port
            )
            if entry is not None:
                break
        except RuntimeError as e:
            await _update_job(db, job_id, status="error", error=str(e), completed_at=datetime.now().isoformat())
            return
        await asyncio.sleep(3)

    await _update_job(
        db, job_id,
        status="completed",
        progress=1.0,
        completed_at=datetime.now().isoformat()
    )
    logger.info(f"Utility job {job_id} completed.")

async def run_unload_all() -> Optional[str]:
    """Submit the unload_all workflow directly."""
    from backend.services.comfyui_service import discover_workflow, submit_to_comfyui
    import copy

    candidate = _find_workflow_path("unload_all")
    if candidate and candidate.exists():
            try:
                wf = discover_workflow("unload_all", candidate)
                patched = copy.deepcopy(wf.nodes)
                prompt_id = await submit_to_comfyui(
                    patched, settings.comfyui_host, settings.comfyui_port, front=True
                )
                logger.info(f"Auto-unload submitted: {prompt_id}")
                return prompt_id
            except Exception as e:
                logger.warning(f"Auto-unload failed: {e}")
    return None
