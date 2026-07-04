from fastapi import APIRouter, Depends, HTTPException
import aiosqlite
import json
import uuid
from typing import List, Dict, Any
from backend.models.database import get_db
from backend.models.schemas import WorkflowItem, GenerateRequest, JobItem
from backend.config import settings

router = APIRouter(prefix="/api", tags=["generate"])

@router.get("/workflows", response_model=List[WorkflowItem])
async def list_workflows():
    from backend.services.comfyui_service import get_all_workflows_metadata
    data = get_all_workflows_metadata()
    return [WorkflowItem(**w) for w in data]

@router.post("/generate", response_model=JobItem)
async def submit_job(request: GenerateRequest, db: aiosqlite.Connection = Depends(get_db)):
    job_id = str(uuid.uuid4())
    inputs_with_tags = {**request.inputs, "_tags": request.tags}
    inputs_json = json.dumps(inputs_with_tags)

    await db.execute("""
        INSERT INTO generation_jobs (id, workflow_id, status, inputs, progress)
        VALUES (?, ?, 'queued', ?, 0.0)
    """, (job_id, request.workflow_id, inputs_json))
    await db.commit()

    return JobItem(
        id=job_id,
        workflow_id=request.workflow_id,
        status="queued",
        inputs=request.inputs,
        progress=0.0
    )

@router.post("/generate/unload")
async def unload_models():
    from backend.services.job_runner import run_unload_all
    prompt_id = await run_unload_all()
    if prompt_id:
        return {"status": "submitted", "prompt_id": prompt_id}
    raise HTTPException(status_code=404, detail="unload_all.json workflow not found")

@router.get("/jobs", response_model=List[JobItem])
async def list_jobs(db: aiosqlite.Connection = Depends(get_db)):
    from backend.services.job_runner import sync_jobs_with_comfyui
    try:
        await sync_jobs_with_comfyui(db)
    except Exception as e:
        import logging
        logging.getLogger("toxik").warning(f"Failed to sync jobs with ComfyUI: {e}")

    # Fetch local jobs
    cursor = await db.execute("SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 50")
    rows = await cursor.fetchall()
    jobs = []
    for r in rows:
        try:
            inputs = json.loads(r["inputs"])
        except Exception:
            inputs = {}
        output_ids = None
        if r["output_ids"]:
            try:
                output_ids = json.loads(r["output_ids"])
            except Exception:
                pass
        jobs.append(JobItem(
            id=r["id"],
            workflow_id=r["workflow_id"],
            status=r["status"],
            inputs=inputs,
            progress=r["progress"] or 0.0,
            output_ids=output_ids,
            error=r["error"],
            created_at=str(r["created_at"]) if r["created_at"] else None,
            completed_at=str(r["completed_at"]) if r["completed_at"] else None,
            is_external=False
        ))

    # Fetch ComfyUI queue and history to collect external jobs
    from backend.services.comfyui_service import get_comfyui_queue, get_comfyui_history
    cursor_cf = await db.execute("SELECT comfyui_id FROM generation_jobs WHERE comfyui_id IS NOT NULL")
    local_comfyui_ids = {row["comfyui_id"] for row in await cursor_cf.fetchall()}

    try:
        queue = await get_comfyui_queue(settings.comfyui_host, settings.comfyui_port)
        history = await get_comfyui_history(settings.comfyui_host, settings.comfyui_port)
    except Exception:
        queue = {}
        history = {}

    external_jobs = []

    # 1. Active running queue in ComfyUI
    for item in queue.get("queue_running", []):
        if len(item) > 1:
            prompt_id = item[1]
            if prompt_id not in local_comfyui_ids:
                extra = item[3] if len(item) > 3 else {}
                prompt_num = item[0] if len(item) > 0 else "unknown"
                external_jobs.append(JobItem(
                    id=prompt_id,
                    workflow_id="External Job",
                    status="running",
                    inputs={"prompt_number": prompt_num, "client_id": extra.get("client_id") or "external"},
                    progress=0.5,
                    is_external=True
                ))

    # 2. Active pending queue in ComfyUI
    for item in queue.get("queue_pending", []):
        if len(item) > 1:
            prompt_id = item[1]
            if prompt_id not in local_comfyui_ids:
                extra = item[3] if len(item) > 3 else {}
                prompt_num = item[0] if len(item) > 0 else "unknown"
                external_jobs.append(JobItem(
                    id=prompt_id,
                    workflow_id="External Job",
                    status="queued",
                    inputs={"prompt_number": prompt_num, "client_id": extra.get("client_id") or "external"},
                    progress=0.0,
                    is_external=True
                ))

    # 3. History of completed prompts in ComfyUI (last 15 items)
    history_items = []
    for prompt_id, entry in history.items():
        if prompt_id not in local_comfyui_ids:
            history_items.append((prompt_id, entry))

    for prompt_id, entry in history_items[-15:]:
        h_status = entry.get("status", {}).get("status_str", "unknown")
        status = "completed" if h_status == "success" else "error"
        err_msg = entry.get("status", {}).get("error", "") if status == "error" else None

        prompt_info = entry.get("prompt", [])
        prompt_num = "unknown"
        client_id = "external"
        if isinstance(prompt_info, list) and len(prompt_info) > 0:
            prompt_num = prompt_info[0]
            if len(prompt_info) > 1:
                client_id = prompt_info[1]

        external_jobs.append(JobItem(
            id=prompt_id,
            workflow_id="External Job",
            status=status,
            inputs={"prompt_number": prompt_num, "client_id": client_id},
            progress=1.0 if status == "completed" else 0.0,
            error=err_msg,
            is_external=True
        ))

    return jobs + external_jobs

