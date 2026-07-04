import os
import sys
import json
import copy
import re
import time
import random
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# NODE ROLES & SAMPLER DEFS (Ported from master_comfyui_script)
# ─────────────────────────────────────────────────────────────────────────────

NODE_ROLES = {
    "load_video": [("VHS_LoadVideo", "video", None), ("LoadVideo", "video", None)],
    "load_image": [("LoadImage", "image", None), ("VHS_LoadImagePath", "image", None)],
    "load_audio": [("LoadAudio", "audio", None), ("VHS_LoadAudio", "audio", None)],
    "load_mask":  [("LoadImageMask", "image", None)],
    "save_video": [
        ("VHS_VideoCombine", "filename_prefix", None),
        ("SaveWEBM", "filename_prefix", None),
        ("SaveVideo", "filename_prefix", None),
        ("SaveMP4", "filename_prefix", None),
        ("SaveAnimatedWEBP", "filename_prefix", None),
        ("SaveAnimatedPNG", "filename_prefix", None),
        ("SaveGIF", "filename_prefix", None),
    ],
    "save_image": [("SaveImage", "filename_prefix", None), ("SaveImageWebsocket", "filename_prefix", None)],
    "save_audio": [("SaveAudio", "filename_prefix", None), ("VHS_SaveAudio", "filename_prefix", None)],
    "pos_prompt": [
        ("CLIPTextEncode", "text", "positive"),
        ("PrimitiveStringMultiline", "value", "positive"),
        ("TextEncodeQwenImageEdit", "prompt", "positive"),
        ("TextEncodeQwenImageEditPlus", "prompt", "positive"),
        ("VibeVoiceSingleSpeakerNode", "text", None),
        ("CLIPTextEncode", "text", None),
        ("PrimitiveStringMultiline", "value", None),
        ("TextEncodeQwenImageEdit", "prompt", None),
        ("TextEncodeQwenImageEditPlus", "prompt", None),
    ],
    "neg_prompt": [
        ("CLIPTextEncode", "text", "negative"),
        ("TextEncodeQwenImageEdit", "prompt", "negative"),
        ("TextEncodeQwenImageEditPlus", "prompt", "negative"),
    ],
}

@dataclass
class SamplerDef:
    class_type: str
    form_fields: List[Tuple[str, str, str]]  # (label, field_name, type)
    has_prompt: bool = False

SAMPLER_DEFS = [
    SamplerDef("MMAudioSampler", [
        ("Prompt", "prompt", "textarea"),
        ("Negative Prompt", "negative_prompt", "string"),
        ("Steps", "steps", "number"),
        ("CFG", "cfg", "number"),
    ], has_prompt=True),
    SamplerDef("FlowMatchSigmas", [
        ("Steps", "num_inference_steps", "number"),
        ("Shift", "shift", "number"),
        ("Denoise", "denoising_strength", "number"),
    ]),
    SamplerDef("FramePackSampler", [
        ("Steps", "steps", "number"),
        ("CFG", "cfg", "number"),
        ("Denoise", "denoise_strength", "number"),
    ]),
    SamplerDef("KSampler", [
        ("Steps", "steps", "number"),
        ("CFG", "cfg", "number"),
        ("Denoise", "denoise", "number"),
    ]),
]

# ─────────────────────────────────────────────────────────────────────────────
# DATA CLASSES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FormField:
    label: str
    node_id: str
    field_name: str
    type: str  # "textarea"|"string"|"number"|"combo"|"combo_number"|"checkbox"
    default: Any
    options: List[str] = field(default_factory=list)

@dataclass
class WorkflowInfo:
    workflow_file: Path
    key: str
    nodes: dict
    load_video: Optional[tuple] = None
    load_image: Optional[tuple] = None
    load_audio: Optional[tuple] = None
    load_mask: Optional[tuple] = None
    save_video: Optional[tuple] = None
    save_image: Optional[tuple] = None
    save_audio: Optional[tuple] = None
    seed: Optional[tuple] = None
    pos_prompt: Optional[tuple] = None
    neg_prompt: Optional[tuple] = None
    form_fields: List[FormField] = field(default_factory=list)
    is_utility: bool = False
    subdir: str = ""

