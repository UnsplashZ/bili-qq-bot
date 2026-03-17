import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.services import user_service
from src.services.bili_server_core.services import opus_additional_service


class _FakeUserClient:
    async def get_user_info(self):
        return {
            "mid": 1,
            "name": "tester",
            "level": 6,
            "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg",
        }

    async def get_relation_info(self):
        return {"follower": 1, "following": 2}

    async def get_up_stat(self):
        return {"likes": 3, "archive": {"view": 4}}

    async def get_dynamics_new(self, offset=""):
        return {
            "items": [
                {
                    "id_str": "1179264368735420423",
                    "modules": {
                        "module_author": {"pub_ts": 1700000000},
                        "module_dynamic": {
                            "desc": {
                                "text": "正文",
                                "rich_text_nodes": [],
                            },
                            "major": {
                                "type": "MAJOR_TYPE_OPUS",
                                "opus": {
                                    "summary": {
                                        "text": "正文",
                                        "rich_text_nodes": [],
                                    }
                                },
                            },
                        },
                    },
                }
            ]
        }


class _FakeOpusClient:
    async def get_info(self):
        return {
            "item": {
                "modules": [
                    {
                        "module_type": "MODULE_TYPE_CONTENT",
                        "module_content": {
                            "paragraphs": [
                                {
                                    "para_type": 6,
                                    "link_card": {
                                        "card": {
                                            "type": "LINK_CARD_TYPE_UGC",
                                            "ugc": {
                                                "title": "笑了就会被小南梁坐脸",
                                                "jump_url": "//www.bilibili.com/video/BV11dcUzAEc2/",
                                                "cover": "https://i0.hdslb.com/bfs/archive/video-cover.jpg",
                                                "duration": "07:01",
                                                "stat": {"play": "1.8万", "danmaku": "90"},
                                            },
                                        }
                                    },
                                }
                            ]
                        },
                    }
                ]
            }
        }


class _FakeUserClientWithCommonAndVoteFallback(_FakeUserClient):
    async def get_dynamics_new(self, offset=""):
        return {
            "items": [
                {
                    "id_str": "1175413428060160006",
                    "modules": {
                        "module_author": {"pub_ts": 1700000001},
                        "module_dynamic": {
                            "desc": {
                                "text": "正文",
                                "rich_text_nodes": [],
                            },
                            "additional": {
                                "common": {
                                    "head_text": "相关游戏",
                                    "title": "原神",
                                    "desc1": "角色扮演/二次元/冒险",
                                    "desc2": "跨越尘世的探索之旅",
                                    "jump_url": "https://www.biligame.com/detail?id=103496",
                                    "cover": "https://i0.hdslb.com/bfs/game/game-cover.png",
                                }
                            },
                            "major": {
                                "type": "MAJOR_TYPE_OPUS",
                                "opus": {
                                    "summary": {
                                        "text": "正文",
                                        "rich_text_nodes": [],
                                    }
                                },
                            },
                        },
                    },
                }
            ]
        }


class _FakeOpusClientWithCommonAndVoteFallback:
    async def get_info(self):
        return {
            "item": {
                "modules": [
                    {
                        "module_type": "MODULE_TYPE_CONTENT",
                        "module_content": {
                            "paragraphs": [
                                {
                                    "para_type": 6,
                                    "link_card": {
                                        "card": {
                                            "type": "LINK_CARD_TYPE_COMMON",
                                            "common": {
                                                "head_text": "相关游戏",
                                                "title": "原神",
                                                "desc1": "角色扮演/二次元/冒险",
                                                "desc2": "跨越尘世的探索之旅",
                                                "jump_url": "https://www.biligame.com/detail?id=103496",
                                                "cover": "https://i0.hdslb.com/bfs/game/game-cover.png",
                                            },
                                        }
                                    },
                                },
                                {
                                    "para_type": 6,
                                    "link_card": {
                                        "card": {
                                            "type": "LINK_CARD_TYPE_EVA3_VOTE",
                                            "vote": {
                                                "title": "夜愿华章表情包你最喜欢哪个？",
                                                "desc": "12人参与",
                                                "join_num": 12,
                                                "choice_cnt": 1,
                                                "items": [
                                                    {"desc": "叫我吗", "cnt": 9},
                                                    {"desc": "你别急", "cnt": 3},
                                                ],
                                            },
                                        }
                                    },
                                },
                            ]
                        },
                    }
                ]
            }
        }


class UserOpusLinkCardContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_user_info_should_enrich_latest_opus_dynamic_with_link_cards(self):
        with (
            patch.object(user_service, "load_credential", return_value=object()),
            patch.object(opus_additional_service, "load_credential", return_value=object()),
            patch.object(user_service, "get_image_focus_color", AsyncMock(return_value=None)),
            patch.object(
                user_service.user,
                "User",
                side_effect=lambda *_args, **_kwargs: _FakeUserClient(),
            ),
            patch.object(
                opus_additional_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeOpusClient(),
            ),
        ):
            result = await user_service.get_user_info("1")

        self.assertEqual(result["status"], "success")
        latest_dynamic = result["data"]["dynamic"]
        additional = latest_dynamic["modules"]["module_dynamic"]["additional"]
        self.assertEqual(len(additional["opus_link_cards"]), 1)
        self.assertEqual(additional["opus_link_cards"][0]["card_type"], "LINK_CARD_TYPE_UGC")
        self.assertEqual(additional["opus_link_cards"][0]["duration_text"], "07:01")

    async def test_get_user_info_should_keep_common_shape_and_use_vote_fallback(self):
        with (
            patch.object(user_service, "load_credential", return_value=object()),
            patch.object(opus_additional_service, "load_credential", return_value=object()),
            patch.object(user_service, "get_image_focus_color", AsyncMock(return_value=None)),
            patch.object(
                user_service.user,
                "User",
                side_effect=lambda *_args, **_kwargs: _FakeUserClientWithCommonAndVoteFallback(),
            ),
            patch.object(
                opus_additional_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeOpusClientWithCommonAndVoteFallback(),
            ),
        ):
            result = await user_service.get_user_info("1")

        self.assertEqual(result["status"], "success")
        latest_dynamic = result["data"]["dynamic"]
        additional = latest_dynamic["modules"]["module_dynamic"]["additional"]
        self.assertEqual(additional["common"]["title"], "原神")
        self.assertNotIn("opus_link_cards", additional)
        self.assertEqual(additional["vote"]["title"], "夜愿华章表情包你最喜欢哪个？")
        self.assertEqual(additional["vote"]["join_num"], 12)
        self.assertEqual(len(additional["vote"]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
