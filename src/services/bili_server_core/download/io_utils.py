import asyncio
import logging
import os
from collections.abc import Iterable
from urllib.parse import urlsplit

import aiohttp

from ..config import MAX_STREAM_FILE_SIZE
from ..logging_utils import service_log


logger = logging.getLogger(__name__)

STREAM_CONNECT_TIMEOUT_SECONDS = 10
STREAM_READ_TIMEOUT_SECONDS = 30
STREAM_TOTAL_TIMEOUT_SECONDS = 600


def _normalize_candidate_urls(urls: str | Iterable[str]) -> list[str]:
    raw_urls = [urls] if isinstance(urls, str) else list(urls or [])
    candidates = []
    seen = set()
    for value in raw_urls:
        if not isinstance(value, str):
            continue
        candidate = value.strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        candidates.append(candidate)
    return candidates


def _safe_host(url: str) -> str:
    try:
        return urlsplit(url).hostname or "unknown"
    except ValueError:
        return "unknown"


def _remove_partial_file(output_path: str) -> None:
    try:
        os.remove(output_path)
    except FileNotFoundError:
        pass


def _partial_file_size(output_path: str) -> int:
    try:
        return os.path.getsize(output_path)
    except FileNotFoundError:
        return 0


async def _download_candidate_to_file(url: str, output_path: str) -> None:
    resume_from = _partial_file_size(output_path)
    if resume_from > MAX_STREAM_FILE_SIZE:
        raise RuntimeError(
            f"Stream file size exceeded {MAX_STREAM_FILE_SIZE} bytes"
        )
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    if resume_from > 0:
        headers["Range"] = f"bytes={resume_from}-"
    timeout = aiohttp.ClientTimeout(
        total=STREAM_TOTAL_TIMEOUT_SECONDS,
        connect=STREAM_CONNECT_TIMEOUT_SECONDS,
        sock_connect=STREAM_CONNECT_TIMEOUT_SECONDS,
        sock_read=STREAM_READ_TIMEOUT_SECONDS,
    )
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, headers=headers) as resp:
            resp.raise_for_status()
            write_mode = "wb"
            if resume_from > 0 and resp.status == 206:
                content_range = resp.headers.get("Content-Range", "")
                if not content_range.startswith(f"bytes {resume_from}-"):
                    raise aiohttp.ClientPayloadError(
                        f"Unexpected Content-Range for resume: {content_range}"
                    )
                write_mode = "ab"
            else:
                resume_from = 0

            total_written = resume_from
            with open(output_path, write_mode) as f:
                async for chunk in resp.content.iter_chunked(1024 * 1024):
                    total_written += len(chunk)
                    if total_written > MAX_STREAM_FILE_SIZE:
                        raise RuntimeError(
                            f"Stream file size exceeded {MAX_STREAM_FILE_SIZE} bytes"
                        )
                    f.write(chunk)


async def download_stream_to_file(
    urls: str | Iterable[str],
    output_path: str,
    stream_type: str = "unknown",
) -> None:
    """按主地址、备用地址顺序分块下载单个媒体流。"""
    candidates = _normalize_candidate_urls(urls)
    if not candidates:
        raise ValueError("No stream download URLs available")

    last_error = None
    for index, candidate in enumerate(candidates):
        attempt = index + 1
        resume_bytes = _partial_file_size(output_path)
        try:
            await _download_candidate_to_file(candidate, output_path)
            if attempt > 1:
                service_log(
                    logger,
                    "info",
                    "download-stream-fallback-ok",
                    streamType=stream_type,
                    attempt=attempt,
                    candidateCount=len(candidates),
                    host=_safe_host(candidate),
                    resumeBytes=resume_bytes,
                )
            return
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            last_error = error
            service_log(
                logger,
                "warn",
                "download-stream-attempt-failed",
                streamType=stream_type,
                attempt=attempt,
                candidateCount=len(candidates),
                host=_safe_host(candidate),
                retrying=attempt < len(candidates),
                partialBytes=_partial_file_size(output_path),
                errorClass=type(error).__name__,
                error=str(error),
            )

    _remove_partial_file(output_path)
    raise last_error
