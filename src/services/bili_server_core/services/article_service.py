import logging
import re

import aiohttp
from bs4 import BeautifulSoup
from bilibili_api import article, opus, user

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from .focus_service import build_focus

logger = logging.getLogger(__name__)


def _extract_opus_id_from_url(value):
    match = re.search(r"/opus/(\d+)", str(value or ""), flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1)


def _build_credential_cookies(credential):
    if not credential:
        return {}

    cookies = {}
    cookie_fields = {
        "SESSDATA": "sessdata",
        "bili_jct": "bili_jct",
        "DedeUserID": "dedeuserid",
        "BUVID3": "buvid3",
        "ac_time_value": "ac_time_value",
    }
    for cookie_name, attr_name in cookie_fields.items():
        value = getattr(credential, attr_name, None)
        if value:
            cookies[cookie_name] = value
    return cookies


async def _resolve_article_canonical(cvid_int, credential):
    url = f"https://www.bilibili.com/read/cv{cvid_int}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/91.0.4472.124 Safari/537.36"
        ),
        "Referer": "https://www.bilibili.com/",
    }
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            url,
            headers=headers,
            cookies=_build_credential_cookies(credential),
            allow_redirects=True,
        ) as resp:
            final_url = str(resp.url)
            html = await resp.text() if resp.status == 200 else ""
            return {
                "canonical_url": final_url or url,
                "resolved_opus_id": _extract_opus_id_from_url(final_url),
                "html": html,
            }


def _extract_dynamic_article_summary(dynamic_result):
    item = ((dynamic_result or {}).get("data") or {}).get("item") or {}
    modules = item.get("modules") or {}
    dynamic = modules.get("module_dynamic") or {}
    desc_text = ((dynamic.get("desc") or {}).get("text")) or ""
    summary_text = (
        (((dynamic.get("major") or {}).get("opus") or {}).get("summary") or {}).get("text")
    ) or ""
    return desc_text or summary_text


