import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

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
                            ]
                        },
                    }
                ]
            }
        }


class DynamicOpusContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_dynamic_detail_should_canonicalize_desc_and_summary_from_opus_body(self):
        with (
            patch.object(dynamic_service, "load_credential", return_value=object()),
            patch.object(dynamic_service, "get_image_focus_color", AsyncMock(return_value=None)),
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


if __name__ == "__main__":
    unittest.main()
