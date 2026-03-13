import logging

import aiohttp
import bilibili_api

from .credential_store import load_credential, save_credential
from ..logging_utils import auth_log

logger = logging.getLogger(__name__)


async def _fetch_buvid3():
    try:
        timeout = aiohttp.ClientTimeout(total=6)
        headers = bilibili_api.HEADERS.copy()
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get("https://www.bilibili.com", headers=headers) as resp:
                for name in resp.cookies:
                    if name.lower() == "buvid3":
                        return resp.cookies[name].value
                for item in resp.headers.getall("Set-Cookie", []):
                    for part in item.split(";"):
                        kv = part.strip()
                        if kv.lower().startswith("buvid3="):
                            return kv.split("=", 1)[1]
    except Exception as e:
        auth_log(logger, "warn", "buvid3-fetch-failed", error=str(e))
    return None


async def ensure_buvid3(credential, group_id=None):
    if not credential or credential.buvid3:
        return credential
    buvid3 = await _fetch_buvid3()
    if buvid3:
        credential.buvid3 = buvid3
        save_credential(credential, group_id=group_id)
    return credential


async def refresh_credential_if_needed():
    """
    检查并刷新全局 Cookie。
    返回:
      {"status": "ok",    "refreshed": bool, "message": str}
      {"status": "error", "reason": str,     "message": str}
    reason: no_credential | no_ac_time_value | invalid | check_failed | refresh_failed
    """
    credential = load_credential()
    if not credential or not credential.sessdata:
        return {
            "status": "error",
            "reason": "no_credential",
            "message": "未找到Cookie，请先在Dashboard扫码登录",
        }

    try:
        is_valid = await credential.check_valid()
        if not is_valid:
            return {
                "status": "error",
                "reason": "invalid",
                "message": "Cookie已失效，请在Dashboard重新扫码登录",
            }
    except Exception as e:
        auth_log(logger, "warn", "cookie-check-failed", error=str(e))
        return {
            "status": "error",
            "reason": "check_failed",
            "message": f"Cookie有效性检查失败: {e}",
        }

    if not credential.ac_time_value:
        return {
            "status": "error",
            "reason": "no_ac_time_value",
            "message": "Cookie缺少ac_time_value，无法自动刷新。请在Dashboard重新扫码登录以启用自动刷新",
        }

    try:
        need_refresh = await credential.check_refresh()
        if not need_refresh:
            return {"status": "ok", "refreshed": False, "message": "Cookie有效，无需刷新"}

        await credential.refresh()
        await ensure_buvid3(credential)
        save_credential(credential)
        auth_log(logger, "info", "cookie-refresh-succeeded")
        return {"status": "ok", "refreshed": True, "message": "Cookie已自动刷新成功"}
    except Exception as e:
        auth_log(logger, "error", "cookie-refresh-failed", error=str(e))
        return {
            "status": "error",
            "reason": "refresh_failed",
            "message": f"Cookie刷新失败: {e}",
        }
