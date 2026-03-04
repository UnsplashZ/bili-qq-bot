import logging

from bilibili_api import video

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color

logger = logging.getLogger(__name__)


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

