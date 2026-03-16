import logging
import re
from copy import deepcopy

from bilibili_api import dynamic, opus, user

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from ..media.image_focus import get_image_focus_color
from ..media.opus_enricher import (
    count_image_placeholders,
    extract_cv_id,
    extract_opus_content_payload,
    normalize_preview_text,
    strip_image_placeholders,
)
from .article_service import get_article_info, get_opus_detail

logger = logging.getLogger(__name__)


def _normalize_rich_text_nodes(nodes):
    if not isinstance(nodes, list):
        return []
    return deepcopy(nodes)


def _has_semantic_rich_text_nodes(nodes):
    if not isinstance(nodes, list) or len(nodes) == 0:
        return False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") or node.get("text") or node.get("orig_text"):
            return True
    return False


def _has_useful_body_nodes(nodes):
    if not isinstance(nodes, list) or len(nodes) == 0:
        return False

    for node in nodes:
        if not isinstance(node, dict):
            continue

        node_type = node.get("type") or "RICH_TEXT_NODE_TYPE_TEXT"
        node_text = normalize_preview_text(node.get("text") or "")

        if node_type == "RICH_TEXT_NODE_TYPE_TOPIC":
            continue
        if node_type == "RICH_TEXT_NODE_TYPE_TEXT":
            if node_text:
                return True
            continue
        return True

    return False


def _compose_text_from_nodes(nodes):
    if not isinstance(nodes, list):
        return ""
    return normalize_preview_text(
        "".join(str((node or {}).get("text") or "") for node in nodes if isinstance(node, dict))
    )


def _build_body_payload(text="", rich_text_nodes=None, images=None, source=""):
    normalized_nodes = _normalize_rich_text_nodes(rich_text_nodes)
    normalized_text = normalize_preview_text(text)
    if not normalized_text and normalized_nodes:
        normalized_text = _compose_text_from_nodes(normalized_nodes)
    return {
        "text": normalized_text,
        "rich_text_nodes": normalized_nodes,
        "images": deepcopy(images or []),
        "source": source,
    }


def _is_degraded_body(text, rich_text_nodes, placeholder_count):
    if not text:
        return True
    if placeholder_count >= 2:
        return True
    return not _has_useful_body_nodes(rich_text_nodes)


def _ensure_topic_on_body(body_obj, topic_info):
    if not isinstance(body_obj, dict):
        return

    topic_name = (topic_info or {}).get("name")
    if not topic_name:
        return

    text = body_obj.get("text", "")
    if f"{topic_name}" not in text:
        body_obj["text"] = text + f" #{topic_name}#"

    nodes = body_obj.get("rich_text_nodes")
    if not isinstance(nodes, list):
        return

    has_topic_node = any(
        isinstance(node, dict)
        and node.get("type") == "RICH_TEXT_NODE_TYPE_TOPIC"
        and topic_name in str(node.get("orig_text") or node.get("text") or "")
        for node in nodes
    )
    if has_topic_node:
        return

    nodes.append(
        {
            "text": " ",
            "type": "RICH_TEXT_NODE_TYPE_TEXT",
            "orig_text": " ",
        }
    )
    nodes.append(
        {
            "text": f"{topic_name}",
            "type": "RICH_TEXT_NODE_TYPE_TOPIC",
            "orig_text": f"#{topic_name}#",
        }
    )


def _ensure_topic_on_dynamic(module_dynamic):
    if not isinstance(module_dynamic, dict):
        return

    topic_info = module_dynamic.get("topic") or {}
    _ensure_topic_on_body(module_dynamic.get("desc"), topic_info)

    major = module_dynamic.get("major") or {}
    opus_body = major.get("opus") or {}
    _ensure_topic_on_body(opus_body.get("summary"), topic_info)