@dataclass
class Patch:
    node_id: str
    field: str
    source: str

@dataclass
class Recipe:
    expected_args: int
    expects: str  # "image" | "video" | "audio" | "video,audio" | "none"
    outputs: str  # "image" | "video" | "audio" | "none"
    output_ext: str  # ".png" | ".mp4" | ".flac" | ""
    patches: List[Patch] = field(default_factory=list)

# ─────────────────────────────────────────────────────────────────────────────
# DISCOVERY FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def find_node(nodes: dict, candidates: list) -> Optional[tuple]:
    """Scan workflow nodes for the first candidate that matches."""
    for class_type, field_name, title_filter in candidates:
        for node_id, node in nodes.items():
            if node.get("class_type") != class_type:
                continue
            if title_filter:
                title = node.get("_meta", {}).get("title", "")
                if title_filter.lower() not in title.lower():
                    continue
            return node_id, field_name
    return None

def find_seed(nodes: dict) -> Optional[tuple]:
    """Find seed or noise_seed inputs in any node."""
    for node_id, node in nodes.items():
        for field_name in node.get("inputs", {}):
            if re.match(r"^(seed|noise_seed)$", field_name):
                return node_id, field_name
    return None

def discover_form_fields(
    nodes: dict,
    pos_prompt: Optional[tuple],
    neg_prompt: Optional[tuple],
    has_seed: bool = False,
) -> List[FormField]:
    """Collect parameter form fields for dynamic UI rendering."""
    fields: List[FormField] = []
    prompts_in_sampler = False

    def current_val(node_id: str, field_name: str) -> Any:
        val = nodes.get(node_id, {}).get("inputs", {}).get(field_name, "")
        return val if val is not None else ""

    def add(label: str, node_id: str, field_name: str, field_type: str):
        fields.append(FormField(
            label=label, node_id=node_id, field_name=field_name,
            type=field_type, default=current_val(node_id, field_name),
        ))

    def add_combo_num(label: str, node_id: str, field_name: str, opts: List[str]):
        fields.append(FormField(
            label=label, node_id=node_id, field_name=field_name,
            type="combo_number", default=current_val(node_id, field_name),
            options=opts,
        ))

    # Sampler fields
    for sampler in SAMPLER_DEFS:
        node_id = next(
            (nid for nid, n in nodes.items() if n.get("class_type") == sampler.class_type),
            None,
        )
        if node_id:
            for label, fname, ftype in sampler.form_fields:
                add(label, node_id, fname, ftype)
            if sampler.has_prompt:
                prompts_in_sampler = True

    # Standalone prompts
    if not prompts_in_sampler:
        if pos_prompt:
            add("Positive Prompt", pos_prompt[0], pos_prompt[1], "textarea")
        if neg_prompt:
            add("Negative Prompt", neg_prompt[0], neg_prompt[1], "string")

    # Resolution override
    res_id = next(
        (nid for nid, n in nodes.items()
         if n.get("class_type") == "ResolutionByOrientation (MyCustom)"
         or "resolution by orientation" in n.get("_meta", {}).get("title", "").lower()),
        None,
    )
    if res_id:
        add_combo_num("Override Width",  res_id, "override_width",  ["480", "832", "720", "1280"])
        add_combo_num("Override Height", res_id, "override_height", ["832", "480", "1280", "720"])
        add_combo_num("Override Length", res_id, "override_length", ["33", "65", "81", "99", "120"])

    # Upscale node
    up_id = next(
        (nid for nid, n in nodes.items()
         if n.get("class_type") == "ImageScaleToTotalPixels"
         or "scale image to total pixels" in n.get("_meta", {}).get("title", "").lower()),
        None,
    )
    if up_id:
        add("Megapixels", up_id, "megapixels", "number")

    # Fallback scan for all remaining primitive inputs
    for nid, node in nodes.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        if ct in ("LoadImage", "VHS_LoadImagePath", "LoadImageMask", "VHS_LoadVideo", "LoadVideo", "LoadAudio", "VHS_LoadAudio", "SaveImage", "SaveImageWebsocket", "VHS_VideoCombine", "SaveWEBM", "SaveVideo", "SaveMP4", "SaveAnimatedWEBP", "SaveAnimatedPNG", "SaveGIF", "SaveAudio", "VHS_SaveAudio", "PreviewImage"):
            continue
        title = node.get("_meta", {}).get("title", ct)
        for fname, fval in node.get("inputs", {}).items():
            if isinstance(fval, list) or fname in ("seed", "noise_seed", "filename_prefix") or fname.startswith("_"):
                continue
            if any(f.node_id == nid and f.field_name == fname for f in fields):
                continue
            if isinstance(fval, bool) or ct == "PrimitiveBoolean":
                label = title if (len(title) < 50 and title != ct) else fname.replace("_", " ").title()
                ftype = "checkbox"
            elif fname in ("text", "prompt", "value") or ct in ("CLIPTextEncode", "PrimitiveStringMultiline", "TextEncodeQwenImageEdit", "TextEncodeQwenImageEditPlus", "VibeVoiceSingleSpeakerNode"):
                if "neg" in title.lower() or "neg" in fname.lower():
                    label = "Negative Prompt"
                    ftype = "textarea"
                else:
                    label = title if (len(title) < 35 and title != ct) else "Prompt"
                    ftype = "textarea"
            elif isinstance(fval, (int, float)) and not isinstance(fval, bool):
                label = fname.replace("_", " ").title()
                ftype = "number"
            else:
                label = fname.replace("_", " ").title()
                ftype = "textarea" if (isinstance(fval, str) and (len(fval) > 50 or "\n" in fval)) else "string"
            add(label, nid, fname, ftype)

    def _field_priority(ff: FormField) -> int:
        name = ff.field_name.lower()
        lbl = ff.label.lower()
        if any(p in name or p in lbl for p in ("pos", "prompt", "text", "value", "caption")):
            if "neg" in name or "neg" in lbl:
                return 15
            return 10
        if "neg" in name or "neg" in lbl:
            return 15
        if any(d in name or d in lbl for d in ("width", "height", "length", "batch", "megapixels", "duration", "frames", "fps")):
            return 30
        if any(s in name or s in lbl for s in ("steps", "cfg", "denoise", "shift", "guidance", "strength")):
            return 50
        if any(s in name or s in lbl for s in ("sampler", "scheduler", "algo")):
            return 70
        if any(m in name or m in lbl for m in ("name", "model", "unet", "clip", "vae", "lora", "dtype", "device", "weight")):
            return 85
        return 80

    fields.sort(key=_field_priority)

    # Loop control virtual fields (node_id="" means handled by runner, not patched directly into node inputs)
    if has_seed:
        fields.append(FormField(
            label="Count", node_id="", field_name="_count",
            type="number", default="1",
        ))
        fields.append(FormField(
            label="Chain", node_id="", field_name="_chain",
            type="number", default="1",
        ))

    return fields

