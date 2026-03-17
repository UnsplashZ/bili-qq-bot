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
        self.assertEqual(payload["link_cards"], [])
        self.assertIsNone(payload["fallback_vote"])

    def test_extract_opus_content_payload_should_normalize_para_type_6_cards(self):
        payload = extract_opus_content_payload(
            {
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
                                                    "title": "搞笑视频合集",
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
                                                    "vote_id": "18017302",
                                                    "title": "猪鼻大赛",
                                                    "desc": "4人参与",
                                                    "join_num": 4,
                                                    "choice_cnt": 1,
                                                    "items": [
                                                        {"desc": "依然是真凉", "cnt": 2},
                                                        {"desc": "若樱", "cnt": 2},
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
        )

        self.assertEqual(len(payload["link_cards"]), 2)
        self.assertEqual(payload["link_cards"][0]["card_type"], "LINK_CARD_TYPE_UGC")
        self.assertEqual(payload["link_cards"][0]["badge_text"], "视频")
        self.assertEqual(payload["link_cards"][0]["duration_text"], "07:01")
        self.assertEqual(
            payload["link_cards"][0]["stats"],
            [{"label": "播放", "value": "1.8万"}, {"label": "弹幕", "value": "88"}],
        )
        self.assertEqual(payload["link_cards"][1]["card_type"], "LINK_CARD_TYPE_COMMON")
        self.assertEqual(payload["link_cards"][1]["badge_text"], "相关游戏")
        self.assertEqual(payload["fallback_vote"]["vote_id"], "18017302")
        self.assertEqual(payload["fallback_vote"]["choice_cnt"], 1)
        self.assertEqual(len(payload["fallback_vote"]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
