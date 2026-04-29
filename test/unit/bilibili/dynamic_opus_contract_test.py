import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from src.services.bili_server_core.services import dynamic_service


class _FakeDynamicClient:
    async def get_info(self):
        return {
            "item": {
                "id_str": "1155074769312284695",
                "type": "DYNAMIC_TYPE_ARTICLE",
                "basic": {"jump_url": "https://www.bilibili.com/opus/1155074769312284695"},
                "modules": {
                    "module_author": {
                        "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg"
                    },
                    "module_dynamic": {
                        "topic": {"name": "元宵节快乐"},
                        "desc": {
                            "text": "超级小爆！我发起了一个投票",
                            "rich_text_nodes": [],
                        },
                        "additional": {
                            "vote": {"title": "猪鼻大赛", "desc": "4人参与"}
                        },
                        "major": {
                            "type": "MAJOR_TYPE_OPUS",
                            "opus": {
                                "summary": {
                                    "text": "超级小爆！我发起了一个投票",
                                    "rich_text_nodes": [],
                                },
                                "pics": [],
                            },
                        },
                    },
                    "module_stat": {
                        "comment": {"count": 1},
                        "forward": {"count": 2},
                        "like": {"count": 3},
                    },
                },
            }
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
                                    "para_type": 1,
                                    "text": {
                                        "nodes": [
                                            {
                                                "type": "TEXT_NODE_TYPE_WORD",
                                                "word": {"words": "超级小爆！"},
                                            },
                                            {
                                                "type": "TEXT_NODE_TYPE_RICH",
                                                "rich": {
                                                    "type": "RICH_TEXT_NODE_TYPE_EMOJI",
                                                    "text": "[总之就是非常可爱_拜托你啦]",
                                                    "orig_text": "[总之就是非常可爱_拜托你啦]",
                                                    "emoji": {
                                                        "text": "[总之就是非常可爱_拜托你啦]",
                                                        "icon_url": "https://i0.hdslb.com/bfs/emote/test.png",
                                                    },
                                                },
                                            },
                                            {
                                                "type": "TEXT_NODE_TYPE_RICH",
                                                "rich": {
                                                    "type": "RICH_TEXT_NODE_TYPE_AT",
                                                    "text": "@Zzz做个好梦 ",
                                                    "orig_text": "@Zzz做个好梦 ",
                                                    "rid": "15156331",
                                                    "jump_url": "https://space.bilibili.com/15156331",
                                                },
                                            },
                                            {
                                                "type": "TEXT_NODE_TYPE_WORD",
                                                "word": {"words": "我发起了一个投票"},
                                            },
                                            {
                                                "type": "TEXT_NODE_TYPE_RICH",
                                                "rich": {
                                                    "type": "RICH_TEXT_NODE_TYPE_VOTE",
                                                    "text": "猪鼻大赛",
                                                    "orig_text": "猪鼻大赛",
                                                    "rid": "18017302",
                                                },
                                            },
                                        ]
                                    },
                                },
                                {
                                    "para_type": 2,
                                    "pic": {
                                        "pics": [
                                            {
                                                "url": "https://i0.hdslb.com/bfs/new_dyn/test.jpg",
                                                "width": 720,
                                                "height": 1280,
                                            }
                                        ]
                                    },
                                },
                                {
                                    "para_type": 6,
                                    "link_card": {
                                        "card": {
                                            "type": "LINK_CARD_TYPE_UGC",
                                            "ugc": {
                                                "title": "笑了就会被小南梁坐脸",
                                                "jump_url": "//www.bilibili.com/video/BV11dcUzAEc2/",
                                                "cover": "https://i0.hdslb.com/bfs/archive/video-cover.jpg",
                                                "width": 1280,
                                                "height": 720,
                                                "duration": "07:01",
                                                "stat": {"play": "1.8万", "danmaku": "88"},
                                            }
                                        },
                                    },
                                },
                                {
                                    "para_type": 6,
                                    "link_card": {
                                        "card": {
                                            "type": "LINK_CARD_TYPE_EVA3_VOTE",
                                            "vote": {
                                                "vote_id": "18017302",
                                                "title": "猪鼻大赛",
                                                "desc": "4人参与",
                                                "join_num": 4,
                                                "choice_cnt": 1,
                                            }
                                        },
                                    },
                                },
                            ]
                        },
                    }
                ]
            }
        }