async def get_opus_detail(opus_id, group_id=None):
    try:
        service_log(logger, "info", "fetch-opus-detail", opusId=opus_id, groupId=group_id)
        o = opus.Opus(int(opus_id), credential=load_credential(group_id))
        if await o.is_article():
            result = await get_article_info(opus_id, group_id)
            if result.get("status") == "success":
                return result

        from .dynamic_service import get_dynamic_detail

        return await get_dynamic_detail(opus_id, group_id)
    except Exception as e:
        service_log(logger, "error", "fetch-opus-detail-failed", opusId=opus_id, error=str(e))
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_article_info(cvid, group_id=None):
    try:
        service_log(logger, "info", "fetch-article-info", cvid=cvid, groupId=group_id)
        base_id = cvid.split("?")[0].split("#")[0]
        base_id = re.sub(r"cv", "", base_id, flags=re.IGNORECASE)
        match = re.search(r"(\d+)", base_id)
        if not match:
            return {"status": "error", "message": "Invalid Article ID"}

        cvid_int = int(match.group(1))
        credential = load_credential(group_id)
        a = article.Article(cvid_int, credential=credential)
        info = await a.get_info()
        info["source_cvid"] = f"cv{cvid_int}"

        author_mid = info.get("mid")
        author_face = None
        if author_mid:
            try:
                u = user.User(uid=int(author_mid), credential=credential)
                author_info = await u.get_user_info()
                author_face = author_info.get("face")
            except Exception:
                pass

        if not author_face:
            author_face = (
                info.get("author", {}).get("face")
                if isinstance(info.get("author"), dict)
                else None
            )

        summary = ""
        html_content = ""
        canonical = {"canonical_url": f"https://www.bilibili.com/read/cv{cvid_int}", "resolved_opus_id": "", "html": ""}

        try:
            canonical = await _resolve_article_canonical(cvid_int, credential)
        except Exception:
            pass

        resolved_opus_id = canonical.get("resolved_opus_id") or ""
        if resolved_opus_id:
            from .dynamic_service import get_dynamic_detail

            dynamic_result = await get_dynamic_detail(resolved_opus_id, group_id)
            if dynamic_result.get("status") == "success":
                dynamic_item = ((dynamic_result.get("data") or {}).get("item") or {})
                dynamic_modules = dynamic_item.get("modules") or {}
                dynamic_module = dynamic_modules.get("module_dynamic") or {}
                dynamic_opus = ((dynamic_module.get("major") or {}).get("opus") or {})
                dynamic_title = dynamic_opus.get("title") or info.get("title") or ""
                summary = _extract_dynamic_article_summary(dynamic_result)

                info["title"] = dynamic_title
                info["summary"] = summary[:2500] if summary else "点击查看详情"
                info["html_content"] = ""
                info["author_face"] = author_face
                info["canonical_url"] = canonical.get("canonical_url") or f"https://www.bilibili.com/opus/{resolved_opus_id}"
                info["resolved_opus_id"] = resolved_opus_id
                info["render_type"] = "dynamic"
                info["render_payload"] = dynamic_result

                cover = info.get("banner_url")
                if not cover and info.get("image_urls"):
                    cover = info["image_urls"][0]
                if not cover:
                    pics = dynamic_opus.get("pics") or []
                    if pics:
                        cover = pics[0].get("url") or ""
                if not cover:
                    cover = ""

                info["focus"] = await build_focus(cover, author_face)

                if "publish_time" not in info:
                    info["publish_time"] = info.get("ctime", info.get("ptime", 0))

                service_log(
                    logger,
                    "info",
                    "article-info-ready",
                    cvid=cvid_int,
                    authorMid=author_mid,
                    renderType="dynamic",
                    resolvedOpusId=resolved_opus_id,
                )
                return {"status": "success", "type": "article", "data": info}

        try:
            content = await a.fetch_content()
            html_content = content
            summary = re.sub("<[^<]+?>", "", content)
        except Exception:
            pass

        if not summary or len(summary) < 10:
            try:
                html = canonical.get("html") or ""
                if html:
                    soup = BeautifulSoup(html, "html.parser")
                    holder = (
                        soup.find(class_="article-holder")
                        or soup.find(id="read-article-holder")
                        or soup.find(class_="opus-module-content")
                    )
                    if holder:
                        for script in holder(["script", "style"]):
                            script.extract()
                        html_content = holder.decode_contents()
                        summary = holder.get_text(separator="\n", strip=True)
                    else:
                        for script in soup(["script", "style"]):
                            script.extract()
                        html_content = (
                            soup.body.decode_contents()
                            if soup.body
                            else soup.decode_contents()
                        )
                        summary = soup.get_text(separator="\n", strip=True)
            except Exception as e:
                summary = f"无法抓取正文: {str(e)}"
                html_content = ""

        info["summary"] = summary[:2500] if summary else "点击查看详情"
        info["html_content"] = html_content
        info["author_face"] = author_face
        info["canonical_url"] = canonical.get("canonical_url") or f"https://www.bilibili.com/read/cv{cvid_int}"
        info["resolved_opus_id"] = ""
        info["render_type"] = "article"
        info["render_payload"] = None

        cover = info.get("banner_url")
        if not cover and info.get("image_urls"):
            cover = info["image_urls"][0]
        if not cover:
            cover = ""

        info["focus"] = await build_focus(cover, author_face)

        if "publish_time" not in info:
            info["publish_time"] = info.get("ctime", info.get("ptime", 0))

        service_log(
            logger,
            "info",
            "article-info-ready",
            cvid=cvid_int,
            authorMid=author_mid,
            renderType="article",
        )
        return {"status": "success", "type": "article", "data": info}
    except Exception as e:
        service_log(logger, "error", "fetch-article-info-failed", cvid=cvid, error=str(e))
        return {"status": "error", "message": str(e)}
