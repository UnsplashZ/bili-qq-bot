import logging

import bilibili_api.login_v2 as login

from .credential_refresh import ensure_buvid3
from .credential_store import save_credential
from ..logging_utils import auth_log

logger = logging.getLogger(__name__)


async def get_login_url():
    try:
        auth_log(logger, "info", "login-qrcode-start")
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        await q.generate_qrcode()
        auth_log(logger, "info", "login-qrcode-ready")
        return {
            "status": "success",
            "data": {"url": q._QrCodeLogin__qr_link, "key": q._QrCodeLogin__qr_key},
        }
    except Exception as e:
        auth_log(logger, "error", "login-qrcode-failed", error=str(e))
        return {"status": "error", "message": str(e)}


async def poll_login(qrcode_key, group_id=None):
    try:
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        q._QrCodeLogin__qr_key = qrcode_key

        event = await q.check_state()

        if event == login.QrCodeLoginEvents.DONE:
            auth_log(logger, "info", "login-succeeded", group_id=group_id)
            credential = q.get_credential()
            save_credential(credential)
            await ensure_buvid3(credential)
            return {"status": "success", "message": "登录成功"}
        if event == login.QrCodeLoginEvents.SCAN:
            return {"status": "pending", "code": 86101, "message": "等待扫码"}
        if event == login.QrCodeLoginEvents.CONF:
            return {"status": "pending", "code": 86090, "message": "已扫码，请在手机上确认"}
        if event == login.QrCodeLoginEvents.TIMEOUT:
            auth_log(logger, "warn", "login-qrcode-expired")
            return {"status": "error", "code": 86038, "message": "二维码已过期"}

        auth_log(logger, "warn", "login-state-unknown", event=str(event))
        return {"status": "error", "message": "未知状态"}
    except Exception as e:
        auth_log(logger, "error", "login-check-failed", error=str(e))
        return {"status": "error", "message": str(e)}
