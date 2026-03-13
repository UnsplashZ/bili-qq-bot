import logging

from aiohttp import web

from .logging_utils import lifecycle_log, request_logging_middleware
from .web.routes import get_routes

logger = logging.getLogger(__name__)


async def on_startup(app):
    del app
    lifecycle_log(logger, "info", "app-startup")


async def on_cleanup(app):
    del app
    lifecycle_log(logger, "info", "app-cleanup")


def create_app():
    app = web.Application(middlewares=[request_logging_middleware])
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.add_routes(get_routes())
    return app
