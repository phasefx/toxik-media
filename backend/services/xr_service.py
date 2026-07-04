"""XR / Stereogram / VR stub.

Stereograms: Trigger a ComfyUI workflow (user-provided) that takes a
2D image and produces a Magic Eye / autostereogram.

VR / Canvas Mode: Future spatial media viewer using WebXR. Placeholder
for when Canvas Mode adds persistent spatial boards.
"""

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def is_stereogram_workflow(workflow_id: str) -> bool:
    low = workflow_id.lower()
    return "stereogram" in low or "magic" in low or "sirds" in low


def stereogram_prompt_template(input_image_path: str) -> Optional[dict]:
    """Return a stub workflow JSON for stereogram generation.

    In the real implementation this would load the user's stereogram
    workflow JSON and patch the LoadImage node with the input path.
    """
    logger.info(f"Stereogram generation requested for {input_image_path}")
    return None


def can_view_in_vr(media_type: str, mime_type: str) -> bool:
    if media_type == "image":
        return mime_type in ("image/png", "image/jpeg", "image/webp")
    if media_type == "video":
        return mime_type in ("video/mp4", "video/webm")
    return False


def vr_viewer_url(media_id: str) -> str:
    """Return the URL for the VR viewer (future WebXR endpoint)."""
    return f"/api/xr/view/{media_id}"
