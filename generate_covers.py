#!/usr/bin/env python3
"""Example script: generate cover art for coverless media via ComfyUI."""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from toxik_ops import ToxikClient, ComfyUIClient, CoverGenerator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cover_script")


async def main():
    parser = argparse.ArgumentParser(
        description="Generate cover art for coverless media via ComfyUI"
    )
    parser.add_argument(
        "--toxik-url", default="http://localhost:8000",
        help="Toxik API base URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--comfyui-url", default="http://localhost:8188",
        help="ComfyUI API base URL (default: http://localhost:8188)",
    )
    parser.add_argument(
        "--workflow", required=True,
        help="Path to ComfyUI workflow JSON file",
    )
    parser.add_argument(
        "--filter", default="-orphan",
        help="Tag filter for selecting media (default: -orphan)",
    )
    parser.add_argument(
        "--max-items", type=int, default=10,
        help="Maximum number of covers to generate (default: 10)",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory to save generated cover images (optional)",
    )
    parser.add_argument(
        "--batch-delay", type=float, default=5.0,
        help="Delay in seconds between batches (default: 5.0)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be done without actually generating",
    )
    parser.add_argument(
        "--rate-limit", type=float, default=2.0,
        help="Max API requests per second (default: 2.0)",
    )

    args = parser.parse_args()

    workflow_path = Path(args.workflow)
    if not workflow_path.exists():
        logger.error("Workflow file not found: %s", workflow_path)
        sys.exit(1)

    workflow = json.loads(workflow_path.read_text())

    toxik = ToxikClient(base_url=args.toxik_url, rate_limit=args.rate_limit)
    comfyui = ComfyUIClient(base_url=args.comfyui_url, rate_limit=args.rate_limit)

    gen = CoverGenerator(
        toxik=toxik,
        comfyui=comfyui,
        workflow_json=workflow,
        batch_delay=args.batch_delay,
        dry_run=args.dry_run,
    )

    logger.info("Starting cover generation for up to %d items", args.max_items)
    results = await gen.run(
        filter=args.filter,
        max_items=args.max_items,
        output_dir=args.output_dir,
    )

    success = sum(1 for _, cid in results if cid)
    failed = sum(1 for _, cid in results if cid is None)
    logger.info("Done: %d succeeded, %d failed out of %d", success, failed, len(results))

    await comfyui.close()


if __name__ == "__main__":
    asyncio.run(main())
