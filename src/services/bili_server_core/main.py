import argparse
import logging

from aiohttp import web

from .app import create_app
from .logging_utils import configure_python_logging, lifecycle_log

logger = logging.getLogger(__name__)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bili Service Server")
    parser.add_argument("--port", type=int, default=10001, help="Port to run the server on")
    args = parser.parse_args(argv)

    configure_python_logging()

    app = create_app()
    lifecycle_log(logger, "info", "server-start", host="127.0.0.1", port=args.port)
    web.run_app(app, host="127.0.0.1", port=args.port, access_log=None)
