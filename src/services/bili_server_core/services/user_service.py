from bilibili_api import user

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color


async def get_user_card(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        user_info = await u.get_user_info()
        data = {
            "uid": user_info.get("mid", uid),
            "name": user_info.get("name", ""),
            "face": user_info.get("face", ""),
        }
        return {"status": "success", "type": "user_card", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_user_info(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        user_info = await u.get_user_info()

        try:
            relation = await u.get_relation_info()
        except Exception:
            relation = {}

        try:
            up_stat = await u.get_up_stat()
            likes = up_stat.get("likes", 0)
            archive_view = up_stat.get("archive", {}).get("view", 0)
        except Exception:
            likes = 0
            archive_view = 0

        latest_dynamic = None
        try:
            dynamics = await u.get_dynamics_new(offset="")
            if dynamics and "items" in dynamics and len(dynamics["items"]) > 0:
                max_ts = -1
                for item in dynamics["items"][:5]:
                    ts = 0
                    try:
                        if "modules" in item and "module_author" in item["modules"]:
                            ts = int(item["modules"]["module_author"].get("pub_ts", 0))
                    except Exception:
                        pass

                    if ts > max_ts:
                        max_ts = ts
                        latest_dynamic = item

                if not latest_dynamic:
                    latest_dynamic = dynamics["items"][0]
        except Exception:
            pass

        data = {
            "uid": user_info.get("mid", uid),
            "name": user_info.get("name", ""),
            "level": user_info.get("level", 0),
            "face": user_info.get("face", ""),
            "pendant": user_info.get("pendant", {}),
            "sign": user_info.get("sign", ""),
            "vip": user_info.get("vip", {}),
            "fans_medal": user_info.get("fans_medal", {}),
            "relation": relation,
            "likes": likes,
            "archive_view": archive_view,
            "dynamic": latest_dynamic,
            "live_room": user_info.get("live_room", {}),
            "focus": {"avatar": await get_image_focus_color(user_info.get("face", ""))},
        }

        return {"status": "success", "type": "user", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_my_info(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录"}

        self_info = await user.get_self_info(credential=cred)
        return {"status": "success", "data": self_info}
    except Exception as e:
        if str(e) != "'data'":
            import traceback

            traceback.print_exc()

        if str(e) == "'data'":
            return {
                "status": "error",
                "message": "Bilibili API format error (KeyError: 'data') - Cookie likely invalid",
            }
        return {"status": "error", "message": str(e)}

