import json
import logging
import os
import time

from bilibili_api import Credential

from ..config import CREDENTIAL_FILE, GROUP_COOKIES_MAP_FILE
from ..logging_utils import auth_log

logger = logging.getLogger(__name__)


def get_credential_file(group_id=None):
    if not group_id:
        return CREDENTIAL_FILE

    mapping = {}
    try:
        if os.path.exists(GROUP_COOKIES_MAP_FILE):
            with open(GROUP_COOKIES_MAP_FILE, "r") as f:
                mapping = json.load(f)
    except Exception:
        pass

    group_key = str(group_id)
    if group_key in mapping:
        return mapping[group_key]

    return f"data/cookies_{group_key}.json"


def load_credential(group_id=None):
    """
    加载B站凭证，仅使用全局Cookie (cookies.json)

    注意：group_id参数保留用于兼容性，但已被忽略。
    自2026-02-05起，群级Cookie支持已移除。
    """
    if os.path.exists(CREDENTIAL_FILE):
        try:
            with open(CREDENTIAL_FILE, "r") as f:
                data = json.load(f)
                sessdata = data.get("SESSDATA")
                bili_jct = data.get("BILI_JCT")
                buvid3 = data.get("BUVID3")

                if not buvid3:
                    auth_log(logger, "warn", "credential-buvid3-missing")

                timestamp = data.get("_timestamp", 0)
                if timestamp:
                    age_days = (time.time() - timestamp) / (24 * 3600)
                    if age_days > 7:
                        auth_log(logger, "warn", "credential-aging", age_days=round(age_days, 1))

                credential = Credential(
                    sessdata=sessdata,
                    bili_jct=bili_jct,
                    buvid3=buvid3,
                    dedeuserid=data.get("DEDEUSERID"),
                    ac_time_value=data.get("AC_TIME_VALUE"),
                )
                auth_log(logger, "debug", "credential-loaded")
                return credential
        except Exception as e:
            auth_log(logger, "error", "credential-load-failed", error=str(e))

    auth_log(logger, "debug", "credential-missing")
    return None


def save_credential(credential, group_id=None):
    if group_id:
        auth_log(logger, "warn", "credential-save-group-ignored", group_id=group_id)
    target_file = CREDENTIAL_FILE

    with open(target_file, "w") as f:
        json.dump(
            {
                "SESSDATA": credential.sessdata,
                "BILI_JCT": credential.bili_jct,
                "BUVID3": credential.buvid3,
                "DEDEUSERID": credential.dedeuserid,
                "AC_TIME_VALUE": credential.ac_time_value,
                "_timestamp": int(time.time()),
            },
            f,
        )
    auth_log(logger, "info", "credential-saved")
