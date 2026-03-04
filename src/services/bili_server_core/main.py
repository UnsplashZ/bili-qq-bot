import argparse
import logging

from aiohttp import web

from .app import create_app

logger = logging.getLogger(__name__)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bili Service Server")
    parser.add_argument("--port", type=int, default=10001, help="Port to run the server on")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    app = create_app()
    logger.info(f"Starting server on 127.0.0.1:{args.port}")
    web.run_app(app, host="127.0.0.1", port=args.port)

