import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.services.dynamic_topic_service import (
    ensure_topic_on_body,
    ensure_topic_on_dynamic,
)


class DynamicTopicServiceTest(unittest.TestCase):
    def test_ensure_topic_on_body_should_append_text_and_nodes(self):
        body = {"text": "正文", "rich_text_nodes": []}
        ensure_topic_on_body(body, {"name": "原神"})

        self.assertTrue(body["text"].endswith("#原神#"))
        self.assertEqual(body["rich_text_nodes"][-1]["type"], "RICH_TEXT_NODE_TYPE_TOPIC")

    def test_ensure_topic_on_dynamic_should_update_desc_and_summary(self):
        module_dynamic = {
            "topic": {"name": "原神"},
            "desc": {"text": "正文", "rich_text_nodes": []},
            "major": {
                "opus": {
                    "summary": {"text": "摘要", "rich_text_nodes": []}
                }
            },
        }

        ensure_topic_on_dynamic(module_dynamic)

        self.assertTrue(module_dynamic["desc"]["text"].endswith("#原神#"))
        self.assertTrue(module_dynamic["major"]["opus"]["summary"]["text"].endswith("#原神#"))


if __name__ == "__main__":
    unittest.main()
