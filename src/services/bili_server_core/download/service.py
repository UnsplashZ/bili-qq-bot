import asyncio
import logging
import os
import re
import secrets
import time

from bilibili_api import video
from bilibili_api.video import VideoCodecs, VideoDownloadURLDataDetecter, VideoQuality

from ..auth.credential_store import load_credential
from ..config import DOWNLOADS_ALLOWED_BASE
from .ffmpeg import ffmpeg_copy_streams
from .io_utils import download_stream_to_file

logger = logging.getLogger(__name__)


async def download_video_file(
    bvid: str,
    page_index: int,
    resolution: str,
    output_dir: str,
    group_id=None,
    video_meta=None,
) -> dict:
    """
    下载视频到本地文件，返回文件路径和元信息。
    使用 DASH 流时分别下载视频/音频再用 FFmpeg 合并。
    """
    quality_map = {
        "360p": VideoQuality._360P,
        "480p": VideoQuality._480P,
        "720p": VideoQuality._720P,
        "1080p": VideoQuality._1080P,
        "1080p+": VideoQuality._1080P_PLUS,
    }
    target_quality = quality_map.get(resolution)
    if target_quality is None:
        logger.warning(
            f'[download_video_file] Unknown resolution "{resolution}", defaulting to 1080p'
        )
        target_quality = VideoQuality._1080P

    v = video.Video(bvid=bvid, credential=load_credential(group_id))

    if video_meta:
        title = video_meta.get("title", bvid)
        owner = video_meta.get("owner", "Unknown")
        duration = video_meta.get("duration", 0)
        total_pages = video_meta.get("total_pages", 1)
    else:
        info = await v.get_info()
        title = info.get("title", bvid)
        owner = info.get("owner", {}).get("name", "Unknown")
        duration = info.get("duration", 0)
        pages = info.get("pages", [])
        total_pages = len(pages) if pages else 1

    download_data = await v.get_download_url(page_index=page_index)
    detector = VideoDownloadURLDataDetecter(download_data)
    try:
        streams = detector.detect_best_streams(
            video_max_quality=target_quality,
            codecs=[VideoCodecs.AVC, VideoCodecs.HEV, VideoCodecs.AV1],
        )
    except TypeError as e:
        if "codecs" not in str(e):
            raise
        logger.warning(
            "[download_video_file] detect_best_streams does not support codecs, falling back"
        )
        streams = detector.detect_best_streams(video_max_quality=target_quality)

    if not streams:
        return {"status": "error", "message": "no_streams_available"}

    resolved_dir = os.path.realpath(output_dir)
    if resolved_dir != DOWNLOADS_ALLOWED_BASE and not resolved_dir.startswith(
        DOWNLOADS_ALLOWED_BASE + os.sep
    ):
        return {"status": "error", "message": "invalid output_dir"}
    os.makedirs(resolved_dir, exist_ok=True)
    timestamp = int(time.time())
    safe_bvid = re.sub(r"[^a-zA-Z0-9_-]", "_", bvid)
    safe_group = re.sub(r"[^a-zA-Z0-9_-]", "_", str(group_id or "default"))
    rand_suffix = secrets.token_hex(4)
    output_path = os.path.join(
        resolved_dir, f"{safe_bvid}_{safe_group}_{timestamp}_{rand_suffix}.mp4"
    )

    if len(streams) == 1:
        single_tmp = output_path + "_s.tmp"
        await download_stream_to_file(streams[0].url, single_tmp)
        remux_ok = False
        try:
            await ffmpeg_copy_streams([single_tmp], output_path)
            remux_ok = True
        except Exception as e:
            logger.warning(
                f"[download_video_file] Single stream remux failed, fallback raw stream: {e}"
            )
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except Exception:
                pass
            os.replace(single_tmp, output_path)
        finally:
            if remux_ok:
                try:
                    if os.path.exists(single_tmp):
                        os.remove(single_tmp)
                except Exception:
                    pass
    else:
        video_tmp = output_path + "_v.tmp"
        audio_tmp = output_path + "_a.tmp"
        try:
            await asyncio.gather(
                download_stream_to_file(streams[0].url, video_tmp),
                download_stream_to_file(streams[1].url, audio_tmp),
            )
            await ffmpeg_copy_streams([video_tmp, audio_tmp], output_path)
        finally:
            for tmp in [video_tmp, audio_tmp]:
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except Exception:
                    pass

    return {
        "status": "success",
        "file_path": output_path,
        "title": title,
        "owner": owner,
        "duration": duration,
        "total_pages": total_pages,
        "page_index": page_index,
    }

