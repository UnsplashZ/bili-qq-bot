import logging

from bilibili_api import live, user
from bilibili_api.utils.network import Api

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color

logger = logging.getLogger(__name__)


async def get_live_room_info(room_id, group_id=None):
    try:
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
        return {"status": "success", "type": "live", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_user_live(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        live_info = await u.get_live_info()

        if "live_room" in live_info:
            lr = live_info["live_room"]
            if "roomid" in lr and "room_id" not in lr:
                lr["room_id"] = lr["roomid"]
            if "liveStatus" in lr and "live_status" not in lr:
                lr["live_status"] = lr["liveStatus"]

        return {"status": "success", "data": live_info}
    except Exception as e:
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_user_videos(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        result = await u.get_videos(pn=1, ps=30)

        if "list" in result and "vlist" in result["list"]:
            videos = result["list"]["vlist"]
            return {"status": "success", "data": {"videos": videos}}

        return {"status": "success", "data": {"videos": []}}
    except Exception as e:
        logger.error(f"获取用户视频列表失败 (UID: {uid}): {e}")
        return {"status": "error", "message": str(e)}


async def get_user_articles(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        result = await u.get_articles(pn=1, ps=30)

        if "articles" in result:
            articles = result["articles"]
            return {"status": "success", "data": {"articles": articles}}

        return {"status": "success", "data": {"articles": []}}
    except Exception as e:
        logger.error(f"获取用户专栏列表失败 (UID: {uid}): {e}")
        return {"status": "error", "message": str(e)}


async def get_dynamic_feed(offset=None, group_id=None):
    try:
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
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_live_feed(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        url = "https://api.live.bilibili.com/relation/v1/feed/feed_list"
        params = {"page": 1, "pagesize": 10}

        api = Api(url, method="GET", credential=cred)
        api.update_params(**params)
        data = await api.result
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

