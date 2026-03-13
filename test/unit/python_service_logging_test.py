import json
import unittest

from aiohttp.test_utils import make_mocked_request

from src.services.bili_server_core import logging_utils


class PythonServiceLoggingTest(unittest.TestCase):
    def test_build_request_context_should_extract_req_id_and_endpoint(self):
        request = make_mocked_request(
            "POST",
            "/dynamic_detail",
            headers={
                "x-request-id": "dy_abc123",
                "x-rpc-endpoint": "dynamic_detail",
            },
        )

        context = logging_utils.build_request_context(request)

        self.assertEqual(context["req_id"], "dy_abc123")
        self.assertEqual(context["endpoint"], "dynamic_detail")
        self.assertEqual(context["method"], "POST")
        self.assertEqual(context["path"], "/dynamic_detail")

    def test_build_bridge_line_should_include_request_summary_fields(self):
        line = logging_utils.build_bridge_line(
            "info",
            "HTTP",
            "req:dy_abc123",
            "done",
            {
                "method": "POST",
                "path": "/dynamic_detail",
                "status": 200,
                "duration": "12ms",
            },
        )

        self.assertTrue(line.startswith(logging_utils.PY_LOG_BRIDGE_PREFIX))
        payload = json.loads(line[len(logging_utils.PY_LOG_BRIDGE_PREFIX) :])

        self.assertEqual(payload["level"], "info")
        self.assertEqual(payload["channel"], "HTTP")
        self.assertEqual(payload["scope"], "req:dy_abc123")
        self.assertEqual(payload["message"], "done")
        self.assertEqual(payload["fields"]["method"], "POST")
        self.assertEqual(payload["fields"]["path"], "/dynamic_detail")
        self.assertEqual(payload["fields"]["status"], 200)
        self.assertEqual(payload["fields"]["duration"], "12ms")


if __name__ == "__main__":
    unittest.main()
