"""
Compatibility entrypoint for the Bilibili Python service.

This file intentionally remains thin. Core implementation lives under
`src/services/bili_server_core/`.
"""

try:
    # Package import path (e.g. `python -m src.services.bili_server`)
    from .bili_server_core.app import create_app
    from .bili_server_core.main import main
except ImportError:
    # Script execution path (e.g. `python src/services/bili_server.py`)
    from bili_server_core.app import create_app
    from bili_server_core.main import main

__all__ = ["create_app", "main"]


if __name__ == "__main__":
    main()
