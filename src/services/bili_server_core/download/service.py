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
from ..errors import error_envelope, invalid_request_envelope
from ..logging_utils import service_log
from .ffmpeg import ffmpeg_copy_streams
from .io_utils import download_stream_to_file

logger = logging.getLogger(__name__)

PREFERRED_CODECS = [VideoCodecs.AVC, VideoCodecs.HEV, VideoCodecs.AV1]


def _has_stream_url(stream) -> bool:
    return bool(stream and getattr(stream, "url", None))


def _is_video_stream(stream) -> bool:
    return _has_stream_url(stream) and hasattr(stream, "video_quality")


def _is_audio_stream(stream) -> bool:
    return _has_stream_url(stream) and hasattr(stream, "audio_quality")


def _stream_candidate_urls(stream) -> list[str]:
    urls = [getattr(stream, "url", None)]
    backup_urls = getattr(stream, "backup_url", None)
    if isinstance(backup_urls, str):
        urls.append(backup_urls)
    elif backup_urls:
        urls.extend(backup_urls)
    return urls


def _quality_value(stream, attr: str) -> int:
    quality = getattr(stream, attr, None)
    value = getattr(quality, "value", None)
    return value if isinstance(value, int) else -1


def _codec_score(stream, codecs) -> int:
    codec = getattr(stream, "video_codecs", None)
    if codec is None:
        return -1
    try:
        return len(codecs) - codecs.index(codec)
    except ValueError:
        return 0


def _select_best_streams_from_detected(streams, codecs):
    video_streams = [stream for stream in streams if _is_video_stream(stream)]
    audio_streams = [stream for stream in streams if _is_audio_stream(stream)]

    selected = []
    if video_streams:
        selected.append(
            max(
                video_streams,
                key=lambda stream: (
                    _quality_value(stream, "video_quality"),
                    _codec_score(stream, codecs),
                ),
            )
        )
    if audio_streams:
        selected.append(
            max(audio_streams, key=lambda stream: _quality_value(stream, "audio_quality"))
        )
    return selected


def _detect_best_streams_safe(detector, target_quality):
    try:
        return [
            stream
            for stream in detector.detect_best_streams(
                video_max_quality=target_quality,
                codecs=PREFERRED_CODECS,
            )
            if _has_stream_url(stream)
        ]
    except TypeError as e:
        if "codecs" not in str(e):
            raise
        service_log(logger, "warn", "download-codecs-argument-fallback")
        return [
            stream
            for stream in detector.detect_best_streams(video_max_quality=target_quality)
            if _has_stream_url(stream)
        ]
    except AttributeError as e:
        if "video_codecs" not in str(e) and "NoneType" not in str(e):
            raise
        service_log(logger, "warn", "download-codecs-null-fallback", error=str(e))

    try:
        detected = detector.detect(video_max_quality=target_quality, codecs=PREFERRED_CODECS)
    except TypeError as e:
        if "codecs" not in str(e):
            raise
        service_log(logger, "warn", "download-detect-codecs-argument-fallback")
        detected = detector.detect(video_max_quality=target_quality)

    return _select_best_streams_from_detected(detected, PREFERRED_CODECS)


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
        service_log(logger, "warn", "download-resolution-unknown", resolution=resolution)
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
    streams = _detect_best_streams_safe(detector, target_quality)

    if not streams:
        return error_envelope(
            "no_streams_available",
            "video_download",
            error_type="unknown",
            http_status=200,
        )

    resolved_dir = os.path.realpath(output_dir)
    if resolved_dir != DOWNLOADS_ALLOWED_BASE and not resolved_dir.startswith(
        DOWNLOADS_ALLOWED_BASE + os.sep
    ):
        return invalid_request_envelope("invalid output_dir", "video_download")
    os.makedirs(resolved_dir, exist_ok=True)
    timestamp = int(time.time())
    safe_bvid = re.sub(r"[^a-zA-Z0-9_-]", "_", bvid)
    safe_group = re.sub(r"[^a-zA-Z0-9_-]", "_", str(group_id or "default"))
    rand_suffix = secrets.token_hex(4)
    output_path = os.path.join(
        resolved_dir, f"{safe_bvid}_{safe_group}_{timestamp}_{rand_suffix}.mp4"
    )

    temporary_paths = []
    completed = False
    try:
        if len(streams) == 1:
            single_tmp = output_path + "_s.tmp"
            temporary_paths.append(single_tmp)
            await download_stream_to_file(
                _stream_candidate_urls(streams[0]), single_tmp, "single"
            )
            try:
                await ffmpeg_copy_streams([single_tmp], output_path)
            except Exception as e:
                service_log(logger, "warn", "download-remux-fallback", error=str(e))
                if os.path.exists(output_path):
                    os.remove(output_path)
                os.replace(single_tmp, output_path)
        else:
            video_tmp = output_path + "_v.tmp"
            audio_tmp = output_path + "_a.tmp"
            temporary_paths.extend([video_tmp, audio_tmp])
            await asyncio.gather(
                download_stream_to_file(
                    _stream_candidate_urls(streams[0]), video_tmp, "video"
                ),
                download_stream_to_file(
                    _stream_candidate_urls(streams[1]), audio_tmp, "audio"
                ),
            )
            await ffmpeg_copy_streams([video_tmp, audio_tmp], output_path)
        completed = True
    finally:
        for tmp in temporary_paths:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass
        if not completed:
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
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
