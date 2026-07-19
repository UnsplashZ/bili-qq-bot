import logging
import os

import bilibili_api

from .logging_utils import lifecycle_log

logger = logging.getLogger(__name__)

CREDENTIAL_FILE = "data/cookies.json"
GROUP_COOKIES_MAP_FILE = "data/cookies_map.json"

# 视频下载目录：写入 Bot 与 NapCat 共享目录（默认 /app/.config/QQ/tmp/downloads）
# 不接受请求侧传入 output_dir，避免路径遍历风险
DOWNLOADS_ALLOWED_BASE = os.path.realpath(
    os.path.join(os.getenv("NAPCAT_TEMP_PATH", "/app/.config/QQ/tmp/"), "downloads")
)

MAX_STREAM_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 单流最大 2GB
DOWNLOAD_HANDLER_TIMEOUT_SECONDS = 300
FFMPEG_TIMEOUT_SECONDS = 300


def configure_bilibili_api() -> None:
    """Apply request headers and ticket settings once at process startup."""
    bilibili_api.HEADERS.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.bilibili.com",
            "Origin": "https://www.bilibili.com",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
        }
    )

    try:
        bilibili_api.request_settings.set_enable_bili_ticket(False)
        lifecycle_log(logger, "info", "bili-ticket-disabled")
    except Exception as e:
        lifecycle_log(logger, "warn", "bili-ticket-config-failed", error=str(e))


configure_bilibili_api()
