import logging

import bilibili_api.login_v2 as login

from .credential_refresh import ensure_buvid3
from .credential_store import save_credential

logger = logging.getLogger(__name__)


async def get_login_url():
    try:
        logger.info("开始生成登录二维码...")
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        await q.generate_qrcode()
        logger.info("登录二维码生成成功")
        return {
            "status": "success",
            "data": {"url": q._QrCodeLogin__qr_link, "key": q._QrCodeLogin__qr_key},
        }
    except Exception as e:
        logger.error(f"生成登录二维码失败: {type(e).__name__}: {str(e)}")
        import traceback

        logger.error(f"详细错误: {traceback.format_exc()}")
        return {"status": "error", "message": str(e)}


async def poll_login(qrcode_key, group_id=None):
    try:
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        q._QrCodeLogin__qr_key = qrcode_key

        event = await q.check_state()

        if event == login.QrCodeLoginEvents.DONE:
            logger.info(f"登录成功 (group_id: {group_id})")
            credential = q.get_credential()
            save_credential(credential)
            await ensure_buvid3(credential)
            return {"status": "success", "message": "登录成功"}
        if event == login.QrCodeLoginEvents.SCAN:
            return {"status": "pending", "code": 86101, "message": "等待扫码"}
        if event == login.QrCodeLoginEvents.CONF:
            return {"status": "pending", "code": 86090, "message": "已扫码，请在手机上确认"}
        if event == login.QrCodeLoginEvents.TIMEOUT:
            logger.warning("登录二维码已过期")
            return {"status": "error", "code": 86038, "message": "二维码已过期"}

        logger.warning(f"未知的登录状态: {event}")
        return {"status": "error", "message": "未知状态"}
    except Exception as e:
        logger.error(f"检查登录状态失败: {type(e).__name__}: {str(e)}")
        return {"status": "error", "message": str(e)}