def discover_workflow(key: str, workflow_path: Path) -> WorkflowInfo:
    """Load workflow JSON and discover node roles and form fields."""
    nodes = json.loads(workflow_path.read_text())
    roles = {role: find_node(nodes, candidates) for role, candidates in NODE_ROLES.items()}
    seed  = find_seed(nodes)

    form_fields = discover_form_fields(nodes, roles["pos_prompt"], roles["neg_prompt"], has_seed=seed is not None)

    is_utility = not (roles["save_video"] or roles["save_image"] or roles["save_audio"])

    return WorkflowInfo(
        workflow_file=workflow_path,
        key=key,
        nodes=nodes,
        load_video=roles["load_video"],
        load_image=roles["load_image"],
        load_audio=roles["load_audio"],
        load_mask=roles["load_mask"],
        save_video=roles["save_video"],
        save_image=roles["save_image"],
        save_audio=roles["save_audio"],
        seed=seed,
        pos_prompt=roles["pos_prompt"],
        neg_prompt=roles["neg_prompt"],
        form_fields=form_fields,
        is_utility=is_utility,
    )

# ─────────────────────────────────────────────────────────────────────────────
# ASSEMBLY & RECIPES
# ─────────────────────────────────────────────────────────────────────────────

def _patch(wf: WorkflowInfo, role: str, source: str) -> Optional[Patch]:
    node = getattr(wf, role)
    if node is None:
        return None
    node_id, field_name = node
    return Patch(node_id=node_id, field=field_name, source=source)

