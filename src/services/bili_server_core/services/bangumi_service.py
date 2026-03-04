from bilibili_api import bangumi

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color


async def get_bangumi_info(season_id, group_id=None):
    try:
        b = bangumi.Bangumi(ssid=int(season_id), credential=load_credential(group_id))

        try:
            meta = await b.get_meta()
            media_id = meta.get("media", {}).get("media_id")

            if media_id:
                b_with_media = bangumi.Bangumi(
                    media_id=int(media_id), credential=load_credential(group_id)
                )

                try:
                    overview = await b_with_media.get_overview()
                except Exception:
                    overview = meta.get("media", {})

                try:
                    stat = await b_with_media.get_stat()
                except Exception:
                    stat = {}
            else:
                try:
                    overview = await b.get_overview()
                except Exception:
                    overview = meta.get("media", {})

                try:
                    stat = await b.get_stat()
                except Exception:
                    stat = {}
        except Exception as meta_error:
            try:
                overview = await b.get_overview()
            except Exception:
                return {"status": "error", "message": f"无法获取番剧信息: {str(meta_error)}"}

            try:
                stat = await b.get_stat()
            except Exception:
                stat = {}

        try:
            detail = await b.get_detail()
        except Exception:
            detail = {}

        data = {
            "title": overview.get("title", overview.get("season_title", "")),
            "cover": overview.get("cover", ""),
            "desc": overview.get("evaluate", overview.get("desc", "")),
            "stat": stat,
            "new_ep": overview.get("new_ep", {}),
            "rating": overview.get("rating", {}),
            "styles": overview.get("styles", []),
            "areas": overview.get("areas", []),
            "publish": overview.get("publish", {}),
            "season_id": overview.get("season_id", season_id),
            "season_type": overview.get("season_type"),
            "type_desc": overview.get("type_desc"),
            "series": overview.get("series", {}),
            "detail": detail,
            "focus": {"cover": await get_image_focus_color(overview.get("cover", ""))},
        }

        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_ep_info(ep_id, group_id=None):
    try:
        ep = bangumi.Episode(int(ep_id), credential=load_credential(group_id))
        info, _ = await ep.get_episode_info()

        bangumi_info = await ep.get_bangumi_from_episode()
        bangumi_overview = await bangumi_info.get_overview()
        bangumi_stat = await bangumi_info.get_stat()

        data = {
            "title": bangumi_overview.get("title", ""),
            "cover": bangumi_overview.get("cover", ""),
            "desc": bangumi_overview.get("evaluate", ""),
            "stat": bangumi_stat,
            "rating": bangumi_overview.get("rating", {}),
            "styles": bangumi_overview.get("styles", []),
            "areas": bangumi_overview.get("areas", []),
            "publish": bangumi_overview.get("publish", {}),
            "season_id": bangumi_overview.get("season_id"),
            "season_type": bangumi_overview.get("season_type"),
            "type_desc": bangumi_overview.get("type_desc"),
            "series": bangumi_overview.get("series", {}),
            "new_ep": bangumi_overview.get("new_ep", {}),
            "ep_id": ep_id,
        }
        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_media_info(media_id, group_id=None):
    try:
        b = bangumi.Bangumi(media_id=int(media_id), credential=load_credential(group_id))

        overview = await b.get_overview()

        try:
            stat = await b.get_stat()
        except Exception:
            stat = {}

        try:
            detail = await b.get_detail()
        except Exception:
            detail = {}

        data = {
            "title": overview.get("title", ""),
            "cover": overview.get("cover", ""),
            "desc": overview.get("evaluate", ""),
            "stat": stat,
            "new_ep": overview.get("new_ep", {}),
            "rating": overview.get("rating", {}),
            "styles": overview.get("styles", []),
            "areas": overview.get("areas", []),
            "publish": overview.get("publish", {}),
            "season_id": overview.get("season_id", ""),
            "series": overview.get("series", {}),
            "detail": detail,
            "focus": {"cover": await get_image_focus_color(overview.get("cover", ""))},
        }
        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

