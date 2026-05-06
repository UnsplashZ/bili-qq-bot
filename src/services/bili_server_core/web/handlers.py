import asyncio
import logging
import time

from bilibili_api import user

from ..auth.credential_refresh import ensure_buvid3, refresh_credential_if_needed
from ..auth.credential_store import load_credential
from ..auth.login import get_login_url, poll_login
from ..config import DOWNLOAD_HANDLER_TIMEOUT_SECONDS, DOWNLOADS_ALLOWED_BASE
from ..download.service import download_video_file
from ..services.article_service import get_article_info, get_opus_detail
from ..services.bangumi_service import get_bangumi_info, get_ep_info, get_media_info
from ..services.dynamic_service import get_dynamic_detail, get_user_dynamic
from ..services.feed_service import (
    get_dynamic_feed,
    get_live_feed,
    get_live_room_info,
    get_user_articles,
    get_user_live,
    get_user_videos,
)
from ..services.follow_service import get_follow_groups, get_my_followings
from ..services.resource_service import (
    get_article_list_info,
    get_audio_info,
    get_audio_list_info,
    get_channel_series_info,
    get_cheese_video_info,
    get_favorite_list_info,
    get_interactive_video_info,
    get_note_info,
    get_topic_info,
)
from ..services.user_service import get_my_info, get_user_card, get_user_info, search_users
from ..services.video_service import get_video_info
from ..logging_utils import rpc_log
from .responses import json_error, json_result

logger = logging.getLogger(__name__)


def _handler_error(handler_name, error, status=500):
    rpc_log(logger, "error", "handler-failed", handler=handler_name, error=str(error))
    return json_error(str(error), status=status)


def _handler_invalid(handler_name, reason):
    rpc_log(logger, "warn", "handler-invalid", handler=handler_name, error=reason)
    return json_error(reason, status=400)


