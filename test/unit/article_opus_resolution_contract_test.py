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


class _FakeArticleClientWithoutPublishTime:
    async def get_info(self):
        return {
            "id": 47068592,
            "title": "《蔚蓝档案》03月26日维护更新说明",
            "mid": 3493265644980448,
            "author_name": "蔚蓝档案",
            "banner_url": "",
            "image_urls": [],
            "stats": {"share": 0, "like": 1444, "reply": 162},
            "publish_time": 0,
        }

    async def fetch_content(self):
        raise RuntimeError("未找到相关信息")


class _FakeUserClient:
    async def get_user_info(self):
        return {
            "face": "https://i0.hdslb.com/bfs/face/test-author.jpg",
            "level": 6,
            "pendant": {"image": "https://i0.hdslb.com/bfs/garb/item/test-pendant.png"},
            "nameplate": {"image": "https://i0.hdslb.com/bfs/face/test-nameplate.png"},
            "vip": {"label": {"text": "年度大会员"}},
            "official": {"type": 1},
        }

    async def get_dynamics_new(self):
        return {
            "items": [
                {
                    "modules": {
                        "module_author": {
                            "pendant": {"image": "https://i0.hdslb.com/bfs/garb/item/test-pendant.png"},
                            "decoration_card": {
                                "card_url": "https://i0.hdslb.com/bfs/garb/item/test-card.png",
                                "fan": {
                                    "num_desc": "000001",
                                    "color": "#3DC5EC",
                                },
                            },
                        }
                    }
                }
            ]
        }


class _FakeTurnedArticleClient:
    def __init__(self, cvid):
        self._cvid = cvid

    def get_cvid(self):
        return self._cvid


class _FakeArticleOpusClient:
    async def get_info(self):
        return {
            "item": {
                "basic": {
                    "comment_type": 12,
                    "rid_str": "47068592",
                    "comment_id_str": "47068592",
                    "article_type": 4,
                }
            }
        }

    async def is_article(self):
        return True

    async def turn_to_article(self):
        return _FakeTurnedArticleClient(47068592)

    def get_opus_id(self):
        return 1183668934980665366


class _FakeArticleOpusClientWithoutTurn:
    async def get_info(self):
        return {
            "item": {
                "basic": {
                    "comment_type": 12,
                    "rid_str": "47068592",
                    "comment_id_str": "47068592",
                    "article_type": 4,
                }
            }
        }

    async def is_article(self):
        return True

    async def turn_to_article(self):
        raise RuntimeError("turn_to_article unavailable")

    def get_opus_id(self):
        return 1183668934980665366


class _FakeDynamicOnlyOpusClient:
    async def get_info(self):
        return {
            "item": {
                "basic": {
                    "comment_type": 11,
                    "rid_str": "380654129",
                }
            }
        }

    async def is_article(self):
        return False

    def get_opus_id(self):
        return 1155074769312284695


class _FakeArticleOpusClientHtmlFallback:
    async def get_info(self):
        return {
            "item": {
                "basic": {
                    "comment_type": 12,
                    "article_type": 4,
                }
            }
        }

    async def is_article(self):
        return True

    async def turn_to_article(self):
        raise RuntimeError("turn_to_article unavailable")

    def get_opus_id(self):
        return 1183668934980665366


