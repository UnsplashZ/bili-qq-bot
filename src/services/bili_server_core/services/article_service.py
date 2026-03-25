import logging
import json
import re

import aiohttp
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag
from bilibili_api import article, opus, user

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from .focus_service import build_focus

logger = logging.getLogger(__name__)

_BLOCK_TAGS = {
    "p",
    "div",
    "section",
    "article",
    "blockquote",
    "pre",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "figure",
    "figcaption",
}


def _extract_opus_id_from_url(value):
    match = re.search(r"/opus/(\d+)", str(value or ""), flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1)


def _extract_numeric_id(value):
    match = re.search(r"(\d+)", str(value or ""))
    if not match:
        return ""
    return match.group(1)


def _extract_article_id_from_copyright_text(value):
    match = re.search(r"\bcv(\d+)\b", str(value or ""), flags=re.IGNORECASE)
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


async def _fetch_opus_page_html(opus_id, credential):
    url = f"https://www.bilibili.com/opus/{opus_id}"
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
            return await resp.text() if resp.status == 200 else ""


def _extract_article_id_from_opus_info(opus_info):
    item = ((opus_info or {}).get("item") or {})
    basic = item.get("basic") or {}
    comment_type = basic.get("comment_type")
    article_type = basic.get("article_type")
    is_article_like = str(comment_type or "") == "12" or article_type not in (None, "", 0, "0")
    if not is_article_like:
        return ""

    for key in ("rid_str", "comment_id_str"):
        article_id = _extract_numeric_id(basic.get(key))
        if article_id:
            return article_id
    return ""


def _extract_article_id_from_opus_initial_state(initial_state):
    detail = ((initial_state or {}).get("detail") or {})
    article_id = _extract_article_id_from_opus_info({"item": detail})
    if article_id:
        return article_id

    for module in detail.get("modules") or []:
        if not isinstance(module, dict):
            continue
        copyright_module = module.get("module_copyright") or {}
        article_id = _extract_article_id_from_copyright_text(
            copyright_module.get("right_text")
        )
        if article_id:
            return article_id

    return ""


def _has_valid_publish_time(value):
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        normalized = value.strip()
        return normalized not in ("", "0", "0.0")
    return bool(value)


def _extract_publish_time_from_opus_initial_state(initial_state):
    detail = ((initial_state or {}).get("detail") or {})
    for module in detail.get("modules") or []:
        if not isinstance(module, dict):
            continue

        module_author = module.get("module_author") or {}
        pub_ts = module_author.get("pub_ts")
        if _has_valid_publish_time(pub_ts):
            try:
                return int(pub_ts)
            except (TypeError, ValueError):
                pass

        pub_time = module_author.get("pub_time")
        if _has_valid_publish_time(pub_time):
            return pub_time

    return 0


