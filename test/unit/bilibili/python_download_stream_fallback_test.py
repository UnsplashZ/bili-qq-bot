import asyncio
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import aiohttp

from src.services.bili_server_core.download import io_utils
from src.services.bili_server_core.download import service as download_service


class PythonDownloadStreamFallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_primary_timeout_should_use_backup_url(self):
        attempts = []

        async def fake_download(url, output_path):
            attempts.append(url)
            if "primary" in url:
                with open(output_path, "wb") as file:
                    file.write(b"partial")
                raise asyncio.TimeoutError("primary timed out")
            with open(output_path, "ab") as file:
                file.write(b"-backup-ok")

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "audio.tmp")
            with patch.object(
                io_utils, "_download_candidate_to_file", new=fake_download
            ), patch.object(io_utils, "service_log") as service_log:
                await io_utils.download_stream_to_file(
                    [
                        "https://primary.example.test/audio.m4s?token=secret",
                        "https://backup.example.test/audio.m4s?token=secret",
                    ],
                    output_path,
                    "audio",
                )

            with open(output_path, "rb") as file:
                self.assertEqual(file.read(), b"partial-backup-ok")

        self.assertEqual(
            attempts,
            [
                "https://primary.example.test/audio.m4s?token=secret",
                "https://backup.example.test/audio.m4s?token=secret",
            ],
        )
        failure_call, success_call = service_log.call_args_list
        self.assertEqual(failure_call.args[2], "download-stream-attempt-failed")
        self.assertEqual(failure_call.kwargs["streamType"], "audio")
        self.assertEqual(failure_call.kwargs["host"], "primary.example.test")
        self.assertEqual(failure_call.kwargs["retrying"], True)
        self.assertNotIn("token", str(failure_call.kwargs))
        self.assertEqual(success_call.args[2], "download-stream-fallback-ok")
        self.assertEqual(success_call.kwargs["host"], "backup.example.test")
        self.assertEqual(success_call.kwargs["resumeBytes"], len(b"partial"))

    async def test_all_candidates_failed_should_raise_last_network_error(self):
        attempts = []
        errors = [
            asyncio.TimeoutError("primary timed out"),
            aiohttp.ClientConnectionError("backup unavailable"),
        ]

        async def fake_download(url, output_path):
            error = errors[len(attempts)]
            attempts.append(url)
            with open(output_path, "ab") as file:
                file.write(b"partial")
            raise error

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "video.tmp")
            with patch.object(
                io_utils, "_download_candidate_to_file", new=fake_download
            ), patch.object(io_utils, "service_log") as service_log:
                with self.assertRaises(aiohttp.ClientConnectionError) as raised:
                    await io_utils.download_stream_to_file(
                        [
                            "https://primary.example.test/video.m4s",
                            "https://backup.example.test/video.m4s",
                        ],
                        output_path,
                        "video",
                    )

        self.assertIs(raised.exception, errors[-1])
        self.assertEqual(len(attempts), 2)
        self.assertFalse(os.path.exists(output_path))
        self.assertEqual(len(service_log.call_args_list), 2)
        self.assertEqual(
            service_log.call_args_list[-1].kwargs["retrying"], False
        )

    async def test_candidate_download_should_resume_with_range_header(self):
        requests = []

        class FakeContent:
            async def iter_chunked(self, chunk_size):
                self.chunk_size = chunk_size
                yield b"-rest"

        class FakeResponse:
            status = 206
            headers = {"Content-Range": "bytes 7-11/12"}
            content = FakeContent()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                del exc_type, exc, traceback

            def raise_for_status(self):
                return None

        class FakeSession:
            def __init__(self, timeout):
                self.timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                del exc_type, exc, traceback

            def get(self, url, headers):
                requests.append((url, headers))
                return FakeResponse()

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "audio.tmp")
            with open(output_path, "wb") as file:
                file.write(b"partial")

            with patch.object(io_utils.aiohttp, "ClientSession", FakeSession):
                await io_utils._download_candidate_to_file(
                    "https://backup.example.test/audio.m4s", output_path
                )

            with open(output_path, "rb") as file:
                self.assertEqual(file.read(), b"partial-rest")

        self.assertEqual(requests[0][1]["Range"], "bytes=7-")

    def test_candidate_urls_should_keep_primary_first_and_deduplicate(self):
        stream = SimpleNamespace(
            url="https://primary.example.test/video.m4s",
            backup_url=[
                "https://backup.example.test/video.m4s",
                "https://primary.example.test/video.m4s",
                "",
            ],
        )

        candidates = io_utils._normalize_candidate_urls(
            download_service._stream_candidate_urls(stream)
        )

        self.assertEqual(
            candidates,
            [
                "https://primary.example.test/video.m4s",
                "https://backup.example.test/video.m4s",
            ],
        )


if __name__ == "__main__":
    unittest.main()
