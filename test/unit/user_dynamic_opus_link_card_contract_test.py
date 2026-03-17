import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.services import dynamic_service
from src.services.bili_server_core.services import opus_additional_service


class _FakeUserClient:
    async def get_dynamics_new(self, offset=""):
        return {
            "items": [
                {
                    "id_str": "1179264368735420423",
                    "type": "DYNAMIC_TYPE_DRAW",
                    "modules": {
                        "module_author": {
                            "pub_ts": 1700000000,
                            "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg",
                        },
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
                },
                {
                    "id_str": "1175413428060160006",
                    "type": "DYNAMIC_TYPE_DRAW",
                    "modules": {
                        "module_author": {
                            "pub_ts": 1700000001,
                            "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg",
                        },
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
                },
            ]
        }

    async def get_user_info(self):
        return {"level": 6}

    async def get_user_profile(self):
        return {}


class _FakeOpusClient:
    def __init__(self, item_id):
        self.item_id = str(item_id)

    async def get_info(self):
        if self.item_id == "1179264368735420423":
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
                                                    "stat": {"play": "1.8万", "danmaku": "88"},
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


class UserDynamicOpusLinkCardContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_user_dynamic_should_match_detail_contract_for_opus_additional(self):
        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(opus_additional_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_service,
                "build_user_dynamic_author_context",
                AsyncMock(
                    return_value={
                        "level": 6,
                        "pendant_url": None,
                        "card_url": None,
                        "decoration_card": None,
                        "card_number": None,
                        "card_focus_color": None,
                        "fan_color": None,
                        "avatar_focus_color": None,
                    }
                ),
            ),
            patch.object(
                dynamic_service.user,
                "User",
                side_effect=lambda *_args, **_kwargs: _FakeUserClient(),
            ),
            patch.object(
                opus_additional_service.opus,
                "Opus",
                side_effect=lambda item_id, *_args, **_kwargs: _FakeOpusClient(item_id),
            ),
        ):
            result = await dynamic_service.get_user_dynamic("1")

        self.assertEqual(result["status"], "success")
        cards = result["data"]["cards"]
        self.assertEqual(len(cards), 2)

        ugc_additional = cards[0]["modules"]["module_dynamic"]["additional"]
        self.assertEqual(len(ugc_additional["opus_link_cards"]), 1)
        self.assertEqual(ugc_additional["opus_link_cards"][0]["card_type"], "LINK_CARD_TYPE_UGC")
        self.assertEqual(ugc_additional["opus_link_cards"][0]["duration_text"], "07:01")

        deduped_additional = cards[1]["modules"]["module_dynamic"]["additional"]
        self.assertEqual(deduped_additional["common"]["title"], "原神")
        self.assertNotIn("opus_link_cards", deduped_additional)
        self.assertEqual(deduped_additional["vote"]["title"], "夜愿华章表情包你最喜欢哪个？")
        self.assertEqual(deduped_additional["vote"]["join_num"], 12)
        self.assertEqual(len(deduped_additional["vote"]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
