RETRYABLE_ERROR_TYPES = {"transient_network", "rate_limited", "server_error"}
AUTH_BILI_CODES = {-101, -102, -111, -112}
RATE_LIMIT_BILI_CODES = {-412, 412}


def extract_bili_code(error):
    if error is None:
        return None

    for attr in ("code", "retcode", "bili_code"):
        value = getattr(error, attr, None)
        if value is not None:
            return value

    for arg in getattr(error, "args", []) or []:
        if isinstance(arg, dict):
            for key in ("code", "retcode", "biliCode"):
                if key in arg:
                    return arg.get(key)

    return None


def _normalize_int(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _extract_http_status(error, http_status=None):
    if http_status is not None or error is None:
        return _normalize_int(http_status)

    for attr in ("status", "status_code", "http_status"):
        value = getattr(error, attr, None)
        if value is not None:
            return _normalize_int(value)

    for arg in getattr(error, "args", []) or []:
        if isinstance(arg, dict):
            value = arg.get("httpStatus") or arg.get("http_status") or arg.get("status")
            if value is not None:
                return _normalize_int(value)

    return None


def _exception_text(error):
    if error is None:
        return ""
    exception_name = error.__class__.__name__.lower()
    exception_module = error.__class__.__module__.lower()
    return f"{exception_module}.{exception_name}"


def classify_bili_error(message, error=None, http_status=None, bili_code=None):
    lowered = str(message or "").lower()
    exception_text = _exception_text(error)
    numeric_bili_code = _normalize_int(bili_code if bili_code is not None else extract_bili_code(error))
    numeric_http_status = _extract_http_status(error, http_status)
    has_network_evidence = any(marker in lowered for marker in ("timeout", "timed out", "超时", "network", "socket")) or any(
        marker in exception_text
        for marker in ("timeout", "clientconnector", "clientconnection", "socket", "connectionreset")
    )
    has_auth_evidence = any(
        marker in lowered for marker in ("未登录", "cookie", "credential", "csrf", "sessdata", "login")
    )

    if numeric_bili_code in AUTH_BILI_CODES:
        return "auth_failed"

    if numeric_bili_code in RATE_LIMIT_BILI_CODES or numeric_http_status == 429 or any(
        marker in lowered for marker in ("rate limit", "too many requests", "请求过于频繁", "风控")
    ):
        return "rate_limited"

    if has_network_evidence:
        return "transient_network"

    if has_auth_evidence:
        return "auth_failed"

    if numeric_http_status is not None and numeric_http_status >= 500:
        return "server_error"

    return "unknown"


def error_envelope(message, endpoint, error=None, error_type=None, http_status=None, reason=None):
    numeric_bili_code = _normalize_int(extract_bili_code(error))
    numeric_http_status = _extract_http_status(error, http_status)
    resolved_type = error_type or classify_bili_error(
        message,
        error=error,
        http_status=numeric_http_status,
        bili_code=numeric_bili_code,
    )

    if numeric_http_status is None:
        if resolved_type == "auth_failed":
            numeric_http_status = 401
        elif resolved_type == "rate_limited":
            numeric_http_status = 429

    payload = {
        "status": "error",
        "message": str(message),
        "errorType": resolved_type,
        "failureKind": resolved_type,
        "exceptionClass": error.__class__.__name__ if error is not None else None,
        "biliCode": numeric_bili_code,
        "httpStatus": numeric_http_status,
        "retryable": resolved_type in RETRYABLE_ERROR_TYPES,
        "endpoint": endpoint,
    }
    if reason is not None:
        payload["reason"] = reason
    return payload


def invalid_request_envelope(message, endpoint):
    return error_envelope(
        message,
        endpoint,
        error=ValueError(message),
        error_type="unknown",
        http_status=400,
    )


def auth_failed_envelope(message, endpoint):
    return error_envelope(message, endpoint, error_type="auth_failed", http_status=401)
