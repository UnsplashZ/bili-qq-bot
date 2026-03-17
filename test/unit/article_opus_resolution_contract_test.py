import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.services.bili_server_core.services import article_service


class _FakeArticleClient:
    async def get_info(self):
        return {
            "id": 45123193,
            "title": "旧标题",
            "mid": 946974,
            "author_name": "影视飓风",
            "banner_url": "",
            "image_urls": [],
            "stats": {"share": 0, "like": 9668, "reply": 391},
            "publish_time": 1706604300,
        }

    async def fetch_content(self):
        raise RuntimeError("未找到相关信息")


class _FakeUserClient:
    async def get_user_info(self):
        return {"face": "https://i0.hdslb.com/bfs/face/test-author.jpg"}


class ArticleOpusResolutionContractTest(unittest.IsolatedAsyncioTestCase):
    @patch("src.services.bili_server_core.services.article_service.build_focus", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service._resolve_article_canonical", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.user.User")
    @patch("src.services.bili_server_core.services.article_service.article.Article")
    async def test_cv_redirected_to_opus_keeps_article_semantics(
        self,
        mock_article_cls,
        mock_user_cls,
        mock_resolve_canonical,
        mock_get_dynamic_detail,
        mock_build_focus,
    ):
        mock_article_cls.return_value = _FakeArticleClient()
        mock_user_cls.return_value = _FakeUserClient()
        mock_resolve_canonical.return_value = {
            "canonical_url": "https://www.bilibili.com/opus/1163549263798468617",
            "resolved_opus_id": "1163549263798468617",
            "html": "",
        }
        mock_get_dynamic_detail.return_value = {
            "status": "success",
            "type": "dynamic",
            "data": {
                "item": {
                    "type": "DYNAMIC_TYPE_ARTICLE",
                    "modules": {
                        "module_dynamic": {
                            "desc": {
                                "text": "大家好我是大橙，这是完整正文",
                                "rich_text_nodes": [],
                            },
                            "major": {
                                "type": "MAJOR_TYPE_OPUS",
                                "opus": {
                                    "title": "一个月38元值吗？Apple Creator Studio软件上手体验",
                                    "summary": {
                                        "text": "大家好我是大橙，这是完整正文",
                                        "rich_text_nodes": [],
                                    },
                                    "pics": [
                                        {"url": "https://i0.hdslb.com/bfs/new_dyn/test-cover.jpg"}
                                    ],
                                },
                            },
                        }
                    },
                }
            },
        }
        mock_build_focus.return_value = {"cover": "#abcdef", "avatar": "#123456"}

        result = await article_service.get_article_info("cv45123193")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        data = result["data"]
        self.assertEqual(data["render_type"], "dynamic")
        self.assertEqual(data["canonical_url"], "https://www.bilibili.com/opus/1163549263798468617")
        self.assertEqual(data["resolved_opus_id"], "1163549263798468617")
        self.assertEqual(data["source_cvid"], "cv45123193")
        self.assertEqual(data["title"], "一个月38元值吗？Apple Creator Studio软件上手体验")
        self.assertEqual(data["summary"], "大家好我是大橙，这是完整正文")
        self.assertEqual(data["html_content"], "")
        self.assertEqual(data["author_face"], "https://i0.hdslb.com/bfs/face/test-author.jpg")
        self.assertEqual(data["render_payload"]["type"], "dynamic")
        mock_get_dynamic_detail.assert_awaited_once_with("1163549263798468617", None)
        mock_build_focus.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
