"""HTTP client for the Toxik API and ComfyUI."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from .throttler import RateLimiter

logger = logging.getLogger("toxik_ops")


class ToxikClient:
    """Synchronous client for the Toxik REST API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout: float = 120.0,
        rate_limit: float = 5.0,
    ):
        if httpx is None:
            raise ImportError("httpx is required. Install with: pip install httpx")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._limiter = RateLimiter(max_per_second=rate_limit)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_data: dict | list | None = None,
        files: list[tuple] | None = None,
        data: dict | None = None,
    ) -> Any:
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        await self._limiter.acquire()

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            if files:
                resp = await client.request(
                    method, url, params=params, files=files, data=data
                )
            else:
                resp = await client.request(
                    method, url, params=params, json=json_data, data=data
                )
            resp.raise_for_status()
            if resp.status_code == 204:
                return None
            ct = resp.headers.get("content-type", "")
            if "application/json" in ct:
                return resp.json()
            return resp.text

    async def browse(
        self,
        filter: str | None = None,
        search: str | None = None,
        page: int = 1,
        limit: int = 50,
        media_type: str | None = None,
        sort_by: str = "creation_date",
        sort_dir: str = "desc",
    ) -> dict:
        params = {"page": str(page), "limit": str(limit), "sort_by": sort_by, "sort_dir": sort_dir}
        if filter:
            params["filter"] = filter
        if search:
            params["search"] = search
        if media_type:
            params["media_type"] = media_type
        return await self._request("GET", "/api/browse", params=params)

    async def get_tags(self) -> list[dict]:
        return await self._request("GET", "/api/tags")

    async def import_media(self, paths: list[str], tags: list[str] | None = None) -> list[dict]:
        return await self._request(
            "POST", "/api/media/import",
            json_data={"paths": paths, "tags": tags or []},
        )

    async def upload_media(
        self,
        file_paths: list[str | Path],
        tags: list[str] | None = None,
    ) -> list[dict]:
        files = []
        for fp in file_paths:
            p = Path(fp)
            files.append(("files", (p.name, p.read_bytes(), "application/octet-stream")))
        return await self._request(
            "POST", "/api/media/upload",
            files=files,
            data={"tags": ",".join(tags) if tags else ""},
        )

    async def get_media(self, media_id: str) -> dict | None:
        try:
            return await self._request("GET", f"/api/media/{media_id}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    async def delete_media(self, media_id: str, delete_file: bool = False) -> dict:
        return await self._request(
            "DELETE", f"/api/media/{media_id}",
            params={"delete_file": "true" if delete_file else "false"},
        )

    async def batch_tag(
        self,
        media_ids: list[str],
        add_tags: list[str] | None = None,
        remove_tags: list[str] | None = None,
    ) -> dict:
        return await self._request(
            "POST", "/api/media/batch/tags",
            json_data={
                "media_ids": media_ids,
                "add_tags": add_tags or [],
                "remove_tags": remove_tags or [],
                "replace_tags": None,
                "clear_all": False,
            },
        )

    async def get_health(self) -> dict:
        return await self._request("GET", "/api/health")


class ComfyUIClient:
    """Async client for ComfyUI API (queue prompt, poll history, download images)."""

    def __init__(
        self,
        base_url: str = "http://localhost:8188",
        timeout: float = 300.0,
        rate_limit: float = 2.0,
    ):
        if httpx is None:
            raise ImportError("httpx is required. Install with: pip install httpx")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._limiter = RateLimiter(max_per_second=rate_limit)
        self._session: httpx.AsyncClient | None = None

    async def _ensure_session(self):
        if self._session is None:
            self._session = httpx.AsyncClient(timeout=self.timeout)

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        await self._limiter.acquire()
        await self._ensure_session()
        resp = await self._session.request(method, url, **kwargs)
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct:
            return resp.json()
        return resp.content

    async def queue_prompt(self, workflow: dict) -> str:
        data = {"prompt": workflow}
        result = await self._request("POST", "/prompt", json=data)
        return result["prompt_id"]

    async def get_history(self, prompt_id: str) -> dict | None:
        try:
            return await self._request("GET", f"/history/{prompt_id}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    async def poll_until_done(self, prompt_id: str, poll_interval: float = 2.0) -> dict:
        while True:
            history = await self.get_history(prompt_id)
            if history and prompt_id in history:
                return history[prompt_id]
            await asyncio.sleep(poll_interval)

    async def download_image(self, filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
        params = {"filename": filename, "subfolder": subfolder, "type": folder_type}
        result = await self._request("GET", "/view", params=params)
        return result if isinstance(result, bytes) else b""

    async def upload_image(self, filepath: str | Path, image_type: str = "input") -> dict:
        p = Path(filepath)
        data = {"type": image_type, "overwrite": "true"}
        files = {"image": (p.name, p.read_bytes(), "image/png")}
        url = urljoin(self.base_url + "/", "upload/image")
        await self._limiter.acquire()
        await self._ensure_session()
        resp = await self._session.post(url, data=data, files=files)
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        if self._session:
            await self._session.aclose()
            self._session = None
