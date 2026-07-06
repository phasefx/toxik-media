"""Cover art generation pipeline using ComfyUI.

Flow:
  1. Query Toxik for coverless media (media with thumb_path IS NULL)
  2. For each, build a prompt from filename + tags
  3. Queue the prompt on ComfyUI
  4. Poll until complete
  5. Download the output image
  6. Upload to Toxik with image.for.<tag> tags + image.for.id_<media_id>
"""

from __future__ import annotations

import asyncio
import logging
import re
import tempfile
from pathlib import Path
from typing import Any

from .client import ToxikClient, ComfyUIClient
from .throttler import RateLimiter

logger = logging.getLogger("toxik_ops.cover_gen")

PROMPT_TEMPLATE = (
    "A visually striking album cover or thumbnail for '{title}', "
    "featuring {keywords}. Vibrant colors, high contrast, professional design, "
    "clean composition, suitable for a media library thumbnail, 512x512."
)


def _build_prompt(item: dict) -> str:
    filename = item.get("filename", "untitled")
    title = Path(filename).stem
    tags = item.get("tags") or []
    keywords = ", ".join(tags[:5]) if tags else "abstract artistic elements"
    return PROMPT_TEMPLATE.format(title=title, keywords=keywords)


def _extract_output_image(history: dict, workflow: dict) -> dict | None:
    """Find the first output image in the ComfyUI history."""
    outputs = history.get("outputs", {})
    for node_id, node_data in outputs.items():
        images = node_data.get("images", [])
        if images:
            return images[0]
    return None


class CoverGenerator:
    def __init__(
        self,
        toxik: ToxikClient,
        comfyui: ComfyUIClient,
        workflow_json: dict,
        poll_interval: float = 2.0,
        batch_delay: float = 1.0,
        dry_run: bool = False,
    ):
        self.toxik = toxik
        self.comfyui = comfyui
        self.workflow = workflow_json
        self.poll_interval = poll_interval
        self.batch_delay = batch_delay
        self.dry_run = dry_run
        self._limiter = RateLimiter(max_per_second=1.0 / batch_delay if batch_delay > 0 else 10.0)

    async def find_coverless_media(
        self,
        filter: str = "-orphan",
        limit: int = 100,
    ) -> list[dict]:
        """Find media that don't have a real thumbnail.

        Uses a heuristic via the browse endpoint: items with media_type
        that doesn't generate thumbnails natively (audio, fiction, game, doc).
        """
        results = []
        for mtype in ("audio", "fiction", "game", "doc"):
            resp = await self.toxik.browse(
                filter=filter,
                media_type=mtype,
                limit=limit,
                sort_by="creation_date",
                sort_dir="desc",
            )
            for r in resp.get("results", []):
                if r.get("type") == "item":
                    results.append(r["media"])
        return results

    async def generate_cover(
        self,
        item: dict,
        output_dir: str | Path | None = None,
    ) -> str | None:
        """Generate a cover for a single media item, upload to Toxik.

        Returns the Toxik media ID of the imported cover, or None.
        """
        prompt_text = _build_prompt(item)
        logger.info("Generating cover for %s: %s", item.get("id"), prompt_text)

        workflow = _inject_prompt(self.workflow, prompt_text)
        if self.dry_run:
            logger.info("[DRY RUN] Would queue prompt: %s", prompt_text)
            return "dry_run"

        prompt_id = await self.comfyui.queue_prompt(workflow)
        logger.info("Queued prompt %s for media %s", prompt_id, item.get("id"))

        history = await self.comfyui.poll_until_done(prompt_id, self.poll_interval)
        image_info = _extract_output_image(history, workflow)

        if not image_info:
            logger.warning("No output image found for prompt %s", prompt_id)
            return None

        filename = image_info["filename"]
        subfolder = image_info.get("subfolder", "")
        image_bytes = await self.comfyui.download_image(filename, subfolder)

        with tempfile.NamedTemporaryFile(suffix=f"_{filename}", delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        result_path = tmp_path
        if output_dir:
            out = Path(output_dir) / f"cover_{item['id']}_{filename}"
            out.parent.mkdir(parents=True, exist_ok=True)
            Path(tmp_path).rename(out)
            result_path = str(out)

        tags = [f"image.for.{t}" for t in (item.get("tags") or [])]
        tags.append(f"image.for.id_{item['id']}")

        if not self.dry_run:
            imported = await self.toxik.upload_media([result_path], tags=tags)
            if imported:
                cover_id = imported[0].get("id", "")
                logger.info("Imported cover %s for media %s", cover_id, item.get("id"))
                return cover_id

        return None

    async def run(
        self,
        filter: str = "-orphan",
        max_items: int = 10,
        output_dir: str | Path | None = None,
    ) -> list[tuple[str, str | None]]:
        """Run the cover generation pipeline.

        Returns list of (media_id, cover_id_or_None) pairs.
        """
        items = await self.find_coverless_media(filter=filter, limit=max_items)
        logger.info("Found %d coverless media items", len(items))

        results = []
        for idx, item in enumerate(items):
            await self._limiter.acquire()
            logger.info("[%d/%d] Processing %s", idx + 1, len(items), item.get("filename", "?"))
            try:
                cover_id = await self.generate_cover(item, output_dir=output_dir)
                results.append((item["id"], cover_id))
            except Exception as e:
                logger.error("Failed to generate cover for %s: %s", item.get("id"), e)
                results.append((item["id"], None))

        return results


def _inject_prompt(workflow: dict, prompt_text: str) -> dict:
    """Inject a text prompt into a ComfyUI workflow JSON.

    Looks for the first CLIPTextEncode node and sets its text input.
    If no CLIPTextEncode found, replaces the first string-type 'text' input.
    """
    import copy
    workflow = copy.deepcopy(workflow)

    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type", "")
        if class_type == "CLIPTextEncode":
            inputs = node.get("inputs", {})
            if "text" in inputs:
                inputs["text"] = prompt_text
                return workflow

    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        for key, val in inputs.items():
            if isinstance(val, str) and len(val) > 10:
                inputs[key] = prompt_text
                return workflow

    logger.warning("Could not find a text input to inject prompt into workflow")
    return workflow