def _seed_patch(wf: WorkflowInfo) -> List[Patch]:
    if wf.seed:
        return [Patch(node_id=wf.seed[0], field=wf.seed[1], source="seed")]
    return []

def _compact(patches: list) -> List[Patch]:
    return [p for p in patches if p is not None]

def _generic_recipe(key: str, wf: WorkflowInfo) -> Recipe:
    if wf.is_utility:
        return Recipe(expected_args=0, expects="none", outputs="none", output_ext="", patches=[])

    if wf.load_video:
        expects, in_patch = "video", _patch(wf, "load_video", "primary_input")
    elif wf.load_image:
        expects, in_patch = "image", _patch(wf, "load_image", "primary_input")
    elif wf.load_audio:
        expects, in_patch = "audio", _patch(wf, "load_audio", "primary_input")
    else:
        expects, in_patch = "none", None

    if wf.save_video:
        outputs, ext, out_patch = "video", ".mp4",  _patch(wf, "save_video", "prefix")
    elif wf.save_image:
        outputs, ext, out_patch = "image", ".png",  _patch(wf, "save_image", "prefix")
    elif wf.save_audio:
        outputs, ext, out_patch = "audio", ".flac", _patch(wf, "save_audio", "prefix")
    else:
        outputs, ext, out_patch = "none", "", None

    expected_args = 1 if in_patch is not None else 0
    patches = _compact([in_patch, out_patch]) + _seed_patch(wf)

    if wf.load_audio and expects != "audio":
        patches.append(_patch(wf, "load_audio", "audio_input"))
        expects = "audio" if expects == "none" else f"{expects},audio"
        expected_args += 1
    if wf.load_mask:
        patches.append(_patch(wf, "load_mask", "mask_input"))
        expects = "mask" if expects == "none" else f"{expects},mask"
        expected_args += 1

    return Recipe(expected_args=expected_args, expects=expects, outputs=outputs, output_ext=ext, patches=patches)

def assemble(key: str, wf: WorkflowInfo) -> Recipe:
    if wf.is_utility:
        return _generic_recipe(key, wf)

    match key:
        case "wan":
            return Recipe(
                expected_args=1, expects="image", outputs="video", output_ext=".mp4",
                patches=_compact([
                    _patch(wf, "load_image", "primary_input"),
                    _patch(wf, "save_video", "prefix"),
                    *_seed_patch(wf),
                ]),
            )
        case "vid-plus-audio" | "video-audio-lips-latentsync":
            return Recipe(
                expected_args=2, expects="video,audio", outputs="video", output_ext=".mp4",
                patches=_compact([
                    _patch(wf, "load_video", "primary_input"),
                    _patch(wf, "load_audio", "audio_input"),
                    _patch(wf, "save_video", "prefix"),
                ]),
            )
        case "audio-only":
            return Recipe(
                expected_args=1, expects="audio", outputs="audio", output_ext=".flac",
                patches=_compact([
                    _patch(wf, "load_audio", "primary_input"),
                    _patch(wf, "save_audio", "prefix"),
                    *_seed_patch(wf),
                ]),
            )
        case _:
            return _generic_recipe(key, wf)

# ─────────────────────────────────────────────────────────────────────────────
# PATCHING & NAMING
# ─────────────────────────────────────────────────────────────────────────────