@router.get("/jobs/{job_id}/workflow")
async def get_job_workflow(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT workflow_id, inputs, workflow_json FROM generation_jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    if row:
        if row["workflow_json"]:
            try:
                return json.loads(row["workflow_json"])
            except Exception:
                pass
        # Fallback compute on the fly
        try:
            inputs_dict = json.loads(row["inputs"])
        except Exception:
            inputs_dict = {}

        from backend.services.job_runner import compute_patched_workflow
        try:
            patched = await compute_patched_workflow(row["workflow_id"], inputs_dict)
            return patched
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to compute workflow JSON: {e}")

    # Not found locally: check ComfyUI queue and history
    from backend.services.comfyui_service import get_comfyui_queue, get_comfyui_history
    try:
        queue = await get_comfyui_queue(settings.comfyui_host, settings.comfyui_port)
        history = await get_comfyui_history(settings.comfyui_host, settings.comfyui_port)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ComfyUI unreachable: {e}")

    # Check running queue
    for item in queue.get("queue_running", []):
        if len(item) > 2 and item[1] == job_id:
            if isinstance(item[2], dict):
                return item[2]

    # Check pending queue
    for item in queue.get("queue_pending", []):
        if len(item) > 2 and item[1] == job_id:
            if isinstance(item[2], dict):
                return item[2]

    # Check history
    if job_id in history:
        entry = history[job_id]
        prompt_info = entry.get("prompt")

        # In history, prompt info is typically [prompt_num, client_id, prompt_json, extra_data]
        if isinstance(prompt_info, list) and len(prompt_info) > 2:
            nodes = prompt_info[2]
            if isinstance(nodes, dict):
                return nodes
        elif isinstance(prompt_info, dict):
            return prompt_info

        return entry

    raise HTTPException(status_code=404, detail="Job or workflow not found")

@router.delete("/jobs/clear")
async def clear_finished_jobs(db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM generation_jobs WHERE status IN ('completed', 'error', 'canceled', 'cancelled')")
    await db.commit()
    return {"status": "success"}

@router.post("/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT status FROM generation_jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    if not row:
        # Try canceling as external job in ComfyUI queue
        from backend.services.comfyui_service import get_comfyui_queue, interrupt_comfyui, delete_from_comfyui_queue
        try:
            queue = await get_comfyui_queue(settings.comfyui_host, settings.comfyui_port)
        except Exception:
            queue = {}
        running_ids = {item[1] for item in queue.get("queue_running", []) if len(item) > 1}
        pending_ids = {item[1] for item in queue.get("queue_pending", []) if len(item) > 1}

        if job_id in running_ids:
            try:
                await interrupt_comfyui(settings.comfyui_host, settings.comfyui_port)
                return {"status": "success", "id": job_id, "new_status": "canceled", "is_external": True}
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to interrupt running external job: {e}")
        elif job_id in pending_ids:
            try:
                success = await delete_from_comfyui_queue(job_id, settings.comfyui_host, settings.comfyui_port)
                if success:
                    return {"status": "success", "id": job_id, "new_status": "canceled", "is_external": True}
                else:
                    raise HTTPException(status_code=500, detail="ComfyUI rejected delete request for pending job")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to delete pending external job: {e}")
        raise HTTPException(status_code=404, detail="Job not found locally or in active ComfyUI queue")

    status = row["status"]
    if status == "running":
        from backend.services.comfyui_service import interrupt_comfyui
        try:
            await interrupt_comfyui(settings.comfyui_host, settings.comfyui_port)
        except Exception as e:
            pass

    await db.execute("UPDATE generation_jobs SET status = 'canceled', completed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ?", (job_id,))
    await db.commit()
    return {"status": "success", "id": job_id, "new_status": "canceled"}

@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT status FROM generation_jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    if row:
        if row["status"] == "running":
            from backend.services.comfyui_service import interrupt_comfyui
            try:
                await interrupt_comfyui(settings.comfyui_host, settings.comfyui_port)
            except Exception as e:
                pass
        await db.execute("DELETE FROM generation_jobs WHERE id = ?", (job_id,))
        await db.commit()
        return {"status": "success", "deleted_id": job_id}

    # External job: try removing from ComfyUI queue or history
    from backend.services.comfyui_service import get_comfyui_queue, interrupt_comfyui, delete_from_comfyui_queue, delete_from_comfyui_history
    try:
        queue = await get_comfyui_queue(settings.comfyui_host, settings.comfyui_port)
    except Exception:
        queue = {}
    running_ids = {item[1] for item in queue.get("queue_running", []) if len(item) > 1}
    pending_ids = {item[1] for item in queue.get("queue_pending", []) if len(item) > 1}

    if job_id in running_ids:
        await interrupt_comfyui(settings.comfyui_host, settings.comfyui_port)
    elif job_id in pending_ids:
        await delete_from_comfyui_queue(job_id, settings.comfyui_host, settings.comfyui_port)
    else:
        # Try clearing history
        await delete_from_comfyui_history(job_id, settings.comfyui_host, settings.comfyui_port)

    return {"status": "success", "deleted_id": job_id, "is_external": True}
