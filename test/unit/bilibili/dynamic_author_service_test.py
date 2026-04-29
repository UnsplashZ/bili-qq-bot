import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from src.services.bili_server_core.services import dynamic_author_service


class _FakeUserClient:
    async def get_user_info(self):
        return {"level": 6}

    async def get_user_profile(self):
        return {
            "pendant": {"image": "https://example.com/pendant.png"},
            "decorate": {"card_url": "https://example.com/card.png"},
        }


class _FakeDetailUserClient:
    async def get_user_info(self):
        return {"level": 5}

    async def get_user_profile(self):
        return {
            "pendant": {"image": "https://example.com/detail-pendant.png"},
            "decorate": {"card_url": "https://example.com/detail-card.png"},
        }


class DynamicAuthorServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_build_user_dynamic_author_context_should_keep_existing_shape(self):
        dynamics = {
            "items": [
                {
                    "modules": {
                        "module_author": {
                            "face": "https://example.com/avatar.png",
                            "decoration_card": {
                                "card_number": "1001",
                                "fan": {"color": "#00A1D6"},
                            },
                        }
                    }
                }
            ]
        }

        with patch.object(
            dynamic_author_service,
            "get_image_focus_color",
            AsyncMock(side_effect=lambda url: f"focus:{url}"),
        ):
            result = await dynamic_author_service.build_user_dynamic_author_context(
                _FakeUserClient(),
                dynamics,
            )

        self.assertEqual(result["level"], 6)
        self.assertEqual(result["pendant_url"], "https://example.com/pendant.png")
        self.assertEqual(result["card_url"], "https://example.com/card.png")
        self.assertEqual(result["card_number"], "1001")
        self.assertEqual(result["fan_color"], "#00A1D6")
        self.assertEqual(result["card_focus_color"], "focus:https://example.com/card.png")
        self.assertEqual(result["avatar_focus_color"], "focus:https://example.com/avatar.png")

    async def test_build_dynamic_detail_author_context_should_fallback_to_user_profile_once(self):
        author_module = {
            "uid": "1",
            "face": "https://example.com/detail-avatar.png",
        }

        with (
            patch.object(dynamic_author_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_author_service.user,
                "User",
                side_effect=lambda *_args, **_kwargs: _FakeDetailUserClient(),
            ) as user_ctor,
            patch.object(
                dynamic_author_service,
                "get_image_focus_color",
                AsyncMock(side_effect=lambda url: f"focus:{url}"),
            ),
        ):
            result = await dynamic_author_service.build_dynamic_detail_author_context(
                author_module,
                group_id="test",
            )

        self.assertEqual(user_ctor.call_count, 1)
        self.assertEqual(result["level"], 5)
        self.assertEqual(result["pendant_url"], "https://example.com/detail-pendant.png")
        self.assertEqual(result["card_url"], "https://example.com/detail-card.png")
        self.assertEqual(result["card_focus_color"], "focus:https://example.com/detail-card.png")
        self.assertEqual(result["avatar_focus_color"], "focus:https://example.com/detail-avatar.png")


if __name__ == "__main__":
    unittest.main()