async def get_user_dynamic(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-dynamic", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        dynamics = await u.get_dynamics_new(offset="")
        if dynamics and "items" in dynamics and len(dynamics["items"]) > 0:
            author_level = 0
            pendant_url = None
            card_url = None
            decoration_card = None
            card_number = None
            fan_color = None

            try:
                info = await u.get_user_info()
                author_level = info.get("level", 0)
            except Exception:
                author_level = 0

            try:
                profile = await u.get_user_profile()
                pendant_url = (profile.get("pendant") or {}).get("image") or (
                    (profile.get("decorate") or {}).get("pendant") or {}
                ).get("image")
                card_url = (profile.get("decorate") or {}).get("card_url") or (
                    profile.get("decorate_card") or {}
                ).get("image")
            except Exception:
                pass

            first_item_ma = (
                (dynamics["items"][0].get("modules") or {}).get("module_author") or {}
            )
            try:
                pendant_url = pendant_url or ((first_item_ma.get("pendant") or {}).get("image"))
                if "decoration_card" in first_item_ma and first_item_ma["decoration_card"]:
                    decoration_card = first_item_ma["decoration_card"]
                    card_number = (
                        decoration_card.get("card_number")
                        or decoration_card.get("fan_card_no")
                        or decoration_card.get("card_no")
                        or decoration_card.get("serial")
                        or None
                    )
                    fan_info = decoration_card.get("fan", {})
                    fan_color = fan_info.get("color") if fan_info else None
            except Exception:
                pass

            card_focus_color = None
            avatar_focus_color = None
            try:
                src = card_url or ((decoration_card or {}).get("card_url"))
                card_focus_color = await get_image_focus_color(src) if src else None
            except Exception:
                pass
            try:
                author_face_url = (
                    first_item_ma.get("face")
                    or (dynamics["items"][0].get("author") or {}).get("face")
                    or ""
                )
                avatar_focus_color = (
                    await get_image_focus_color(author_face_url) if author_face_url else None
                )
            except Exception:
                pass

            author_info = {
                "level": author_level,
                "pendant_url": pendant_url,
                "card_url": card_url,
                "decoration_card": decoration_card,
                "card_number": card_number,
                "card_focus_color": card_focus_color,
                "fan_color": fan_color,
                "avatar_focus_color": avatar_focus_color,
            }

            result_items = []
            for item in dynamics["items"][:5]:
                pub_ts = 0
                if "modules" in item and "module_author" in item["modules"]:
                    pub_ts = item["modules"]["module_author"].get("pub_ts", 0)

                modules = item.get("modules") or {}
                module_dynamic = modules.get("module_dynamic")

                if module_dynamic:
                    if not module_dynamic.get("desc"):
                        major = module_dynamic.get("major") or {}
                        opus_data = major.get("opus")
                        if opus_data and opus_data.get("summary"):
                            module_dynamic["desc"] = {
                                "text": opus_data["summary"].get("text", ""),
                                "rich_text_nodes": opus_data["summary"].get(
                                    "rich_text_nodes", []
                                ),
                            }
                            service_log(
                                logger,
                                "debug",
                                "dynamic-desc-extracted-from-opus-summary",
                                dynamicId=item.get("id_str"),
                            )

                    topic_added = False
                    try:
                        topic_obj = module_dynamic.get("topic")
                        if topic_obj and isinstance(topic_obj, dict):
                            topic_name = topic_obj.get("name", "")
                            topic_id = topic_obj.get("id", 0)
                            if topic_name and topic_id:
                                if not module_dynamic.get("desc"):
                                    module_dynamic["desc"] = {
                                        "text": "",
                                        "rich_text_nodes": [],
                                    }

                                desc = module_dynamic["desc"]
                                topic_tag = f"#{topic_name}#"
                                if topic_tag not in desc["text"]:
                                    desc["text"] = desc["text"] + f" #{topic_name}#"

                                if not desc.get("rich_text_nodes"):
                                    desc["rich_text_nodes"] = []

                                topic_node = {
                                    "type": "RICH_TEXT_NODE_TYPE_TOPIC",
                                    "text": topic_tag,
                                    "jump_url": f"https://www.bilibili.com/v/topic/detail/?topic_id={topic_id}",
                                    "orig_text": topic_tag,
                                }

                                if not any(
                                    n.get("type") == "RICH_TEXT_NODE_TYPE_TOPIC"
                                    for n in desc["rich_text_nodes"]
                                ):
                                    desc["rich_text_nodes"].insert(0, topic_node)

                                topic_added = True
                                service_log(
                                    logger,
                                    "debug",
                                    "dynamic-topic-added-from-topic-field",
                                    dynamicId=item.get("id_str"),
                                    topic=topic_name,
                                )
                    except Exception as e:
                        service_log(
                            logger,
                            "warn",
                            "dynamic-topic-process-failed",
                            dynamicId=item.get("id_str"),
                            error=str(e),
                        )

                    if not topic_added:
                        desc_text = (module_dynamic.get("desc") or {}).get("text", "")
                        if desc_text and "#" in desc_text:
                            fixed_text = re.sub(r"#([^#\s]+?)#", r"#\1# ", desc_text)
                            if fixed_text != desc_text:
                                if not module_dynamic.get("desc"):
                                    module_dynamic["desc"] = {
                                        "text": "",
                                        "rich_text_nodes": [],
                                    }
                                module_dynamic["desc"]["text"] = fixed_text
                                service_log(
                                    logger,
                                    "debug",
                                    "dynamic-topic-format-fixed",
                                    dynamicId=item.get("id_str"),
                                )

                desc = {
                    "dynamic_id_str": item.get("id_str"),
                    "type": item.get("type"),
                    "timestamp": pub_ts,
                    "user_profile": {
                        "info": {
                            "face": (
                                item.get("modules", {})
                                .get("module_author", {})
                                .get("face", "")
                            )
                        }
                    },
                }

                result_items.append(
                    {
                        "desc": desc,
                        "card": item.get("card"),
                        "extend_json": item.get("extend_json"),
                        "id_str": item.get("id_str"),
                        "type": item.get("type"),
                        "modules": modules,
                        "orig": item.get("orig"),
                        "pub_ts": pub_ts,
                        "author": author_info,
                    }
                )

            service_log(logger, "info", "user-dynamic-ready", uid=uid, count=len(result_items))
            return {"status": "success", "data": {"cards": result_items}}
        service_log(logger, "warn", "user-dynamic-ready", uid=uid, count=0)
        return {"status": "success", "data": {"cards": []}}
    except Exception as e:
        service_log(logger, "error", "fetch-user-dynamic-failed", uid=uid, error=str(e))
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_dynamic_detail(dynamic_id, group_id=None):
    try:
        service_log(logger, "info", "fetch-dynamic-detail", dynamicId=dynamic_id, groupId=group_id)
        d = dynamic.Dynamic(int(dynamic_id), credential=load_credential(group_id))
        info = await d.get_info()

        if not info:
            return {
                "status": "error",
                "message": f"无法获取动态 {dynamic_id} 的信息，可能已被删除或设置为私密",
            }

        modules = (info.get("item") or {}).get("modules") or info.get("modules") or {}

        if not modules:
            item = info.get("item", {})
            basic = item.get("basic", {})
            jump_url = basic.get("jump_url", "")
            if "/opus/" in jump_url:
                opus_match = re.search(r"/opus/(\d+)", jump_url)
                if opus_match:
                    opus_id = opus_match.group(1)
                    return await get_opus_detail(opus_id, group_id)

            return {
                "status": "error",
                "message": f"动态 {dynamic_id} 的数据结构异常，可能已被删除",
            }

        try:
            md = modules.get("module_dynamic") or {}
            _ensure_topic_on_dynamic(md)
        except Exception:
            pass

        author_module = modules.get("module_author") or {}
        author_uid = author_module.get("mid") or author_module.get("uid")

        pendant_url = None
        card_url = None
        author_level = 0
        decoration_card = None
        card_number = None
        fan_color = None

        if "pendant" in author_module and author_module["pendant"]:
            pendant_url = author_module["pendant"].get("image")

        if "decoration_card" in author_module and author_module["decoration_card"]:
            decoration_card = author_module["decoration_card"]
            card_url = decoration_card.get("card_url")
            card_number = (
                decoration_card.get("card_number")
                or decoration_card.get("fan_card_no")
                or decoration_card.get("card_no")
                or decoration_card.get("serial")
                or None
            )
            fan_info = decoration_card.get("fan", {})
            fan_color = fan_info.get("color") if fan_info else None

        if "level_info" in author_module and author_module["level_info"]:
            author_level = author_module["level_info"].get("current_level", 0)
        elif "vip" in author_module and author_module["vip"]:
            author_level = author_module["vip"].get("vip_level", 0)
        elif "pendant" in author_module and author_module["pendant"]:
            pass

        if (not pendant_url or not card_url or author_level == 0) and author_uid:
            try:
                u = user.User(uid=int(author_uid), credential=load_credential(group_id))
                base = await u.get_user_info()
                author_level = base.get("level", author_level)
                profile = await u.get_user_profile()
                pendant_url = pendant_url or (profile.get("pendant") or {}).get(
                    "image"
                ) or ((profile.get("decorate") or {}).get("pendant") or {}).get("image")
                card_url = card_url or (profile.get("decorate") or {}).get(
                    "card_url"
                ) or (profile.get("decorate_card") or {}).get("image")
            except Exception:
                pass
        card_focus_color = None
        avatar_focus_color = None
        try:
            src = card_url or ((decoration_card or {}).get("card_url"))
            card_focus_color = await get_image_focus_color(src) if src else None
        except Exception:
            card_focus_color = None
        try:
            avatar_url = author_module.get("face") or ""
            avatar_focus_color = (
                await get_image_focus_color(avatar_url) if avatar_url else None
            )
        except Exception:
            avatar_focus_color = None

        author_obj = {
            "level": author_level,
            "pendant_url": pendant_url,
            "card_url": card_url,
            "decoration_card": decoration_card,
            "card_number": card_number,
            "card_focus_color": card_focus_color,
            "fan_color": fan_color,
            "avatar_focus_color": avatar_focus_color,
        }
        info["author"] = author_obj
        try:
            if isinstance(info.get("item"), dict):
                info["item"]["author"] = author_obj
        except Exception:
            pass

        try:
            mods = (info.get("item") or {}).get("modules") or info.get("modules") or {}
            md = mods.get("module_dynamic") or {}
            additional = md.get("additional") or {}
            vobj = additional.get("vote") or {}
            vote_id = vobj.get("vote_id")
            if vote_id:
                from bilibili_api import vote as vote_api

                vv = vote_api.Vote(vote_id=int(vote_id), credential=load_credential(group_id))
                vinfo = await vv.get_info()
                items = []
                try:
                    choices = (
                        (vinfo.get("info") or {}).get("options")
                        or vinfo.get("data", {}).get("choices")
                        or vinfo.get("choices")
                        or []
                    )
                except Exception:
                    choices = []
                for ch in choices:
                    desc = (ch.get("desc") if isinstance(ch, dict) else str(ch)) or ""
                    img = (ch.get("image") if isinstance(ch, dict) else None)
                    cnt = (ch.get("cnt") if isinstance(ch, dict) else 0)
                    items.append({"desc": desc, "image": img, "cnt": cnt})

                join_num = (
                    (vinfo.get("info") or {}).get("cnt")
                    or vinfo.get("data", {}).get("join_num")
                    or vinfo.get("join_num")
                    or vobj.get("join_num")
                )
                choice_cnt = (
                    (vinfo.get("info") or {}).get("choice_cnt")
                    or vinfo.get("data", {}).get("choice_cnt")
                    or vinfo.get("choice_cnt")
                    or vobj.get("choice_cnt")
                )
                title = (
                    (vinfo.get("info") or {}).get("title")
                    or vinfo.get("data", {}).get("title")
                    or vinfo.get("title")
                    or vobj.get("title")
                )
                desc = (
                    (vinfo.get("info") or {}).get("desc")
                    or vinfo.get("data", {}).get("desc")
                    or vinfo.get("desc")
                    or vobj.get("desc")
                )
                vobj["items"] = items
                if join_num is not None:
                    vobj["join_num"] = join_num
                if choice_cnt is not None:
                    vobj["choice_cnt"] = choice_cnt
                if title is not None:
                    vobj["title"] = title
                if desc is not None:
                    vobj["desc"] = desc
                additional["vote"] = vobj
                md["additional"] = additional
                mods["module_dynamic"] = md
                if isinstance(info.get("item"), dict):
                    info["item"]["modules"] = mods
                info["modules"] = mods
        except Exception:
            pass

        try:
            item = info.get("item", {}) or {}
            item_modules = item.get("modules", {}) or {}
            md = item_modules.get("module_dynamic", {}) or {}
            major = md.get("major", {}) or {}
            opus_major = major.get("opus") or {}
            major_type = major.get("type")
            item_type = item.get("type")

            is_article_like = (
                major_type in ["DYNAMIC_TYPE_ARTICLE", "MAJOR_TYPE_OPUS"]
                or item_type == "DYNAMIC_TYPE_ARTICLE"
            )

            current_desc_text = normalize_preview_text((md.get("desc") or {}).get("text", ""))
            current_summary_text = normalize_preview_text(
                (opus_major.get("summary") or {}).get("text", "")
            )
            current_desc_nodes = _normalize_rich_text_nodes(
                (md.get("desc") or {}).get("rich_text_nodes")
            )
            current_summary_nodes = _normalize_rich_text_nodes(
                (opus_major.get("summary") or {}).get("rich_text_nodes")
            )
            current_desc_placeholder_count = count_image_placeholders(current_desc_text)
            current_summary_placeholder_count = count_image_placeholders(
                current_summary_text
            )

            need_body_sync = is_article_like and (
                _is_degraded_body(
                    current_desc_text,
                    current_desc_nodes,
                    current_desc_placeholder_count,
                )
                or _is_degraded_body(
                    current_summary_text,
                    current_summary_nodes,
                    current_summary_placeholder_count,
                )
            )
            need_image_enrich = is_article_like and not opus_major.get("pics")

            canonical_body = None
            if _has_useful_body_nodes(current_summary_nodes):
                canonical_body = _build_body_payload(
                    current_summary_text,
                    current_summary_nodes,
                    opus_major.get("pics") or [],
                    "existing_summary",
                )

            opus_body = None
            if need_body_sync or need_image_enrich:
                opus_id = item.get("id_str") or info.get("id_str") or dynamic_id
                if opus_id and str(opus_id).isdigit():
                    o = opus.Opus(int(opus_id), credential=load_credential(group_id))
                    opus_info = await o.get_info()
                    opus_body = extract_opus_content_payload(opus_info)
                    if canonical_body is None and (
                        opus_body.get("text")
                        or _has_useful_body_nodes(opus_body.get("rich_text_nodes"))
                    ):
                        canonical_body = _build_body_payload(
                            opus_body.get("text"),
                            opus_body.get("rich_text_nodes"),
                            opus_body.get("images"),
                            "opus",
                        )

            if need_image_enrich and (opus_body or {}).get("images"):
                if "opus" not in major:
                    major["opus"] = {}
                major["opus"]["pics"] = deepcopy(opus_body.get("images") or [])

            article_result = None
            if canonical_body is None and need_body_sync:
                jump_url = opus_major.get("jump_url") or (item.get("basic") or {}).get(
                    "jump_url"
                )
                cv_id = extract_cv_id(jump_url)
                if cv_id:
                    article_result = await get_article_info(cv_id, group_id)
                    if article_result.get("status") == "success":
                        article_data = article_result.get("data") or {}
                        article_summary = normalize_preview_text(
                            article_data.get("summary") or ""
                        )
                        if article_summary:
                            canonical_body = _build_body_payload(
                                article_summary,
                                [],
                                [],
                                "article",
                            )
                            if "opus" not in major:
                                major["opus"] = {}
                            if not major["opus"].get("title") and article_data.get("title"):
                                major["opus"]["title"] = article_data.get("title")

            has_real_images = bool((major.get("opus") or {}).get("pics"))
            canonical_text = (canonical_body or {}).get("text") or ""
            canonical_nodes = _normalize_rich_text_nodes(
                (canonical_body or {}).get("rich_text_nodes")
            )
            if canonical_text and has_real_images:
                canonical_text = strip_image_placeholders(canonical_text)

            if need_body_sync and canonical_text:
                if "opus" not in major:
                    major["opus"] = {}

                md["desc"] = {
                    "text": canonical_text,
                    "rich_text_nodes": deepcopy(canonical_nodes),
                }
                summary_obj = major["opus"].get("summary")
                if not isinstance(summary_obj, dict):
                    summary_obj = {}
                summary_obj["text"] = canonical_text
                summary_obj["rich_text_nodes"] = deepcopy(canonical_nodes)
                major["opus"]["summary"] = summary_obj

                service_log(
                    logger,
                    "debug",
                    "dynamic-body-canonicalized",
                    dynamicId=dynamic_id,
                    source=(canonical_body or {}).get("source") or "unknown",
                    length=len(canonical_text),
                    richNodeCount=len(canonical_nodes),
                )

            _ensure_topic_on_dynamic(md)

            md["major"] = major
            item_modules["module_dynamic"] = md
            item["modules"] = item_modules
            info["item"] = item
        except Exception as e:
            service_log(
                logger,
                "warn",
                "dynamic-opus-article-enrich-failed",
                dynamicId=dynamic_id,
                error=str(e),
            )

        service_log(logger, "info", "dynamic-detail-ready", dynamicId=dynamic_id)
        return {"status": "success", "type": "dynamic", "data": info}
    except Exception as e:
        service_log(logger, "error", "fetch-dynamic-detail-failed", dynamicId=dynamic_id, error=str(e))
        import traceback

        error_detail = traceback.format_exc()
        return {"status": "error", "message": str(e), "detail": error_detail}
