import asyncio
import logging
import time

from bilibili_api import user
from bilibili_api.utils.network import Api

from ..auth.credential_store import load_credential
from ..logging_utils import service_log

logger = logging.getLogger(__name__)

TAG_USERS_CACHE_TTL_SECONDS = 300
TAG_USERS_CACHE_MAX_ENTRIES = 256
_tag_users_cache = {}
_tag_users_inflight = {}


def _build_tag_users_cache_key(my_uid, tag_id):
    return f"{my_uid}:{tag_id}"


def _cleanup_tag_users_cache(now_ts=None):
    now = now_ts if now_ts is not None else time.time()
    expired_keys = [
        key
        for key, entry in _tag_users_cache.items()
        if not isinstance(entry, dict) or entry.get("expires_at", 0) <= now
    ]
    for key in expired_keys:
        _tag_users_cache.pop(key, None)

    if len(_tag_users_cache) <= TAG_USERS_CACHE_MAX_ENTRIES:
        return

    # LRU-like trim by oldest expiry first
    sorted_items = sorted(
        _tag_users_cache.items(), key=lambda kv: kv[1].get("expires_at", 0)
    )
    over_limit = len(_tag_users_cache) - TAG_USERS_CACHE_MAX_ENTRIES
    for key, _ in sorted_items[:over_limit]:
        _tag_users_cache.pop(key, None)


def _get_cached_tag_users(cache_key, now_ts=None):
    now = now_ts if now_ts is not None else time.time()
    entry = _tag_users_cache.get(cache_key)
    if not entry:
        return None
    if entry.get("expires_at", 0) <= now:
        _tag_users_cache.pop(cache_key, None)
        return None
    users = entry.get("users")
    if not isinstance(users, list):
        return None
    return users


def _set_cached_tag_users(cache_key, users, now_ts=None):
    now = now_ts if now_ts is not None else time.time()
    _tag_users_cache[cache_key] = {
        "expires_at": now + TAG_USERS_CACHE_TTL_SECONDS,
        "users": list(users) if isinstance(users, list) else [],
    }
    _cleanup_tag_users_cache(now)


async def _fetch_tag_users_pages(cred, my_uid, tag_id, page_size=50, max_pages=50):
    users = []
    page = 1
    while True:
        group_users_api = Api(
            "https://api.bilibili.com/x/relation/tag",
            method="GET",
            credential=cred,
        )
        group_users_api.update_params(mid=my_uid, tagid=tag_id, pn=page, ps=page_size)
        group_users = await group_users_api.result

        if not group_users or not isinstance(group_users, list):
            break

        users.extend(group_users)

        if len(group_users) < page_size:
            break

        page += 1
        if page > max_pages:
            break

        await asyncio.sleep(0.1)

    return users


async def _get_tag_users_with_cache(cred, my_uid, tag_id):
    cache_key = _build_tag_users_cache_key(my_uid, tag_id)
    _cleanup_tag_users_cache()

    cached = _get_cached_tag_users(cache_key)
    if cached is not None:
        return cached

    existing = _tag_users_inflight.get(cache_key)
    if existing:
        return await existing

    async def _task():
        users = await _fetch_tag_users_pages(cred, my_uid, tag_id)
        _set_cached_tag_users(cache_key, users)
        return users

    task = asyncio.create_task(_task())
    _tag_users_inflight[cache_key] = task
    try:
        return await task
    finally:
        _tag_users_inflight.pop(cache_key, None)