class ArticleOpusResolutionContractTest(unittest.IsolatedAsyncioTestCase):
    def test_extract_article_plain_text_should_keep_inline_strong_in_same_line(self):
        soup = article_service.BeautifulSoup(
            (
                '<div class="article-holder">'
                '<p><span>为保证更好的游戏体验，我们计划于</span>'
                '<strong> 03月26日 14:00</strong>'
                '<span> 开始进行维护更新。</span></p>'
                '</div>'
            ),
            "html.parser",
        )

        text = article_service._normalize_extracted_article_text(
            article_service._extract_article_plain_text(
                soup.find(class_="article-holder")
            )
        )

        self.assertEqual(
            text,
            "为保证更好的游戏体验，我们计划于 03月26日 14:00 开始进行维护更新。",
        )

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
        self.assertEqual(data["author_level"], 6)
        self.assertEqual(data["author_pendant_url"], "https://i0.hdslb.com/bfs/garb/item/test-pendant.png")
        self.assertEqual(data["author_card_url"], "https://i0.hdslb.com/bfs/garb/item/test-card.png")
        self.assertEqual(data["author_card_number"], "000001")
        self.assertEqual(data["author_fan_color"], "#3DC5EC")
        self.assertEqual(data["author_vip_label"], "年度大会员")
        self.assertEqual(data["author_official_verify_type"], 1)
        self.assertEqual(data["render_payload"]["type"], "dynamic")
        mock_get_dynamic_detail.assert_awaited_once_with("1163549263798468617", None)
        mock_build_focus.assert_awaited_once()

    @patch("src.services.bili_server_core.services.article_service.build_focus", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service._resolve_article_canonical", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.user.User")
    @patch("src.services.bili_server_core.services.article_service.article.Article")
    async def test_cv_redirected_to_opus_can_fallback_to_article_html_without_dynamic_redirect(
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
            "html": '<div class="article-holder"><p>这是来自 canonical HTML 的正文</p></div>',
        }
        mock_build_focus.return_value = {"cover": "#abcdef", "avatar": "#123456"}

        result = await article_service.get_article_info(
            "cv45123193",
            allow_dynamic_redirect=False,
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        data = result["data"]
        self.assertEqual(data["render_type"], "article")
        self.assertIsNone(data["render_payload"])
        self.assertEqual(data["canonical_url"], "https://www.bilibili.com/opus/1163549263798468617")
        self.assertEqual(data["resolved_opus_id"], "1163549263798468617")
        self.assertIn("这是来自 canonical HTML 的正文", data["summary"])
        self.assertIn("这是来自 canonical HTML 的正文", data["html_content"])
        self.assertEqual(data["author_card_url"], "https://i0.hdslb.com/bfs/garb/item/test-card.png")
        self.assertEqual(data["author_card_number"], "000001")
        mock_get_dynamic_detail.assert_not_awaited()
        mock_build_focus.assert_awaited_once()

    @patch("src.services.bili_server_core.services.article_service.build_focus", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service._resolve_article_canonical", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.user.User")
    @patch("src.services.bili_server_core.services.article_service.article.Article")
    async def test_get_article_info_should_fallback_to_opus_initial_state_publish_time_when_zero(
        self,
        mock_article_cls,
        mock_user_cls,
        mock_resolve_canonical,
        mock_build_focus,
    ):
        mock_article_cls.return_value = _FakeArticleClientWithoutPublishTime()
        mock_user_cls.return_value = _FakeUserClient()
        mock_resolve_canonical.return_value = {
            "canonical_url": "https://www.bilibili.com/opus/1183668934980665366",
            "resolved_opus_id": "1183668934980665366",
            "html": (
                '<script>window.__INITIAL_STATE__ = '
                '{"detail":{"modules":[{"module_author":{"pub_time":"2026年03月25日 18:00","pub_ts":1774432800}}]}};'
                '(function(){})();</script>'
            ),
        }
        mock_build_focus.return_value = {"cover": "#abcdef", "avatar": "#123456"}

        result = await article_service.get_article_info(
            "cv47068592",
            allow_dynamic_redirect=False,
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        self.assertEqual(result["data"]["publish_time"], 1774432800)
        self.assertEqual(result["data"]["canonical_url"], "https://www.bilibili.com/opus/1183668934980665366")
        mock_build_focus.assert_awaited_once()

    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.opus.Opus")
    @patch("src.services.bili_server_core.services.article_service.load_credential", return_value=object())
    async def test_get_opus_detail_should_turn_article_opus_into_article_result(
        self,
        _mock_load_credential,
        mock_opus_cls,
        mock_get_dynamic_detail,
    ):
        mock_opus_cls.return_value = _FakeArticleOpusClient()
        mock_get_dynamic_detail.return_value = {"status": "error", "message": "should not use dynamic"}
        article_result = {
            "status": "success",
            "type": "article",
            "data": {
                "title": "文章标题",
                "summary": "正文",
                "render_type": "article",
                "render_payload": None,
                "canonical_url": "https://www.bilibili.com/read/cv47068592",
                "resolved_opus_id": "",
                "source_cvid": "cv47068592",
            },
        }

        with patch.object(
            article_service,
            "get_article_info",
            AsyncMock(return_value=article_result),
        ) as mock_get_article_info:
            result = await article_service.get_opus_detail("1183668934980665366")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        self.assertEqual(result["data"]["source_cvid"], "cv47068592")
        self.assertEqual(result["data"]["resolved_opus_id"], "1183668934980665366")
        self.assertEqual(
            result["data"]["canonical_url"],
            "https://www.bilibili.com/opus/1183668934980665366",
        )
        self.assertEqual(result["data"]["render_type"], "article")
        mock_get_article_info.assert_awaited_once_with(
            "cv47068592",
            None,
            allow_dynamic_redirect=False,
        )
        mock_get_dynamic_detail.assert_not_awaited()

    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.opus.Opus")
    @patch("src.services.bili_server_core.services.article_service.load_credential", return_value=object())
    async def test_get_opus_detail_should_fallback_to_rid_when_turn_to_article_fails(
        self,
        _mock_load_credential,
        mock_opus_cls,
        mock_get_dynamic_detail,
    ):
        mock_opus_cls.return_value = _FakeArticleOpusClientWithoutTurn()
        mock_get_dynamic_detail.return_value = {"status": "error", "message": "should not use dynamic"}

        with patch.object(
            article_service,
            "get_article_info",
            AsyncMock(
                return_value={
                    "status": "success",
                    "type": "article",
                    "data": {
                        "render_type": "article",
                        "render_payload": None,
                        "canonical_url": "https://www.bilibili.com/read/cv47068592",
                        "resolved_opus_id": "",
                        "source_cvid": "cv47068592",
                    },
                }
            ),
        ) as mock_get_article_info:
            result = await article_service.get_opus_detail("1183668934980665366")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        self.assertEqual(result["data"]["source_cvid"], "cv47068592")
        mock_get_article_info.assert_awaited_once_with(
            "cv47068592",
            None,
            allow_dynamic_redirect=False,
        )
        mock_get_dynamic_detail.assert_not_awaited()

    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service._fetch_opus_page_html", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.opus.Opus")
    @patch("src.services.bili_server_core.services.article_service.load_credential", return_value=object())
    async def test_get_opus_detail_should_fallback_to_html_initial_state_when_api_mapping_missing(
        self,
        _mock_load_credential,
        mock_opus_cls,
        mock_fetch_opus_page_html,
        mock_get_dynamic_detail,
    ):
        mock_opus_cls.return_value = _FakeArticleOpusClientHtmlFallback()
        mock_get_dynamic_detail.return_value = {"status": "error", "message": "should not use dynamic"}
        mock_fetch_opus_page_html.return_value = (
            '<script>window.__INITIAL_STATE__ = '
            '{"detail":{"basic":{"comment_type":12,"article_type":4},'
            '"modules":[{"module_copyright":{"right_text":"cv47068592"}}]}};'
            '(function(){})();</script>'
        )

        with patch.object(
            article_service,
            "get_article_info",
            AsyncMock(
                return_value={
                    "status": "success",
                    "type": "article",
                    "data": {
                        "render_type": "article",
                        "render_payload": None,
                        "canonical_url": "https://www.bilibili.com/read/cv47068592",
                        "resolved_opus_id": "",
                        "source_cvid": "cv47068592",
                    },
                }
            ),
        ) as mock_get_article_info:
            result = await article_service.get_opus_detail("1183668934980665366")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "article")
        self.assertEqual(result["data"]["source_cvid"], "cv47068592")
        self.assertEqual(result["data"]["resolved_opus_id"], "1183668934980665366")
        mock_fetch_opus_page_html.assert_awaited_once()
        mock_get_article_info.assert_awaited_once_with(
            "cv47068592",
            None,
            allow_dynamic_redirect=False,
        )
        mock_get_dynamic_detail.assert_not_awaited()

    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.opus.Opus")
    @patch("src.services.bili_server_core.services.article_service.load_credential", return_value=object())
    async def test_get_opus_detail_should_return_dynamic_for_normal_opus(
        self,
        _mock_load_credential,
        mock_opus_cls,
        mock_get_dynamic_detail,
    ):
        mock_opus_cls.return_value = _FakeDynamicOnlyOpusClient()
        mock_get_dynamic_detail.return_value = {
            "status": "success",
            "type": "dynamic",
            "data": {"item": {"id_str": "1155074769312284695"}},
        }

        with patch.object(article_service, "get_article_info", AsyncMock()) as mock_get_article_info:
            result = await article_service.get_opus_detail("1155074769312284695")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "dynamic")
        mock_get_article_info.assert_not_awaited()
        mock_get_dynamic_detail.assert_awaited_once_with("1155074769312284695", None)

    @patch("src.services.bili_server_core.services.dynamic_service.get_dynamic_detail", new_callable=AsyncMock)
    @patch("src.services.bili_server_core.services.article_service.opus.Opus")
    @patch("src.services.bili_server_core.services.article_service.load_credential", return_value=object())
    async def test_get_opus_detail_should_fallback_to_dynamic_when_article_fetch_fails(
        self,
        _mock_load_credential,
        mock_opus_cls,
        mock_get_dynamic_detail,
    ):
        mock_opus_cls.return_value = _FakeArticleOpusClient()
        mock_get_dynamic_detail.return_value = {
            "status": "success",
            "type": "dynamic",
            "data": {"item": {"id_str": "1183668934980665366"}},
        }

        with patch.object(
            article_service,
            "get_article_info",
            AsyncMock(return_value={"status": "error", "message": "article failed"}),
        ) as mock_get_article_info:
            result = await article_service.get_opus_detail("1183668934980665366")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["type"], "dynamic")
        mock_get_article_info.assert_awaited_once_with(
            "cv47068592",
            None,
            allow_dynamic_redirect=False,
        )
        mock_get_dynamic_detail.assert_awaited_once_with("1183668934980665366", None)


if __name__ == "__main__":
    unittest.main()