def _extract_initial_state_from_html(html):
    match = re.search(
        r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;\s*\(function",
        str(html or ""),
        flags=re.DOTALL,
    )
    if not match:
        return {}

    try:
        return json.loads(match.group(1))
    except Exception:
        return {}


def _resolve_article_publish_time(info, canonical_html=""):
    for key in ("publish_time", "ctime", "ptime"):
        value = info.get(key)
        if _has_valid_publish_time(value):
            return value

    if canonical_html:
        publish_time = _extract_publish_time_from_opus_initial_state(
            _extract_initial_state_from_html(canonical_html)
        )
        if _has_valid_publish_time(publish_time):
            return publish_time

    return 0


async def _resolve_article_id_from_opus(opus_client, opus_info, credential):
    try:
        article_client = await opus_client.turn_to_article()
        article_id = _extract_numeric_id(article_client.get_cvid())
        if article_id:
            return article_id
    except Exception:
        pass

    article_id = _extract_article_id_from_opus_info(opus_info)
    if article_id:
        return article_id

    try:
        html = await _fetch_opus_page_html(opus_client.get_opus_id(), credential)
        article_id = _extract_article_id_from_opus_initial_state(
            _extract_initial_state_from_html(html)
        )
        if article_id:
            return article_id
    except Exception:
        pass

    return ""


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


def _extract_author_card_number(decoration_card):
    if not isinstance(decoration_card, dict):
        return None

    fan_info = decoration_card.get("fan") or {}
    return (
        fan_info.get("num_desc")
        or decoration_card.get("card_number")
        or decoration_card.get("fan_card_no")
        or decoration_card.get("card_no")
        or decoration_card.get("serial")
        or None
    )


async def _resolve_article_author_decoration(user_client):
    if not user_client:
        return {}

    try:
        dynamics = await user_client.get_dynamics_new()
    except Exception:
        return {}

    for item in (dynamics or {}).get("items") or []:
        module_author = ((item.get("modules") or {}).get("module_author") or {})
        decoration_card = module_author.get("decoration_card") or {}
        fan_info = decoration_card.get("fan") or {}
        pendant_url = ((module_author.get("pendant") or {}).get("image")) or ""
        card_url = decoration_card.get("card_url") or ""
        card_number = _extract_author_card_number(decoration_card)
        fan_color = fan_info.get("color") or None
        if pendant_url or card_url or card_number or fan_color:
            return {
                "pendant_url": pendant_url,
                "card_url": card_url,
                "card_number": card_number,
                "fan_color": fan_color,
            }

    return {}


def _extract_dynamic_article_summary(dynamic_result):
    item = ((dynamic_result or {}).get("data") or {}).get("item") or {}
    modules = item.get("modules") or {}
    dynamic = modules.get("module_dynamic") or {}
    desc_text = ((dynamic.get("desc") or {}).get("text")) or ""
    summary_text = (
        (((dynamic.get("major") or {}).get("opus") or {}).get("summary") or {}).get("text")
    ) or ""
    return desc_text or summary_text


def _normalize_extracted_article_text(text):
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\u200b", "")
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n[ \t]+", "\n", normalized)
    normalized = re.sub(r"[ \t]{2,}", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _extract_article_plain_text(node):
    if node is None:
        return ""

    if isinstance(node, NavigableString):
        return str(node)

    if not isinstance(node, Tag):
        return ""

    if node.name in {"script", "style"}:
        return ""

    if node.name == "br":
        return "\n"

    child_text = "".join(_extract_article_plain_text(child) for child in node.children)
    if node.name in _BLOCK_TAGS:
        child_text = child_text.strip()
        if not child_text:
            return ""
        return f"{child_text}\n"
    return child_text


async def get_opus_detail(opus_id, group_id=None):
    try:
        service_log(logger, "info", "fetch-opus-detail", opusId=opus_id, groupId=group_id)
        credential = load_credential(group_id)
        o = opus.Opus(int(opus_id), credential=credential)
        opus_info = await o.get_info()
        try:
            is_article = await o.is_article()
        except Exception:
            is_article = False
        if not is_article:
            is_article = bool(_extract_article_id_from_opus_info(opus_info))
        article_result = None

        if is_article:
            article_id = await _resolve_article_id_from_opus(o, opus_info, credential)
            if article_id:
                article_result = await get_article_info(
                    f"cv{article_id}",
                    group_id,
                    allow_dynamic_redirect=False,
                )
                if article_result.get("status") == "success":
                    data = article_result.get("data") or {}
                    data["source_cvid"] = data.get("source_cvid") or f"cv{article_id}"
                    data["resolved_opus_id"] = str(opus_id)
                    data["canonical_url"] = f"https://www.bilibili.com/opus/{opus_id}"
                    return article_result

        from .dynamic_service import get_dynamic_detail

        dynamic_result = await get_dynamic_detail(opus_id, group_id)
        if dynamic_result.get("status") == "success":
            return dynamic_result
        if article_result:
            return article_result
        return dynamic_result
    except Exception as e:
        service_log(logger, "error", "fetch-opus-detail-failed", opusId=opus_id, error=str(e))
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_article_info(cvid, group_id=None, *, allow_dynamic_redirect=True):
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
        author_info = {}
        author_decoration = {}
        author_face = None
        user_client = None
        if author_mid:
            try:
                user_client = user.User(uid=int(author_mid), credential=credential)
                author_info = await user_client.get_user_info()
                author_face = author_info.get("face")
                author_decoration = await _resolve_article_author_decoration(user_client)
            except Exception:
                pass

        if not author_face:
            author_face = (
                info.get("author", {}).get("face")
                if isinstance(info.get("author"), dict)
                else None
            )

        pendant = author_info.get("pendant") or {}
        nameplate = author_info.get("nameplate") or {}
        vip = author_info.get("vip") or {}
        official = author_info.get("official") or {}

        info["author_level"] = author_info.get("level", 0) or 0
        info["author_pendant_url"] = (
            author_decoration.get("pendant_url")
            or pendant.get("image_enhance")
            or pendant.get("image")
            or ""
        )
        info["author_card_url"] = author_decoration.get("card_url") or ""
        info["author_card_number"] = author_decoration.get("card_number")
        info["author_fan_color"] = author_decoration.get("fan_color")
        info["author_nameplate_url"] = (
            nameplate.get("image")
            or nameplate.get("image_small")
            or ""
        )
        info["author_vip_label"] = ((vip.get("label") or {}).get("text")) or ""
        info["author_official_verify_type"] = official.get("type", -1)

        summary = ""
        html_content = ""
        canonical = {"canonical_url": f"https://www.bilibili.com/read/cv{cvid_int}", "resolved_opus_id": "", "html": ""}

        try:
            canonical = await _resolve_article_canonical(cvid_int, credential)
        except Exception:
            pass

        resolved_opus_id = canonical.get("resolved_opus_id") or ""
        if resolved_opus_id and allow_dynamic_redirect:
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
                info["publish_time"] = _resolve_article_publish_time(
                    info, canonical.get("html") or ""
                )

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
                        summary = _normalize_extracted_article_text(
                            _extract_article_plain_text(holder)
                        )
                    else:
                        for script in soup(["script", "style"]):
                            script.extract()
                        html_content = (
                            soup.body.decode_contents()
                            if soup.body
                            else soup.decode_contents()
                        )
                        summary = _normalize_extracted_article_text(
                            _extract_article_plain_text(soup.body or soup)
                        )
            except Exception as e:
                summary = f"无法抓取正文: {str(e)}"
                html_content = ""

        info["summary"] = summary[:2500] if summary else "点击查看详情"
        info["html_content"] = html_content
        info["author_face"] = author_face
        info["canonical_url"] = canonical.get("canonical_url") or f"https://www.bilibili.com/read/cv{cvid_int}"
        info["resolved_opus_id"] = resolved_opus_id
        info["render_type"] = "article"
        info["render_payload"] = None

        cover = info.get("banner_url")
        if not cover and info.get("image_urls"):
            cover = info["image_urls"][0]
        if not cover:
            cover = ""

        info["focus"] = await build_focus(cover, author_face)
        info["publish_time"] = _resolve_article_publish_time(
            info, canonical.get("html") or ""
        )

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