def apply_patches(wf: WorkflowInfo, patches: List[Patch], values: dict) -> dict:
    """Deep-copy workflow nodes and apply runtime patch values."""
    nodes = copy.deepcopy(wf.nodes)
    for patch in patches:
        if patch.source not in values:
            logger.warning(f"No value provided for patch source '{patch.source}'; skipping.")
            continue
        if patch.node_id in nodes and "inputs" in nodes[patch.node_id]:
            orig_val = nodes[patch.node_id]["inputs"].get(patch.field)
            new_val = values[patch.source]
            is_bool_node = nodes[patch.node_id].get("class_type") == "PrimitiveBoolean" or isinstance(orig_val, bool)
            if is_bool_node and not isinstance(new_val, bool):
                if isinstance(new_val, str):
                    new_val = new_val.lower() in ("true", "1", "t", "yes", "on")
                else:
                    new_val = bool(new_val)
            nodes[patch.node_id]["inputs"][patch.field] = new_val
    return nodes

def build_prefix(primary_input: Optional[str], suffix: str) -> str:
    """Build ComfyUI output filename prefix with clean timestamp formatting."""
    prefix = os.environ.get("COMFY_OUTPUT_PREFIX", "")
    ts     = time.strftime("%Y%m%d-%H%M%S")

    if not primary_input:
        return f"{prefix}{ts}{suffix}".lstrip("-")

    name = Path(primary_input).stem
    name = re.sub(r"_\d{5,}$", "", name)
    name = re.sub(r"-\d{8}-\d{6}-[a-zA-Z0-9_]+$", "", name)
    name = (name or Path(primary_input).stem)[:100]

    return f"{prefix}{name}-{ts}{suffix}".lstrip("-")

def build_output_prefix(
    primary_input: Optional[str],
    workflow_id: str,
    path_mode: str = "full",
    filename_mode: str = "workflow_name",
    custom_filename: str = "",
    filename_prefix: str = "",
    filename_suffix: str = "",
) -> str:
    """Build a filename prefix for the ComfyUI output node with configurable path and filename axes.

    The resulting string is used as the ``filename_prefix`` on save nodes (SaveImage, etc.).

    Path modes (directory structure):
        full       →  {timestamp}/{input_stem}/
        subdir_only → {input_stem}/
        none       →  (flat, no trailing slash)

    Filename modes:
        workflow_name → workflow_id (e.g. ``qwen-image-edit-2509-q8``)
        timestamp     → ``%Y-%m-%d-%H-%M-%S``
        custom        → custom_filename value

    The final prefix is assembled as::

        {path}{filename_prefix}{filename_part}{filename_suffix}
    """
    ts = time.strftime("%Y%m%d-%H%M%S")

    input_stem = ""
    if primary_input:
        name = Path(primary_input).stem
        name = re.sub(r"_\d{5,}$", "", name)
        name = re.sub(r"-\d{8}-\d{6}-[a-zA-Z0-9_]+$", "", name)
        input_stem = (name or Path(primary_input).stem)[:100]

    if path_mode == "full":
        path_part = f"{ts}/" + (f"{input_stem}/" if input_stem else "")
    elif path_mode == "subdir_only":
        path_part = f"{input_stem}/" if input_stem else ""
    else:
        path_part = ""

    if filename_mode == "timestamp":
        fname = time.strftime("%Y-%m-%d-%H-%M-%S")
    elif filename_mode == "custom":
        fname = custom_filename or "output"
    else:
        fname = Path(workflow_id).stem

    return f"{path_part}{filename_prefix}{fname}{filename_suffix}"

# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT COLLECTION
# ─────────────────────────────────────────────────────────────────────────────

def collect_outputs(history_entry: dict, output_ext: str) -> List[str]:
    """Walk ComfyUI execution history and collect output filenames."""
    all_files: List[str] = []

    def walk(obj):
        if isinstance(obj, dict):
            if "filename" in obj:
                all_files.append(obj["filename"])
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(history_entry.get("outputs", {}))

    if output_ext:
        preferred = [f for f in all_files if f.endswith(output_ext)]
        return preferred if preferred else all_files
    return all_files

# ─────────────────────────────────────────────────────────────────────────────
# COMFYUI ASYNC HTTP CLIENT
# ─────────────────────────────────────────────────────────────────────────────