async def get_my_followings(group_name=None, group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        self_info = await user.get_self_info(credential=cred)
        my_uid = self_info["mid"]
        u = user.User(uid=my_uid, credential=cred)

        all_followings = []
        page = 1
        page_size = 50

        if group_name:
            try:
                groups_api = Api(
                    "https://api.bilibili.com/x/relation/tags",
                    method="GET",
                    credential=cred,
                )
                groups = await groups_api.result
            except Exception as e:
                return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}

            target_group = None
            if groups:
                for g in groups:
                    if g.get("name") == group_name:
                        target_group = g
                        break

            if not target_group:
                return {"status": "error", "message": f"未找到名为 '{group_name}' 的分组"}

            tagid = target_group["tagid"]

            while True:
                try:
                    group_users_api = Api(
                        "https://api.bilibili.com/x/relation/tag",
                        method="GET",
                        credential=cred,
                    )
                    group_users_api.update_params(
                        mid=my_uid, tagid=tagid, pn=page, ps=page_size
                    )
                    res = await group_users_api.result
                except Exception as e:
                    service_log(logger, "warn", "group-users-fetch-failed", tagid=tagid, page=page, error=str(e))
                    break

                if not res:
                    break

                if isinstance(res, list):
                    current_list = res
                    if not current_list:
                        break
                    all_followings.extend(current_list)

                    if len(current_list) < page_size:
                        break
                else:
                    break

                page += 1
                if page > 100:
                    break
        else:
            while True:
                res = await u.get_followings(pn=page, ps=page_size)
                if not res or "list" not in res or not res["list"]:
                    break

                followings_list = res["list"]
                all_followings.extend(followings_list)

                total = res.get("total", 0)
                if len(all_followings) >= total:
                    break

                page += 1
                if page > 100:
                    break

            try:
                groups_api = Api(
                    "https://api.bilibili.com/x/relation/tags",
                    method="GET",
                    credential=cred,
                )
                groups = await groups_api.result

                if groups:
                    uid_tags_map = {}

                    for g in groups:
                        tag_name = g.get("name")
                        tag_id = g.get("tagid")
                        count = g.get("count", 0)

                        if not count or count == 0:
                            continue

                        try:
                            tag_users = await _get_tag_users_with_cache(
                                cred, my_uid, tag_id
                            )

                            for gu in tag_users:
                                guid = gu.get("mid")
                                if guid:
                                    if guid not in uid_tags_map:
                                        uid_tags_map[guid] = []
                                    uid_tags_map[guid].append(tag_name)
                        except Exception as e:
                            service_log(logger, "warn", "tag-users-fetch-failed", tag_name=tag_name, tag_id=tag_id, error=str(e))

                    for f in all_followings:
                        f_uid = f.get("mid")
                        if f_uid in uid_tags_map:
                            f["biliGroups"] = uid_tags_map[f_uid]

            except Exception as e:
                service_log(logger, "warn", "groups-info-fetch-failed", error=str(e))

        result = []
        for f in all_followings:
            uid = f.get("mid")
            uname = f.get("uname") or f.get("name")
            face = f.get("face")
            sign = f.get("sign", "")
            bili_groups = f.get("biliGroups", [])

            if uid and uname:
                result.append(
                    {
                        "uid": uid,
                        "name": uname,
                        "face": face,
                        "level": 0,
                        "sign": sign,
                        "biliGroups": bili_groups,
                    }
                )

        return {
            "status": "success",
            "type": "user_list",
            "data": result,
            "my_uid": my_uid,
        }
    except Exception as e:
        service_log(logger, "error", "followings-fetch-failed", error=str(e))
        return {"status": "error", "message": str(e)}


def _unwrap_bili_response(response, max_depth=5):
    if max_depth <= 0:
        return []

    if isinstance(response, list):
        return response

    if isinstance(response, dict):
        for key in ["data", "result", "list", "items"]:
            if key in response:
                unwrapped = _unwrap_bili_response(response[key], max_depth - 1)
                if isinstance(unwrapped, list):
                    return unwrapped

        for value in response.values():
            if isinstance(value, (list, dict)):
                unwrapped = _unwrap_bili_response(value, max_depth - 1)
                if isinstance(unwrapped, list) and unwrapped:
                    return unwrapped

    return []


async def get_follow_groups(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        try:
            groups_api = Api(
                "https://api.bilibili.com/x/relation/tags",
                method="GET",
                credential=cred,
            )
            groups_raw = await groups_api.result
            groups = _unwrap_bili_response(groups_raw)
            return {"status": "success", "data": groups}
        except Exception as e:
            return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
