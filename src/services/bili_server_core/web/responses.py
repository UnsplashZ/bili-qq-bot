from aiohttp import web


def json_result(payload: dict, status: int = 200):
    return web.json_response(payload, status=status)


def json_error(message: str, status: int = 200, **extra):
    payload = {"status": "error", "message": message}
    payload.update(extra)
    return web.json_response(payload, status=status)