async def upload_to_comfyui(filepath: Path, host: str, port: int) -> str:
    """Upload a local file (image, video, audio) to ComfyUI's input directory via POST /upload/image."""
    import aiohttp
    url = f"http://{host}:{port}/upload/image"
    data = aiohttp.FormData()
    with open(filepath, "rb") as f:
        data.add_field("image", f, filename=filepath.name)
        data.add_field("type", "input")
        data.add_field("overwrite", "true")
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise RuntimeError(f"ComfyUI rejected file upload for {filepath.name}: {resp.status} {text}")
                res = await resp.json()
                return res.get("name", filepath.name)

async def submit_to_comfyui(nodes: dict, host: str, port: int, front: bool = False) -> str:
    """POST /prompt to ComfyUI, returns prompt_id."""
    import aiohttp
    url = f"http://{host}:{port}/prompt"
    payload = {"prompt": nodes}
    if front:
        payload["front"] = True
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise RuntimeError(f"ComfyUI rejected prompt: {resp.status} {text}")
            data = await resp.json()
            return data["prompt_id"]

async def poll_comfyui_history(prompt_id: str, host: str, port: int) -> Optional[dict]:
    """Check /history/<prompt_id>. Returns entry if success, None if pending, raises on error."""
    import aiohttp
    url = f"http://{host}:{port}/history/{prompt_id}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            if prompt_id not in data:
                return None
            entry = data[prompt_id]
            status = entry.get("status", {}).get("status_str", "unknown")
            if status == "success":
                return entry
            elif status in ("error", "execution_error"):
                raise RuntimeError(f"ComfyUI execution error for {prompt_id}")
            return None

async def download_comfyui_output(filename: str, host: str, port: int, subfolder: str = "") -> bytes:
    """Download generated file from ComfyUI via GET /view."""
    import aiohttp
    params = {"filename": filename}
    if subfolder:
        params["subfolder"] = subfolder
    url = f"http://{host}:{port}/view"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Failed to download {filename}: {resp.status}")
            return await resp.read()

async def interrupt_comfyui(host: str, port: int) -> bool:
    """POST /interrupt to ComfyUI to cancel execution."""
    import aiohttp
    url = f"http://{host}:{port}/interrupt"
    async with aiohttp.ClientSession() as session:
        async with session.post(url) as resp:
            return resp.status == 200

async def get_comfyui_queue(host: str, port: int) -> dict:
    """GET /queue from ComfyUI."""
    import aiohttp
    url = f"http://{host}:{port}/queue"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.json()
    except Exception:
        pass
    return {}

async def get_comfyui_history(host: str, port: int) -> dict:
    """GET /history from ComfyUI."""
    import aiohttp
    url = f"http://{host}:{port}/history"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.json()
    except Exception:
        pass
    return {}

async def delete_from_comfyui_queue(prompt_id: str, host: str, port: int) -> bool:
    """POST /queue to delete a prompt from ComfyUI queue."""
    import aiohttp
    url = f"http://{host}:{port}/queue"
    payload = {"delete": [prompt_id]}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                return resp.status == 200
    except Exception:
        pass
    return False

async def delete_from_comfyui_history(prompt_id: str, host: str, port: int) -> bool:
    """POST /history to delete a prompt from ComfyUI history."""
    import aiohttp
    url = f"http://{host}:{port}/history"
    payload = {"delete": [prompt_id]}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                return resp.status == 200
    except Exception:
        pass
    return False


# ─────────────────────────────────────────────────────────────────────────────
# SCANNING & REGISTRY MERGING
# ─────────────────────────────────────────────────────────────────────────────

def scan_workflow_dir(workflow_dir: Path) -> List[WorkflowInfo]:
    """Scan a directory recursively for ComfyUI API-format workflow JSON files."""
    workflows = []
    if not workflow_dir or not workflow_dir.exists():
        return workflows
    for json_file in sorted(workflow_dir.rglob("*.json")):
        if json_file.name == "registry.json":
            continue
        try:
            rel = json_file.relative_to(workflow_dir)
            key = rel.as_posix()[:-5]  # strip .json, preserving subdirectory slashes
            subdir = str(Path(*rel.parts[:-1])).replace("\\", "/") if len(rel.parts) > 1 else ""
            wf = discover_workflow(key, json_file)
            wf.subdir = subdir
            workflows.append(wf)
        except Exception as e:
            logger.warning(f"Failed to discover workflow {json_file}: {e}")
    return workflows