async def handle_video(request):
    try:
        data = await request.json()
        bvid = data.get("bvid")
        group_id = data.get("group_id")
        result = await get_video_info(bvid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("video", e)


async def handle_video_download(request):
    try:
        data = await request.json()
        bvid = data.get("bvid", "").strip()
        try:
            page_index = int(data.get("page_index", 0))
            if page_index < 0:
                raise ValueError()
        except (ValueError, TypeError):
            return _handler_invalid("video_download", "invalid page_index")
        resolution = data.get("resolution", "1080p")
        group_id = data.get("group_id")
        video_meta = data.get("video_meta")

        if not bvid:
            return _handler_invalid("video_download", "bvid is required")

        valid_resolutions = {"360p", "480p", "720p", "1080p", "1080p+"}
        if resolution not in valid_resolutions:
            return _handler_invalid("video_download", "invalid resolution")

        try:
            result = await asyncio.wait_for(
                download_video_file(
                    bvid,
                    page_index,
                    resolution,
                    DOWNLOADS_ALLOWED_BASE,
                    group_id,
                    video_meta,
                ),
                timeout=DOWNLOAD_HANDLER_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            rpc_log(logger, "error", "handler-timeout", handler="video_download", bvid=bvid)
            return json_error("download_timeout")

        return json_result(result)
    except Exception as e:
        return _handler_error("video_download", e)


async def handle_bangumi(request):
    try:
        data = await request.json()
        season_id = data.get("season_id")
        group_id = data.get("group_id")
        result = await get_bangumi_info(season_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("bangumi", e)


async def handle_article(request):
    try:
        data = await request.json()
        cvid = data.get("cvid")
        group_id = data.get("group_id")
        result = await get_article_info(cvid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("article", e)


async def handle_live_room(request):
    try:
        data = await request.json()
        room_id = data.get("room_id")
        group_id = data.get("group_id")
        result = await get_live_room_info(room_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("live_room", e)


async def handle_login_url(request):
    try:
        del request
        result = await get_login_url()
        return json_result(result)
    except Exception as e:
        return _handler_error("login_url", e)


async def handle_login_check(request):
    try:
        data = await request.json()
        key = data.get("key")
        group_id = data.get("group_id")
        result = await poll_login(key, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("login_check", e)


async def handle_user_dynamic(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")
        result = await get_user_dynamic(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_dynamic", e)


async def handle_user_live(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")
        result = await get_user_live(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_live", e)


async def handle_user_videos(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")

        if not uid:
            return json_result({"status": "error", "message": "缺少参数: uid"})

        result = await get_user_videos(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_videos", e)


async def handle_user_articles(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")

        if not uid:
            return json_result({"status": "error", "message": "缺少参数: uid"})

        result = await get_user_articles(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_articles", e)


async def handle_dynamic_detail(request):
    try:
        data = await request.json()
        dynamic_id = data.get("dynamic_id")
        group_id = data.get("group_id")
        result = await get_dynamic_detail(dynamic_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("dynamic_detail", e)


async def handle_opus(request):
    try:
        data = await request.json()
        opus_id = data.get("opus_id")
        group_id = data.get("group_id")
        result = await get_opus_detail(opus_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("opus", e)


async def handle_ep(request):
    try:
        data = await request.json()
        ep_id = data.get("ep_id")
        group_id = data.get("group_id")
        result = await get_ep_info(ep_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("ep", e)


async def handle_media(request):
    try:
        data = await request.json()
        media_id = data.get("media_id")
        group_id = data.get("group_id")
        result = await get_media_info(media_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("media", e)


async def handle_favorite_list(request):
    try:
        data = await request.json()
        media_id = data.get("media_id")
        favorite_type = data.get("favorite_type", "video")
        group_id = data.get("group_id")
        result = await get_favorite_list_info(media_id, favorite_type, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("favorite_list", e)


async def handle_audio(request):
    try:
        data = await request.json()
        auid = data.get("auid")
        group_id = data.get("group_id")
        result = await get_audio_info(auid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("audio", e)


async def handle_audio_list(request):
    try:
        data = await request.json()
        amid = data.get("amid")
        group_id = data.get("group_id")
        result = await get_audio_list_info(amid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("audio_list", e)


async def handle_topic(request):
    try:
        data = await request.json()
        topic_id = data.get("topic_id")
        group_id = data.get("group_id")
        result = await get_topic_info(topic_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("topic", e)


async def handle_channel_series(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        series_id = data.get("series_id")
        series_type = data.get("series_type", "series")
        group_id = data.get("group_id")
        result = await get_channel_series_info(uid, series_id, series_type, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("channel_series", e)


async def handle_article_list(request):
    try:
        data = await request.json()
        rlid = data.get("rlid")
        group_id = data.get("group_id")
        result = await get_article_list_info(rlid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("article_list", e)


async def handle_note(request):
    try:
        data = await request.json()
        cvid = data.get("cvid")
        group_id = data.get("group_id")
        result = await get_note_info(cvid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("note", e)


async def handle_cheese_video(request):
    try:
        data = await request.json()
        ep_id = data.get("ep_id")
        season_id = data.get("season_id")
        group_id = data.get("group_id")
        result = await get_cheese_video_info(ep_id, season_id, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("cheese_video", e)


async def handle_interactive_video(request):
    try:
        data = await request.json()
        bvid = data.get("bvid")
        group_id = data.get("group_id")
        result = await get_interactive_video_info(bvid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("interactive_video", e)


async def handle_user_info(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")
        result = await get_user_info(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_info", e)


async def handle_user_card(request):
    try:
        data = await request.json()
        uid = data.get("uid")
        group_id = data.get("group_id")
        result = await get_user_card(uid, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_card", e)


async def handle_user_search(request):
    try:
        data = await request.json()
        keyword = data.get("keyword")
        group_id = data.get("group_id")
        page = data.get("page", 1)
        page_size = data.get("page_size", 5)

        if not str(keyword or "").strip():
            return json_result({"status": "error", "message": "缺少参数: keyword"})

        result = await search_users(keyword, group_id, page=page, page_size=page_size)
        return json_result(result)
    except Exception as e:
        return _handler_error("user_search", e)


async def handle_my_followings(request):
    try:
        data = await request.json()
        group_name = data.get("group_name")
        if group_name == "None" or group_name == "":
            group_name = None
        group_id = data.get("group_id")
        result = await get_my_followings(group_name, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("my_followings", e)


async def handle_my_info(request):
    try:
        data = await request.json()
        group_id = data.get("group_id")
        result = await get_my_info(group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("my_info", e)


async def handle_get_follow_groups(request):
    try:
        data = await request.json()
        group_id = data.get("group_id")
        result = await get_follow_groups(group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("get_follow_groups", e)


async def handle_dynamic_feed(request):
    try:
        data = await request.json()
        offset = data.get("offset")
        group_id = data.get("group_id")
        result = await get_dynamic_feed(offset, group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("dynamic_feed", e)


async def handle_live_feed(request):
    try:
        data = await request.json()
        group_id = data.get("group_id")
        result = await get_live_feed(group_id)
        return json_result(result)
    except Exception as e:
        return _handler_error("live_feed", e)


async def health_check(request):
    del request
    return json_result({"status": "ok"})


async def handle_credential_info(request):
    try:
        data = await request.json()
        group_id = data.get("group_id")

        credential = load_credential(group_id)
        if not credential:
            return json_result({"status": "error", "message": "No credential found"})
        credential = await ensure_buvid3(credential, group_id)

        info = await user.get_self_info(credential=credential)

        return json_result(
            {
                "status": "success",
                "data": {
                    "uid": info["mid"],
                    "username": info["name"],
                    "is_logged_in": True,
                    "timestamp": int(time.time()),
                },
            }
        )
    except Exception as e:
        rpc_log(logger, "error", "handler-failed", handler="credential_info", error=str(e))
        return json_result({"status": "error", "message": str(e)})


async def handle_refresh_credential(request):
    del request
    result = await refresh_credential_if_needed()
    return json_result(result)
