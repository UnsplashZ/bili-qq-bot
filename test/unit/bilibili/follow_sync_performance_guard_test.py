import unittest
from unittest.mock import AsyncMock, patch

from src.services.bili_server_core.services import follow_service


class FakeUserClient:
    async def get_followings(self, pn=1, ps=50):
        if pn == 1:
            return {
                "list": [
                    {
                        "mid": 101,
                        "uname": "tester",
                        "face": "https://example.com/a.png",
                        "sign": "hello",
                    }
                ],
                "total": 1,
            }
        return {"list": [], "total": 1}


class FakeApi:
    group_users_calls = 0

    def __init__(self, url, method="GET", credential=None):
        self.url = url
        self.method = method
        self.credential = credential
        self.params = {}

    def update_params(self, **kwargs):
        self.params.update(kwargs)

    @property
    def result(self):
        async def _run():
            if self.url.endswith("/x/relation/tags"):
                return [{"name": "分组A", "tagid": 11, "count": 1}]
            if self.url.endswith("/x/relation/tag"):
                FakeApi.group_users_calls += 1
                return [{"mid": 101, "uname": "tester"}]
            return []

        return _run()


class FollowSyncPerformanceGuardTest(unittest.IsolatedAsyncioTestCase):
    async def test_tag_users_cache_hit_should_skip_redundant_full_fetch(self):
        follow_service._tag_users_cache.clear()
        follow_service._tag_users_inflight.clear()
        FakeApi.group_users_calls = 0

        with (
            patch.object(follow_service, "load_credential", return_value=object()),
            patch.object(
                follow_service.user,
                "get_self_info",
                AsyncMock(return_value={"mid": 777}),
            ),
            patch.object(
                follow_service.user,
                "User",
                side_effect=lambda uid, credential: FakeUserClient(),
            ),
            patch.object(follow_service, "Api", side_effect=FakeApi),
        ):
            first = await follow_service.get_my_followings(None, "1000")
            second = await follow_service.get_my_followings(None, "1000")

        self.assertEqual(first.get("status"), "success")
        self.assertEqual(second.get("status"), "success")
        self.assertEqual(FakeApi.group_users_calls, 1)


if __name__ == "__main__":
    unittest.main()
