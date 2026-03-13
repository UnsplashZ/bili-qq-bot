import contextvars
import json
import logging
import os
import time
import uuid

from aiohttp import web

PY_LOG_BRIDGE_PREFIX = "__PYLOG__"
REQUEST_CONTEXT_KEY = "request_log_context"
REQUEST_CONTEXT = contextvars.ContextVar("request_log_context", default=None)
LEVEL_NAME_MAP = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "WARN": "warn",
    "ERROR": "error",
    "CRITICAL": "fatal",
    "FATAL": "fatal",
}
HTTP_LOGGER = logging.getLogger("bili_server_core.http")


def build_bridge_line(level, channel, scope, message, fields=None):
    payload = {
        "level": level,
        "channel": channel,
        "scope": scope,
        "message": message,
        "fields": fields or {},
    }
    return PY_LOG_BRIDGE_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def build_request_context(request):
    endpoint = request.headers.get("x-rpc-endpoint") or request.path.lstrip("/") or "unknown"
    return {
        "req_id": request.headers.get("x-request-id") or f"py_{uuid.uuid4().hex[:6]}",
        "endpoint": endpoint,
        "method": request.method,
        "path": request.path,
    }


def get_current_request_context():
    return REQUEST_CONTEXT.get() or {}


def _resolve_channel(logger_name):
    if logger_name == "aiohttp.access" or logger_name.endswith(".http"):
        return "HTTP"
    if ".services." in logger_name:
        return "SERVICE"
    if ".web.handlers" in logger_name:
        return "RPC"
    return "PY"


def _resolve_scope(logger_name, context):
    if context.get("req_id"):
        return f"req:{context['req_id']}"
    if logger_name.endswith(".main") or logger_name.endswith(".app"):
        return "svc:lifecycle"
    return f"py:{logger_name.split('.')[-1] or 'service'}"


class BridgeFormatter(logging.Formatter):
    def format(self, record):
        context = get_current_request_context()
        fields = dict(getattr(record, "fields", {}) or {})
        channel = getattr(record, "channel", None) or _resolve_channel(record.name)
        if context:
            fields.setdefault("endpoint", context.get("endpoint"))
            if channel == "HTTP":
                fields.setdefault("method", context.get("method"))
                fields.setdefault("path", context.get("path"))
        if record.exc_info:
            fields.setdefault("traceback", self.formatException(record.exc_info))

        return build_bridge_line(
            LEVEL_NAME_MAP.get(record.levelname, "info"),
            channel,
            getattr(record, "scope", None) or _resolve_scope(record.name, context),
            record.getMessage(),
            fields,
        )


def configure_python_logging():
    handler = logging.StreamHandler()
    if os.getenv("BILI_PY_LOG_BRIDGE") == "1":
        handler.setFormatter(BridgeFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


def log_event(logger, level, channel, scope, message, **fields):
    logger_method = "warning" if level == "warn" else level
    getattr(logger, logger_method)(
        message,
        extra={
            "channel": channel,
            "scope": scope,
            "fields": fields,
        },
    )


def lifecycle_log(logger, level, message, **fields):
    log_event(logger, level, "PY", "svc:lifecycle", message, **fields)


def rpc_log(logger, level, message, **fields):
    context = get_current_request_context()
    scope = f"req:{context['req_id']}" if context.get("req_id") else "svc:rpc"
    merged_fields = dict(fields)
    if context.get("endpoint"):
        merged_fields.setdefault("endpoint", context["endpoint"])
    log_event(logger, level, "RPC", scope, message, **merged_fields)


def auth_log(logger, level, message, **fields):
    context = get_current_request_context()
    scope = f"req:{context['req_id']}" if context.get("req_id") else "svc:auth"
    merged_fields = dict(fields)
    if context.get("endpoint"):
        merged_fields.setdefault("endpoint", context["endpoint"])
    log_event(logger, level, "AUTH", scope, message, **merged_fields)


def service_log(logger, level, message, **fields):
    context = get_current_request_context()
    scope = f"req:{context['req_id']}" if context.get("req_id") else "svc:service"
    merged_fields = dict(fields)
    if context.get("endpoint"):
        merged_fields.setdefault("endpoint", context["endpoint"])
    log_event(logger, level, "SERVICE", scope, message, **merged_fields)


def _extract_app_status(response):
    body = getattr(response, "body", None)
    if not body:
        return ""
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        return ""
    return payload.get("status") or ""


@web.middleware
async def request_logging_middleware(request, handler):
    context = build_request_context(request)
    request[REQUEST_CONTEXT_KEY] = context
    token = REQUEST_CONTEXT.set(context)
    started = time.perf_counter()

    log_event(
        HTTP_LOGGER,
        "info",
        "HTTP",
        f"req:{context['req_id']}",
        "recv",
        method=context["method"],
        path=context["path"],
        endpoint=context["endpoint"],
    )

    try:
        response = await handler(request)
    except Exception as error:
        log_event(
            HTTP_LOGGER,
            "error",
            "HTTP",
            f"req:{context['req_id']}",
            "fail",
            method=context["method"],
            path=context["path"],
            endpoint=context["endpoint"],
            duration=f"{int((time.perf_counter() - started) * 1000)}ms",
            error=str(error),
        )
        raise
    finally:
        REQUEST_CONTEXT.reset(token)

    app_status = _extract_app_status(response)
    level = "warn" if app_status == "error" or response.status >= 500 else "info"
    log_event(
        HTTP_LOGGER,
        level,
        "HTTP",
        f"req:{context['req_id']}",
        "done",
        method=context["method"],
        path=context["path"],
        endpoint=context["endpoint"],
        status=response.status,
        appStatus=app_status,
        duration=f"{int((time.perf_counter() - started) * 1000)}ms",
    )
    return response
