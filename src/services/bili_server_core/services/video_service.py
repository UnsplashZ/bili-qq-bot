import logging
import time

from bilibili_api import user, video

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color

logger = logging.getLogger(__name__)

_OFFICIAL_VERIFY_CACHE = {}
_OFFICIAL_VERIFY_TTL_SECONDS = 30 * 60


def _normalize_official_verify(user_info):
    if not isinstance(user_info, dict):
        return None

    official_verify = user_info.get("official_verify")
    if isinstance(official_verify, dict):
        try:
            verify_type = int(official_verify.get("type"))
        except (TypeError, ValueError):
            verify_type = -1
        if verify_type in (0, 1):
            return {
                "type": verify_type,
                "desc": official_verify.get("desc") or "",
            }

    official = user_info.get("official")
    if isinstance(official, dict):
        try:
            verify_type = int(official.get("type"))
        except (TypeError, ValueError):
            verify_type = -1
        if verify_type in (0, 1):
            return {
                "type": verify_type,
                "desc": official.get("title") or official.get("desc") or "",
            }

    return None


def _get_cached_official_verify(owner_mid):
    cache_key = str(owner_mid)
    cached = _OFFICIAL_VERIFY_CACHE.get(cache_key)
    if not cached:
        return False, None
    if time.time() - cached["ts"] > _OFFICIAL_VERIFY_TTL_SECONDS:
        _OFFICIAL_VERIFY_CACHE.pop(cache_key, None)
        return False, None
    return True, cached["value"]


def _set_cached_official_verify(owner_mid, official_verify):
    _OFFICIAL_VERIFY_CACHE[str(owner_mid)] = {
        "ts": time.time(),
        "value": official_verify,
    }


async def _fetch_owner_official_verify(owner_mid, group_id):
    hit, cached = _get_cached_official_verify(owner_mid)
    if hit:
        return cached

    official_verify = None
    try:
        up = user.User(uid=int(owner_mid), credential=load_credential(group_id))
        up_info = await up.get_user_info()
        official_verify = _normalize_official_verify(up_info)
    except Exception as e:
        logger.warning(
            "Failed to fetch owner official verify for mid=%s: %s", owner_mid, e
        )

    _set_cached_official_verify(owner_mid, official_verify)
    return official_verify


async def get_video_info(bvid, group_id=None):
    try:
        if str(bvid).lower().startswith("av"):
            aid = int(str(bvid)[2:])
            v = video.Video(aid=aid, credential=load_credential(group_id))
        else:
            v = video.Video(bvid=bvid, credential=load_credential(group_id))
        info = await v.get_info()
        cover_url = info.get("pic") or ""
        owner = info.get("owner") or {}
        avatar_url = owner.get("face") or ""
        owner_mid = owner.get("mid")
        owner_official_verify = None
        if owner_mid:
            owner_official_verify = await _fetch_owner_official_verify(
                owner_mid, group_id
            )
        owner["official_verify"] = owner_official_verify
        info["owner"] = owner
        cover_focus = await get_image_focus_color(cover_url)
        avatar_focus = await get_image_focus_color(avatar_url)
        info["focus"] = {"cover": cover_focus, "avatar": avatar_focus}
        return {"status": "success", "type": "video", "data": info}
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