class _FakeDynamicClientWithoutVote:
    async def get_info(self):
        return {
            "item": {
                "id_str": "1179264368735420423",
                "type": "DYNAMIC_TYPE_DRAW",
                "basic": {"jump_url": "https://www.bilibili.com/opus/1179264368735420423"},
                "modules": {
                    "module_author": {
                        "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg"
                    },
                    "module_dynamic": {
                        "desc": {
                            "text": "[夜愿华章表情包_叫我吗][夜愿华章表情包_叫我吗]",
                            "rich_text_nodes": [],
                        },
                        "major": {
                            "type": "MAJOR_TYPE_OPUS",
                            "opus": {
                                "summary": {
                                    "text": "[夜愿华章表情包_叫我吗][夜愿华章表情包_叫我吗]",
                                    "rich_text_nodes": [],
                                },
                                "pics": [],
                            },
                        },
                    },
                },
            }
        }


class _FakeDynamicClientWithExistingCommon:
    async def get_info(self):
        return {
            "item": {
                "id_str": "1175413428060160006",
                "type": "DYNAMIC_TYPE_DRAW",
                "basic": {"jump_url": "https://www.bilibili.com/opus/1175413428060160006"},
                "modules": {
                    "module_author": {
                        "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg"
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
                                },
                                "pics": [],
                            },
                        },
                    },
                },
            }
        }


class _FakeOpusClientWithoutVote:
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
                                            }
                                        },
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
                                            }
                                        },
                                    },
                                },
                            ]
                        },
                    }
                ]
            }
        }


class _FakeDegradedArticleDynamicClient:
    async def get_info(self):
        return {
            "item": {
                "id_str": "1179264368735420423",
                "type": "DYNAMIC_TYPE_ARTICLE",
                "basic": {"jump_url": "https://www.bilibili.com/read/cv45123193"},
                "modules": {
                    "module_author": {
                        "face": "https://i0.hdslb.com/bfs/face/member/noface.jpg"
                    },
                    "module_dynamic": {
                        "desc": {
                            "text": "",
                            "rich_text_nodes": [],
                        },
                        "major": {
                            "type": "MAJOR_TYPE_OPUS",
                            "opus": {
                                "title": "",
                                "summary": {
                                    "text": "",
                                    "rich_text_nodes": [],
                                },
                                "pics": [],
                                "jump_url": "https://www.bilibili.com/read/cv45123193",
                            },
                        },
                    },
                },
            }
        }


class _FakeEmptyOpusClient:
    async def get_info(self):
        return {"item": {"modules": []}}


class DynamicOpusContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_dynamic_detail_should_canonicalize_desc_and_summary_from_opus_body(self):
        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_service,
                "build_dynamic_detail_author_context",
                AsyncMock(
                    return_value={
                        "level": 0,
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
                dynamic_service.dynamic,
                "Dynamic",
                side_effect=lambda *_args, **_kwargs: _FakeDynamicClient(),
            ),
            patch.object(
                dynamic_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeOpusClient(),
            ),
        ):
            result = await dynamic_service.get_dynamic_detail("1155074769312284695")

        self.assertEqual(result["status"], "success")
        item = result["data"]["item"]
        module_dynamic = item["modules"]["module_dynamic"]
        desc = module_dynamic["desc"]
        summary = module_dynamic["major"]["opus"]["summary"]
        node_types = [node["type"] for node in desc["rich_text_nodes"]]

        self.assertEqual(desc["text"], summary["text"])
        self.assertEqual(desc["rich_text_nodes"], summary["rich_text_nodes"])
        self.assertIn("RICH_TEXT_NODE_TYPE_EMOJI", node_types)
        self.assertIn("RICH_TEXT_NODE_TYPE_AT", node_types)
        self.assertIn("RICH_TEXT_NODE_TYPE_VOTE", node_types)
        self.assertIn("RICH_TEXT_NODE_TYPE_TOPIC", node_types)
        self.assertTrue(desc["text"].endswith("#元宵节快乐#"))
        self.assertEqual(module_dynamic["additional"]["vote"]["title"], "猪鼻大赛")
        self.assertEqual(module_dynamic["topic"]["name"], "元宵节快乐")
        self.assertEqual(len(module_dynamic["additional"]["opus_link_cards"]), 1)
        self.assertEqual(
            module_dynamic["additional"]["opus_link_cards"][0]["card_type"],
            "LINK_CARD_TYPE_UGC",
        )
        self.assertEqual(
            module_dynamic["major"]["opus"]["pics"],
            [
                {
                    "url": "https://i0.hdslb.com/bfs/new_dyn/test.jpg",
                    "width": 720,
                    "height": 1280,
                }
            ],
        )

    async def test_get_dynamic_detail_should_add_opus_link_cards_and_vote_fallback_without_polluting_common(self):
        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_service,
                "build_dynamic_detail_author_context",
                AsyncMock(
                    return_value={
                        "level": 0,
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
                dynamic_service.dynamic,
                "Dynamic",
                side_effect=lambda *_args, **_kwargs: _FakeDynamicClientWithoutVote(),
            ),
            patch.object(
                dynamic_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeOpusClientWithoutVote(),
            ),
        ):
            result = await dynamic_service.get_dynamic_detail("1179264368735420423")

        self.assertEqual(result["status"], "success")
        module_dynamic = result["data"]["item"]["modules"]["module_dynamic"]
        additional = module_dynamic["additional"]

        self.assertNotIn("common", additional)
        self.assertEqual(len(additional["opus_link_cards"]), 1)
        self.assertEqual(additional["opus_link_cards"][0]["card_type"], "LINK_CARD_TYPE_COMMON")
        self.assertEqual(additional["opus_link_cards"][0]["title"], "原神")
        self.assertEqual(additional["vote"]["title"], "夜愿华章表情包你最喜欢哪个？")
        self.assertEqual(additional["vote"]["join_num"], 12)
        self.assertEqual(len(additional["vote"]["items"]), 2)

    async def test_get_dynamic_detail_should_dedupe_common_link_cards_against_existing_common(self):
        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_service,
                "build_dynamic_detail_author_context",
                AsyncMock(
                    return_value={
                        "level": 0,
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
                dynamic_service.dynamic,
                "Dynamic",
                side_effect=lambda *_args, **_kwargs: _FakeDynamicClientWithExistingCommon(),
            ),
            patch.object(
                dynamic_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeOpusClientWithoutVote(),
            ),
        ):
            result = await dynamic_service.get_dynamic_detail("1175413428060160006")

        self.assertEqual(result["status"], "success")
        module_dynamic = result["data"]["item"]["modules"]["module_dynamic"]
        additional = module_dynamic["additional"]

        self.assertEqual(additional["common"]["title"], "原神")
        self.assertNotIn("opus_link_cards", additional)
        self.assertEqual(additional["vote"]["title"], "夜愿华章表情包你最喜欢哪个？")
        self.assertEqual(additional["vote"]["join_num"], 12)

    async def test_get_dynamic_detail_should_disable_dynamic_redirect_when_falling_back_to_article(self):
        article_result = {
            "status": "success",
            "type": "article",
            "data": {
                "title": "article fallback title",
                "summary": "来自 article fallback 的完整正文",
            },
        }

        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(
                dynamic_service,
                "build_dynamic_detail_author_context",
                AsyncMock(
                    return_value={
                        "level": 0,
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
                dynamic_service.dynamic,
                "Dynamic",
                side_effect=lambda *_args, **_kwargs: _FakeDegradedArticleDynamicClient(),
            ),
            patch.object(
                dynamic_service.opus,
                "Opus",
                side_effect=lambda *_args, **_kwargs: _FakeEmptyOpusClient(),
            ),
            patch.object(
                dynamic_service,
                "get_article_info",
                AsyncMock(return_value=article_result),
            ) as mock_get_article_info,
        ):
            result = await dynamic_service.get_dynamic_detail("1179264368735420423")

        self.assertEqual(result["status"], "success")
        module_dynamic = result["data"]["item"]["modules"]["module_dynamic"]
        summary = module_dynamic["major"]["opus"]["summary"]
        self.assertEqual(module_dynamic["desc"]["text"], "来自 article fallback 的完整正文")
        self.assertEqual(summary["text"], "来自 article fallback 的完整正文")
        self.assertEqual(module_dynamic["major"]["opus"]["title"], "article fallback title")
        mock_get_article_info.assert_awaited_once_with(
            "45123193",
            None,
            allow_dynamic_redirect=False,
        )


if __name__ == "__main__":
    unittest.main()
