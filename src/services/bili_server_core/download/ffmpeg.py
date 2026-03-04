import asyncio
import logging

from ..config import FFMPEG_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


async def ffmpeg_copy_streams(inputs: list[str], output_path: str) -> None:
    """
    使用 ffmpeg 无重编码合并/重封装。
    inputs: 1 个输入表示 remux，2 个输入表示 DASH 合并。
    """
    if not inputs:
        raise RuntimeError("No ffmpeg input streams")

    args = ["ffmpeg", "-y"]
    for input_file in inputs:
        args.extend(["-i", input_file])
    args.extend(["-c", "copy", "-movflags", "+faststart", output_path])

    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=FFMPEG_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(f"FFmpeg timeout after {FFMPEG_TIMEOUT_SECONDS}s")

        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {stderr.decode()[-500:]}")
    finally:
        if proc is not None and proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass

