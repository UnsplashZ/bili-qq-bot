import io
import logging
import asyncio
import unittest
import warnings
from unittest import mock

from src.services.bili_server_core import logging_utils
from src.services.bili_server_core.services import video_service


class PythonRemainingLoggingTest(unittest.TestCase):
    def test_warn_level_should_not_emit_deprecation_warning(self):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging_utils.BridgeFormatter())

        warn_logger = logging.getLogger("test.python.warn")
        warn_logger.handlers = [handler]
        warn_logger.propagate = False
        warn_logger.setLevel(logging.INFO)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            logging_utils.log_event(
                warn_logger,
                "warn",
                "SERVICE",
                "req:warn_test",
                "warn-level-check",
                ok=True,
            )

        output = stream.getvalue()
        self.assertIn('"message":"warn-level-check"', output)
        self.assertFalse(
            any(item.category is DeprecationWarning for item in caught),
            "warn level should not emit DeprecationWarning",
        )

    def test_rpc_and_auth_helpers_should_emit_expected_channels(self):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging_utils.BridgeFormatter())

        rpc_logger = logging.getLogger("test.python.rpc")
        auth_logger = logging.getLogger("test.python.auth")
        rpc_logger.handlers = [handler]
        auth_logger.handlers = [handler]
        rpc_logger.propagate = False
        auth_logger.propagate = False
        rpc_logger.setLevel(logging.INFO)
        auth_logger.setLevel(logging.INFO)

        token = logging_utils.REQUEST_CONTEXT.set(
            {
                "req_id": "py_ab12cd",
                "endpoint": "login_check",
                "method": "POST",
                "path": "/login_check",
            }
        )
        try:
            logging_utils.rpc_log(rpc_logger, "error", "handler-failed", handler="login_check", error="boom")
            logging_utils.auth_log(auth_logger, "info", "cookie-refresh-succeeded", refreshed=True)
        finally:
            logging_utils.REQUEST_CONTEXT.reset(token)

        output = stream.getvalue()
        self.assertIn('"channel":"RPC"', output)
        self.assertIn('"message":"handler-failed"', output)
        self.assertIn('"handler":"login_check"', output)
        self.assertIn('"channel":"AUTH"', output)
        self.assertIn('"message":"cookie-refresh-succeeded"', output)

    def test_video_service_should_emit_structured_official_verify_warning(self):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging_utils.BridgeFormatter())

        video_service.logger.handlers = [handler]
        video_service.logger.propagate = False
        video_service.logger.setLevel(logging.INFO)
        video_service._OFFICIAL_VERIFY_CACHE.clear()

        token = logging_utils.REQUEST_CONTEXT.set(
            {
                "req_id": "vd_ab12cd",
                "endpoint": "video",
                "method": "POST",
                "path": "/video",
            }
        )
        try:
            with mock.patch.object(video_service, "load_credential", return_value=object()):
                with mock.patch.object(video_service.user, "User") as mocked_user:
                    mocked_user.return_value.get_user_info.side_effect = RuntimeError("boom")
                    result = asyncio.run(video_service._fetch_owner_official_verify("12345", "1000"))
        finally:
            logging_utils.REQUEST_CONTEXT.reset(token)

        self.assertIsNone(result)
        output = stream.getvalue()
        self.assertIn('"channel":"SERVICE"', output)
        self.assertIn('"message":"owner-official-verify-fetch-failed"', output)
        self.assertIn('"ownerMid":"12345"', output)
        self.assertIn('"groupId":"1000"', output)
        self.assertIn('"error":"boom"', output)


if __name__ == "__main__":
    unittest.main()
