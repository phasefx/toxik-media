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
            completed_at=str(r["completed_at"]) if r["completed_at"] else None
        ))
    return jobs

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
        raise HTTPException(status_code=404, detail="Job not found")
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
    if row and row["status"] == "running":
        from backend.services.comfyui_service import interrupt_comfyui
        try:
            await interrupt_comfyui(settings.comfyui_host, settings.comfyui_port)
        except Exception as e:
            pass
    await db.execute("DELETE FROM generation_jobs WHERE id = ?", (job_id,))
    await db.commit()
    return {"status": "success", "deleted_id": job_id}
