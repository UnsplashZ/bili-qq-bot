import asyncio
import unittest
from unittest.mock import patch
import json

from src.services.bili_server_core.auth import credential_refresh
from src.services.bili_server_core.errors import classify_bili_error
from src.services.bili_server_core.web import handlers
from src.services.bili_server_core.services import feed_service, follow_service, user_service


class FakeCredential:
    sessdata = "sess"
    ac_time_value = "refresh-token"

    async def check_valid(self):
        raise TimeoutError()


class FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class PythonErrorEnvelopeTest(unittest.IsolatedAsyncioTestCase):
    async def test_my_info_not_logged_in_should_return_stable_error_envelope(self):
        with patch.object(user_service, "load_credential", return_value=None):
            result = await user_service.get_my_info("1000")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "auth_failed")
        self.assertEqual(result["httpStatus"], 401)
        self.assertEqual(result["retryable"], False)
        self.assertEqual(result["endpoint"], "my_info")
        self.assertIn("exceptionClass", result)
        self.assertIn("biliCode", result)

    async def test_dynamic_feed_not_logged_in_should_return_stable_error_envelope(self):
        with patch.object(feed_service, "load_credential", return_value=None):
            result = await feed_service.get_dynamic_feed(None, "1000")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "auth_failed")
        self.assertEqual(result["httpStatus"], 401)
        self.assertEqual(result["retryable"], False)
        self.assertEqual(result["endpoint"], "dynamic_feed")

    async def test_my_followings_not_logged_in_should_return_stable_error_envelope(self):
        with patch.object(follow_service, "load_credential", return_value=None):
            result = await follow_service.get_my_followings(None, "1000")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "auth_failed")
        self.assertEqual(result["httpStatus"], 401)
        self.assertEqual(result["retryable"], False)
        self.assertEqual(result["endpoint"], "my_followings")

    async def test_refresh_credential_timeout_should_be_retryable_not_auth_failed(self):
        with patch.object(credential_refresh, "load_credential", return_value=FakeCredential()):
            result = await credential_refresh.refresh_credential_if_needed()

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["reason"], "check_failed")
        self.assertEqual(result["errorType"], "transient_network")
        self.assertEqual(result["retryable"], True)
        self.assertEqual(result["endpoint"], "refresh_credential")

    async def test_cookie_worded_timeout_should_be_classified_as_network(self):
        self.assertEqual(
            classify_bili_error("Cookie有效性检查失败: timeout", error=TimeoutError()),
            "transient_network",
        )

    async def test_feed_service_http_5xx_should_be_server_error(self):
        error = RuntimeError("upstream failed")
        error.status_code = 503

        result = feed_service._error_envelope("upstream failed", "user_videos", error=error)

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "server_error")
        self.assertEqual(result["httpStatus"], 503)
        self.assertEqual(result["retryable"], True)
        self.assertEqual(result["endpoint"], "user_videos")

    async def test_feed_service_empty_timeout_error_should_be_retryable(self):
        error = TimeoutError()

        result = feed_service._error_envelope("", "live_feed", error=error)

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "transient_network")
        self.assertEqual(result["exceptionClass"], "TimeoutError")
        self.assertEqual(result["retryable"], True)

    async def test_non_subscription_user_card_timeout_should_return_stable_error_envelope(self):
        class FakeUser:
            async def get_user_info(self):
                raise TimeoutError()

        with patch.object(user_service, "load_credential", return_value=object()), patch.object(
            user_service.user, "User", return_value=FakeUser()
        ):
            result = await user_service.get_user_card("1")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "transient_network")
        self.assertEqual(result["exceptionClass"], "TimeoutError")
        self.assertEqual(result["retryable"], True)
        self.assertEqual(result["endpoint"], "user_card")

    async def test_non_subscription_user_info_timeout_should_return_stable_error_envelope(self):
        class FakeUser:
            async def get_user_info(self):
                raise TimeoutError()

        with patch.object(user_service, "load_credential", return_value=object()), patch.object(
            user_service.user, "User", return_value=FakeUser()
        ):
            result = await user_service.get_user_info("1")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "transient_network")
        self.assertEqual(result["retryable"], True)
        self.assertEqual(result["endpoint"], "user_info")

    async def test_non_subscription_user_search_errors_should_return_stable_error_envelope(self):
        async def timeout_search(*args, **kwargs):
            raise TimeoutError()

        missing = await user_service.search_users("")
        self.assertEqual(missing["status"], "error")
        self.assertEqual(missing["errorType"], "unknown")
        self.assertEqual(missing["httpStatus"], 400)
        self.assertEqual(missing["retryable"], False)
        self.assertEqual(missing["endpoint"], "user_search")

        with patch.object(user_service.search, "search_by_type", side_effect=timeout_search):
            result = await user_service.search_users("测试")

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errorType"], "transient_network")
        self.assertEqual(result["retryable"], True)
        self.assertEqual(result["endpoint"], "user_search")

    async def test_handlers_non_subscription_invalid_and_credential_errors_should_return_stable_envelope(self):
        search_response = await handlers.handle_user_search(FakeRequest({}))
        search_payload = json.loads(search_response.text)
        self.assertEqual(search_response.status, 400)
        self.assertEqual(search_payload["status"], "error")
        self.assertEqual(search_payload["errorType"], "unknown")
        self.assertEqual(search_payload["httpStatus"], 400)
        self.assertEqual(search_payload["retryable"], False)
        self.assertEqual(search_payload["endpoint"], "user_search")

        videos_response = await handlers.handle_user_videos(FakeRequest({}))
        videos_payload = json.loads(videos_response.text)
        self.assertEqual(videos_response.status, 400)
        self.assertEqual(videos_payload["status"], "error")
        self.assertEqual(videos_payload["errorType"], "unknown")
        self.assertEqual(videos_payload["httpStatus"], 400)
        self.assertEqual(videos_payload["retryable"], False)
        self.assertEqual(videos_payload["endpoint"], "user_videos")

        articles_response = await handlers.handle_user_articles(FakeRequest({}))
        articles_payload = json.loads(articles_response.text)
        self.assertEqual(articles_response.status, 400)
        self.assertEqual(articles_payload["status"], "error")
        self.assertEqual(articles_payload["errorType"], "unknown")
        self.assertEqual(articles_payload["httpStatus"], 400)
        self.assertEqual(articles_payload["retryable"], False)
        self.assertEqual(articles_payload["endpoint"], "user_articles")

        with patch.object(handlers, "load_credential", return_value=None):
            credential_response = await handlers.handle_credential_info(FakeRequest({}))
        credential_payload = json.loads(credential_response.text)

        self.assertEqual(credential_payload["status"], "error")
        self.assertEqual(credential_payload["errorType"], "auth_failed")
        self.assertEqual(credential_payload["httpStatus"], 401)
        self.assertEqual(credential_payload["retryable"], False)
        self.assertEqual(credential_payload["endpoint"], "credential_info")

    async def test_video_download_timeout_should_return_transient_network_envelope(self):
        async def timeout_download(*args, **kwargs):
            raise asyncio.TimeoutError()

        with patch.object(handlers, "download_video_file", new=timeout_download):
            response = await handlers.handle_video_download(FakeRequest({
                "bvid": "BV1xx",
                "page_index": 0,
                "resolution": "720p",
                "group_id": "1000",
            }))

        payload = json.loads(response.text)
        self.assertEqual(response.status, 504)
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["message"], "download_timeout")
        self.assertEqual(payload["errorType"], "transient_network")
        self.assertEqual(payload["failureKind"], "transient_network")
        self.assertEqual(payload["httpStatus"], 504)
        self.assertEqual(payload["retryable"], True)
        self.assertEqual(payload["endpoint"], "video_download")


if __name__ == "__main__":
    unittest.main()
