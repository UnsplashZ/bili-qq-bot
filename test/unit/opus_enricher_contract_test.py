import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.media.opus_enricher import extract_opus_content_payload


class OpusEnricherContractTest(unittest.TestCase):
    def test_extract_opus_content_payload_should_preserve_rich_text_nodes_and_images(self):
        payload = extract_opus_content_payload(
            {
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
                                                            "id": 2950,
                                                            "package_id": 158,
                                                            "jump_url": "https://www.bilibili.com/h5/emoji",
                                                            "jump_title": "拜托你啦",
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
        )

        self.assertEqual(
            payload["text"],
            "超级小爆！[总之就是非常可爱_拜托你啦]@Zzz做个好梦 我发起了一个投票猪鼻大赛",
        )
        self.assertEqual(len(payload["rich_text_nodes"]), 5)
        self.assertEqual(payload["rich_text_nodes"][0]["type"], "RICH_TEXT_NODE_TYPE_TEXT")
        self.assertEqual(payload["rich_text_nodes"][1]["type"], "RICH_TEXT_NODE_TYPE_EMOJI")
        self.assertEqual(payload["rich_text_nodes"][1]["emoji"]["icon_url"], "https://i0.hdslb.com/bfs/emote/test.png")
        self.assertEqual(payload["rich_text_nodes"][2]["type"], "RICH_TEXT_NODE_TYPE_AT")
        self.assertEqual(payload["rich_text_nodes"][3]["type"], "RICH_TEXT_NODE_TYPE_TEXT")
        self.assertEqual(payload["rich_text_nodes"][4]["type"], "RICH_TEXT_NODE_TYPE_VOTE")
        self.assertEqual(
            payload["images"],
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
