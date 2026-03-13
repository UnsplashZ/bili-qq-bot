import logging

from bilibili_api import live, user
from bilibili_api.utils.network import Api

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from ..media.image_focus import get_image_focus_color

logger = logging.getLogger(__name__)


async def get_live_room_info(room_id, group_id=None):
    try:
        service_log(logger, "info", "fetch-live-room-info", roomId=room_id, groupId=group_id)
        l = live.LiveRoom(int(room_id), credential=load_credential(group_id))
        info = await l.get_room_info()
        room_info = info.get("room_info", {})
        anchor_info = info.get("anchor_info", {}).get("base_info", {})
        cover_url = room_info.get("cover") or ""
        avatar_url = anchor_info.get("face") or ""
        info["focus"] = {
            "cover": await get_image_focus_color(cover_url),
            "avatar": await get_image_focus_color(avatar_url),
        }
        service_log(logger, "info", "live-room-info-ready", roomId=room_id)
        return {"status": "success", "type": "live", "data": info}
    except Exception as e:
        service_log(logger, "error", "fetch-live-room-info-failed", roomId=room_id, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_user_live(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-live", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        live_info = await u.get_live_info()

        if "live_room" in live_info:
            lr = live_info["live_room"]
            if "roomid" in lr and "room_id" not in lr:
                lr["room_id"] = lr["roomid"]
            if "liveStatus" in lr and "live_status" not in lr:
                lr["live_status"] = lr["liveStatus"]

        service_log(logger, "info", "user-live-ready", uid=uid)
        return {"status": "success", "data": live_info}
    except Exception as e:
        service_log(logger, "error", "fetch-user-live-failed", uid=uid, error=str(e))
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_user_videos(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-videos", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        result = await u.get_videos(pn=1, ps=30)

        if "list" in result and "vlist" in result["list"]:
            videos = result["list"]["vlist"]
            service_log(logger, "info", "user-videos-ready", uid=uid, count=len(videos))
            return {"status": "success", "data": {"videos": videos}}

        service_log(logger, "info", "user-videos-ready", uid=uid, count=0)
        return {"status": "success", "data": {"videos": []}}
    except Exception as e:
        service_log(logger, "error", "fetch-user-videos-failed", uid=uid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_user_articles(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-articles", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        result = await u.get_articles(pn=1, ps=30)

        if "articles" in result:
            articles = result["articles"]
            service_log(logger, "info", "user-articles-ready", uid=uid, count=len(articles))
            return {"status": "success", "data": {"articles": articles}}

        service_log(logger, "info", "user-articles-ready", uid=uid, count=0)
        return {"status": "success", "data": {"articles": []}}
    except Exception as e:
        service_log(logger, "error", "fetch-user-articles-failed", uid=uid, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_dynamic_feed(offset=None, group_id=None):
    try:
        service_log(logger, "info", "fetch-dynamic-feed", offset=offset, groupId=group_id)
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        url = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all"
        params = {"type": "all", "page": 1, "timezone_offset": -480}
        if offset:
            params["offset"] = offset

        api = Api(url, method="GET", credential=cred)
        api.update_params(**params)
        data = await api.result
        service_log(logger, "info", "dynamic-feed-ready", hasOffset=bool(offset))
        return {"status": "success", "data": data}
    except Exception as e:
        service_log(logger, "error", "fetch-dynamic-feed-failed", offset=offset, error=str(e))
        return {"status": "error", "message": str(e)}


async def get_live_feed(group_id=None):
    try:
        service_log(logger, "info", "fetch-live-feed", groupId=group_id)
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        url = "https://api.live.bilibili.com/relation/v1/feed/feed_list"
        params = {"page": 1, "pagesize": 10}

        api = Api(url, method="GET", credential=cred)
        api.update_params(**params)
        data = await api.result
        service_log(logger, "info", "live-feed-ready", groupId=group_id)
        return {"status": "success", "data": data}
    except Exception as e:
        service_log(logger, "error", "fetch-live-feed-failed", groupId=group_id, error=str(e))
        return {"status": "error", "message": str(e)}