def _determine_expects(wf: WorkflowInfo) -> str:
    if wf.is_utility: return "none"
    parts = []
    if wf.load_video: parts.append("video")
    elif wf.load_image: parts.append("image")
    if wf.load_audio and (wf.load_video or wf.load_image): parts.append("audio")
    elif wf.load_audio: parts.append("audio")
    if wf.load_mask: parts.append("mask")
    return ",".join(parts) if parts else "none"

def _determine_outputs(wf: WorkflowInfo) -> str:
    if wf.is_utility: return "none"
    if wf.save_video: return "video"
    if wf.save_image: return "image"
    if wf.save_audio: return "audio"
    return "none"

def merge_with_registry(workflows: List[WorkflowInfo], registry_path: Path) -> List[dict]:
    """Merge auto-discovered workflow info with registry.json metadata."""
    registry_map = {}
    if registry_path.exists():
        try:
            data = json.loads(registry_path.read_text())
            for entry in data.get("workflows", []):
                registry_map[entry["id"]] = entry
                registry_map[entry["id"].replace("-", "_")] = entry
                registry_map[entry["id"].replace("_", "-")] = entry
        except Exception as e:
            logger.warning(f"Failed to read registry.json: {e}")

    result = []
    for wf in workflows:
        reg = registry_map.get(wf.key, registry_map.get(wf.key.split("/")[-1], {}))
        if "type" in reg:
            wf_type = reg["type"]
        elif wf.is_utility:
            wf_type = "utility"
        elif wf.load_video and wf.save_video:
            wf_type = "V2V"
        elif wf.load_image and wf.save_video:
            wf_type = "I2V"
        elif wf.save_video and not wf.load_image:
            wf_type = "T2V"
        elif wf.save_image and not wf.load_image:
            wf_type = "T2I"
        elif wf.load_image and wf.save_image:
            wf_type = "I2I"
        elif wf.load_audio and wf.save_audio:
            wf_type = "A2A"
        elif wf.load_video and wf.load_audio:
            wf_type = "V+A"
        else:
            wf_type = "GEN"

        display_name = reg.get("name", wf.key.split("/")[-1].replace("-", " ").replace("_", " ").title())

        form_fields_data = []
        for ff in wf.form_fields:
            form_fields_data.append({
                "label": ff.label,
                "node_id": ff.node_id,
                "field_name": ff.field_name,
                "type": ff.type,
                "default": ff.default,
                "options": ff.options,
            })

        expects = _determine_expects(wf)
        outputs = _determine_outputs(wf)

        result.append({
            "id": wf.key,
            "name": display_name,
            "type": wf_type,
            "file": str(wf.workflow_file),
            "expects": expects,
            "outputs": outputs,
            "form_fields": form_fields_data,
            "tags_auto": reg.get("tags_auto", ["AI.Generated"]),
            "is_utility": wf.is_utility,
            "inputs": reg.get("inputs", None),
            "subdir": getattr(wf, "subdir", ""),
        })
    return result

def get_all_workflows_metadata() -> List[dict]:
    """Scan and merge all discovered workflows with registry metadata."""
    from backend.config import settings
    all_workflows = []
    all_workflows.extend(scan_workflow_dir(settings.workflows_dir))
    if hasattr(settings, 'comfyui_workflow_dir') and settings.comfyui_workflow_dir and settings.comfyui_workflow_dir.exists():
        all_workflows.extend(scan_workflow_dir(settings.comfyui_workflow_dir))

    seen = {}
    for wf in all_workflows:
        seen[wf.key] = wf
    deduped = list(seen.values())

    registry_path = settings.workflows_dir / "registry.json"
    return merge_with_registry(deduped, registry_path)

