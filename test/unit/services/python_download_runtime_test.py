import asyncio
import json
import os
import unittest
from unittest.mock import patch

from src.services.bili_server_core.web.download_tasks import DownloadTaskRegistry
from src.services.bili_server_core.web.handlers import health_check


class PythonDownloadRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_waits_for_task_finally_and_reports_terminal(self):
        registry = DownloadTaskRegistry()
        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def work():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.set()

        running = asyncio.create_task(registry.run("task_cancel_123", work))
        await started.wait()
        status = await registry.cancel("task_cancel_123")

        self.assertTrue(cleaned.is_set())
        self.assertTrue(status["terminal"])
        self.assertEqual(status["state"], "cancelled")
        with self.assertRaises(asyncio.CancelledError):
            await running

    async def test_success_reports_terminal_without_exposing_result(self):
        registry = DownloadTaskRegistry()
        result = await registry.run("task_success_123", lambda: asyncio.sleep(0, result={"secret": "x"}))
        await asyncio.sleep(0)
        status = registry.public_status("task_success_123")

        self.assertEqual(result, {"secret": "x"})
        self.assertEqual(status["state"], "succeeded")
        self.assertTrue(status["terminal"])
        self.assertNotIn("result", status)

    async def test_health_returns_runtime_identity(self):
        env = {
            "BILI_RUNTIME_INSTANCE_ID": "instance-1",
            "BILI_RUNTIME_RESOURCE_GENERATION": "7",
            "BILI_RUNTIME_EFFECT_HASH": "effect-hash",
            "BILI_RUNTIME_BUILD_VERSION": "1.2.3",
        }
        with patch.dict(os.environ, env, clear=False):
            response = await health_check(None)
        payload = json.loads(response.text)

        self.assertEqual(payload["instanceId"], "instance-1")
        self.assertEqual(payload["resourceGeneration"], 7)
        self.assertEqual(payload["effectHash"], "effect-hash")
        self.assertEqual(payload["buildVersion"], "1.2.3")
        self.assertGreater(payload["pid"], 0)


if __name__ == "__main__":
    unittest.main()
