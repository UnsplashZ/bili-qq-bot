import logging
import re
from copy import deepcopy

from bilibili_api import dynamic, opus, user

from ..auth.credential_store import load_credential
from ..logging_utils import service_log
from ..media.opus_enricher import (
    count_image_placeholders,
    extract_cv_id,
    extract_opus_content_payload,
    normalize_preview_text,
    strip_image_placeholders,
)
from .article_service import get_article_info, get_opus_detail
from .opus_additional_service import (
    apply_opus_link_card_contract,
    enrich_opus_modules,
    enrich_additional_vote,
)
from .dynamic_author_service import (
    build_dynamic_detail_author_context,
    build_user_dynamic_author_context,
)
from .dynamic_topic_service import ensure_topic_on_dynamic

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


async def get_user_dynamic(uid, group_id=None):
    try:
        service_log(logger, "info", "fetch-user-dynamic", uid=uid, groupId=group_id)
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        dynamics = await u.get_dynamics_new(offset="")
        if dynamics and "items" in dynamics and len(dynamics["items"]) > 0:
            author_info = await build_user_dynamic_author_context(u, dynamics)

            result_items = []
            for item in dynamics["items"][:5]:
                pub_ts = 0
                if "modules" in item and "module_author" in item["modules"]:
                    pub_ts = item["modules"]["module_author"].get("pub_ts", 0)

                modules = item.get("modules") or {}
                module_dynamic = modules.get("module_dynamic")

                if module_dynamic:
                    if ((module_dynamic.get("major") or {}).get("type")) == "MAJOR_TYPE_OPUS":
                        try:
                            await enrich_opus_modules(modules, item.get("id_str"), group_id)
                            module_dynamic = modules.get("module_dynamic") or module_dynamic
                        except Exception:
                            pass

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
            ensure_topic_on_dynamic(md)
        except Exception:
            pass

        author_module = modules.get("module_author") or {}
        author_obj = await build_dynamic_detail_author_context(author_module, group_id)
        info["author"] = author_obj
        try:
            if isinstance(info.get("item"), dict):
                info["item"]["author"] = author_obj
        except Exception:
            pass

        try:
            mods = (info.get("item") or {}).get("modules") or info.get("modules") or {}
            md = mods.get("module_dynamic") or {}
            additional = md.get("additional")
            if isinstance(additional, dict):
                await enrich_additional_vote(additional, group_id)
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
            additional = md.get("additional")
            additional = additional if isinstance(additional, dict) else {}

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
            need_link_card_enrich = (
                major_type == "MAJOR_TYPE_OPUS"
                and additional.get("opus_link_cards") is None
            )

            canonical_body = None
            if _has_useful_body_nodes(current_summary_nodes):
                canonical_body = _build_body_payload(
                    current_summary_text,
                    current_summary_nodes,
                    opus_major.get("pics") or [],
                    "existing_summary",
                )

            opus_body = None
            if need_body_sync or need_image_enrich or need_link_card_enrich:
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

            if major_type == "MAJOR_TYPE_OPUS":
                apply_opus_link_card_contract(item_modules, opus_body or {})
                md = item_modules.get("module_dynamic") or md
                additional = md.get("additional")
                additional = additional if isinstance(additional, dict) else {}
                if additional.get("vote"):
                    await enrich_additional_vote(additional, group_id)

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

            ensure_topic_on_dynamic(md)

            if additional:
                md["additional"] = additional
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
