import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.services import focus_service


class FocusServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_build_focus_should_keep_cover_and_avatar_shape(self):
        with patch.object(
            focus_service,
            "get_image_focus_color",
            AsyncMock(side_effect=lambda url: f"focus:{url}"),
        ) as focus_mock:
            result = await focus_service.build_focus("cover.jpg", "avatar.jpg")

        self.assertEqual(
            result,
            {"cover": "focus:cover.jpg", "avatar": "focus:avatar.jpg"},
        )
        self.assertEqual(focus_mock.await_count, 2)

    async def test_build_focus_should_return_none_for_missing_urls(self):
        with patch.object(
            focus_service,
            "get_image_focus_color",
            AsyncMock(return_value="unused"),
        ) as focus_mock:
            result = await focus_service.build_focus("", None)
            avatar_only = await focus_service.build_avatar_focus("avatar.jpg")
            cover_only = await focus_service.build_cover_focus("")

        self.assertEqual(result, {"cover": None, "avatar": None})
        self.assertEqual(avatar_only, {"avatar": "unused"})
        self.assertEqual(cover_only, {"cover": None})
        self.assertEqual(focus_mock.await_count, 1)


if __name__ == "__main__":
    unittest.main()
