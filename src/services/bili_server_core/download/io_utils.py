import aiohttp

from ..config import MAX_STREAM_FILE_SIZE


async def download_stream_to_file(url: str, output_path: str) -> None:
    """分块下载单个流到文件。"""
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    timeout = aiohttp.ClientTimeout(total=600, connect=30, sock_read=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, headers=headers) as resp:
            resp.raise_for_status()
            total_written = 0
            with open(output_path, "wb") as f:
                async for chunk in resp.content.iter_chunked(1024 * 1024):
                    total_written += len(chunk)
                    if total_written > MAX_STREAM_FILE_SIZE:
                        raise RuntimeError(
                            f"Stream file size exceeded {MAX_STREAM_FILE_SIZE} bytes"
                        )
                    f.write(chunk)

