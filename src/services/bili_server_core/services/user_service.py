import logging
import inspect

from bilibili_api import search, user

from ..auth.credential_store import load_credential
from ..errors import auth_failed_envelope, error_envelope, invalid_request_envelope
from ..logging_utils import service_log
from .focus_service import build_avatar_focus
from .opus_additional_service import enrich_opus_modules

logger = logging.getLogger(__name__)

_error_envelope = error_envelope


def _get_search_users_auth_param_name():
    try:
        parameters = inspect.signature(search.search_by_type).parameters
    except (TypeError, ValueError):
        return None

    if "credential" in parameters:
        return "credential"
    if "auth" in parameters:
        return "auth"
    return None


def _normalize_positive_int(value, default_value, min_value=1, max_value=None):
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = default_value

    if normalized < min_value:
        normalized = min_value
    if max_value is not None and normalized > max_value:
        normalized = max_value

    return normalized


def _normalize_official_verify(official_verify):
    if not isinstance(official_verify, dict):
        return -1, ""

    try:
        verify_type = int(official_verify.get("type", -1))
    except (TypeError, ValueError):
        verify_type = -1

    verify_desc = official_verify.get("desc")
    if verify_desc is None:
        verify_desc = ""
    elif not isinstance(verify_desc, str):
        verify_desc = str(verify_desc)

    return verify_type, verify_desc


async def get_user_card(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-card", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        user_info = await u.get_user_info()
        data = {
            "uid": user_info.get("mid", uid),
            "name": user_info.get("name", ""),
            "face": user_info.get("face", ""),
        }
        service_log(logger, "info", "user-card-ready", uid=data["uid"])
        return {"status": "success", "type": "user_card", "data": data}
    except Exception as e:
        service_log(logger, "error", "fetch-user-card-failed", uid=uid, error=str(e))
        return error_envelope(str(e), "user_card", error=e)


async def get_user_info(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-info", uid=uid, groupId=group_id)
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

        if isinstance(latest_dynamic, dict):
            try:
                await enrich_opus_modules(
                    latest_dynamic.get("modules") or {},
                    latest_dynamic.get("id_str"),
                    group_id,
                )
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
            "focus": await build_avatar_focus(user_info.get("face", "")),
        }

        service_log(logger, "info", "user-info-ready", uid=data["uid"], hasDynamic=bool(latest_dynamic))
        return {"status": "success", "type": "user", "data": data}
    except Exception as e:
        service_log(logger, "error", "fetch-user-info-failed", uid=uid, error=str(e))
        return error_envelope(str(e), "user_info", error=e)


async def search_users(keyword, group_id=None, page=1, page_size=5):
    try:
        normalized_keyword = str(keyword or "").strip()
        if not normalized_keyword:
            return invalid_request_envelope("缺少参数: keyword", "user_search")

        normalized_page = _normalize_positive_int(page, 1, min_value=1)
        normalized_page_size = _normalize_positive_int(page_size, 5, min_value=1, max_value=10)

        service_log(
            logger,
            "info",
            "search-users",
            keyword=normalized_keyword,
            groupId=group_id,
            page=normalized_page,
            pageSize=normalized_page_size,
        )

        search_kwargs = {
            "page": normalized_page,
            "page_size": normalized_page_size,
        }
        auth_param_name = _get_search_users_auth_param_name()
        if auth_param_name:
            search_kwargs[auth_param_name] = load_credential(group_id)
        else:
            # The installed bilibili_api in this environment exposes
            # search.search_by_type without credential/auth support, so
            # user search cannot be group-scoped at this call site.
            pass
        result = await search.search_by_type(
            normalized_keyword,
            search.SearchObjectType.USER,
            **search_kwargs,
        )

        raw_candidates = result.get("result") if isinstance(result, dict) else []
        candidates = []
        for item in raw_candidates if isinstance(raw_candidates, list) else []:
            if not isinstance(item, dict):
                continue

            try:
                official_verify_type, official_verify_desc = _normalize_official_verify(item.get("official_verify"))
                candidates.append(
                    {
                        "uid": item.get("mid"),
                        "name": item.get("uname", ""),
                        "sign": item.get("usign", ""),
                        "avatar": item.get("upic", ""),
                        "fans": item.get("fans", 0),
                        "videos": item.get("videos", 0),
                        "room_id": item.get("room_id") or 0,
                        "level": item.get("level", 0),
                        "official_verify_type": official_verify_type,
                        "official_verify_desc": official_verify_desc,
                        "is_live": bool(item.get("is_live")),
                        "is_upuser": bool(item.get("is_upuser")),
                    }
                )
            except Exception as candidate_error:
                service_log(logger, "warning", "search-users-skip-invalid-candidate", keyword=normalized_keyword, error=str(candidate_error))
                continue

        total = result.get("numResults", len(candidates)) if isinstance(result, dict) else len(candidates)
        service_log(logger, "info", "search-users-ready", keyword=normalized_keyword, total=total, returned=len(candidates))
        return {
            "status": "success",
            "type": "user_search",
            "data": {
                "query": normalized_keyword,
                "page": normalized_page,
                "page_size": normalized_page_size,
                "total": total,
                "candidates": candidates,
            },
        }
    except Exception as e:
        service_log(logger, "error", "search-users-failed", keyword=keyword, groupId=group_id, error=str(e))
        return error_envelope(str(e), "user_search", error=e)


async def get_my_info(group_id=None):
    try:
        service_log(logger, "info", "fetch-my-info", groupId=group_id)
        cred = load_credential(group_id)
        if not cred:
            return auth_failed_envelope("未登录", "my_info")

        self_info = await user.get_self_info(credential=cred)
        service_log(logger, "info", "my-info-ready", mid=self_info.get("mid"))
        return {"status": "success", "data": self_info}
    except Exception as e:
        service_log(logger, "error", "fetch-my-info-failed", groupId=group_id, error=str(e))
        if str(e) != "'data'":
            import traceback

            traceback.print_exc()

        if str(e) == "'data'":
            return _error_envelope(
                "Bilibili API format error (KeyError: 'data') - Cookie likely invalid",
                "my_info",
                error=e,
                error_type="auth_failed",
                http_status=401,
            )
        return _error_envelope(str(e), "my_info", error=e)
