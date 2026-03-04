import logging

from aiohttp import web

from .web.routes import get_routes

logger = logging.getLogger(__name__)


async def on_startup(app):
    del app
    logger.info("Application starting up...")


async def on_cleanup(app):
    del app
    logger.info("Application shutting down...")


def create_app():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.add_routes(get_routes())
    return app

