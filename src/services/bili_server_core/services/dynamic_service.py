import logging
import re

from bilibili_api import dynamic, opus, user

from ..auth.credential_store import load_credential
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


async def get_user_dynamic(uid, group_id=None):
    try:
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
                            logger.debug(
                                f"[get_user_dynamic] Dynamic {item.get('id_str')}: Extracted desc from opus.summary"
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
                                logger.debug(
                                    f"[get_user_dynamic] Dynamic {item.get('id_str')}: Added topic '{topic_name}' from topic field"
                                )
                    except Exception as e:
                        logger.warning(f"[get_user_dynamic] Failed to process topic: {e}")

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
                                logger.debug(
                                    f"[get_user_dynamic] Dynamic {item.get('id_str')}: Fixed topic formatting"
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

            return {"status": "success", "data": {"cards": result_items}}
        return {"status": "success", "data": {"cards": []}}
    except Exception as e:
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_dynamic_detail(dynamic_id, group_id=None):
    try:
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
            topic_info = md.get("topic")
            if topic_info and topic_info.get("name"):
                topic_name = topic_info.get("name")
                desc_obj = md.get("desc")
                if desc_obj:
                    text = desc_obj.get("text", "")
                    if f"{topic_name}" not in text:
                        desc_obj["text"] = text + f" #{topic_name}#"

                        nodes = desc_obj.get("rich_text_nodes")
                        if isinstance(nodes, list):
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
            current_desc_placeholder_count = count_image_placeholders(current_desc_text)
            current_summary_placeholder_count = count_image_placeholders(
                current_summary_text
            )

            need_text_enrich = is_article_like and (
                not current_desc_text
                or current_desc_placeholder_count >= 2
                or (not current_desc_text and current_summary_placeholder_count >= 1)
            )
            need_image_enrich = is_article_like and not opus_major.get("pics")

            opus_text = ""
            opus_images = []
            if need_text_enrich or need_image_enrich:
                opus_id = item.get("id_str") or info.get("id_str") or dynamic_id
                if opus_id and str(opus_id).isdigit():
                    o = opus.Opus(int(opus_id), credential=load_credential(group_id))
                    opus_info = await o.get_info()
                    opus_text, opus_images = extract_opus_content_payload(opus_info)

            if need_image_enrich and opus_images:
                if "opus" not in major:
                    major["opus"] = {}
                major["opus"]["pics"] = opus_images

            candidate_text = ""
            candidate_source = ""
            if need_text_enrich:
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
                            candidate_text = article_summary
                            candidate_source = "article"
                            if "opus" not in major:
                                major["opus"] = {}
                            if not major["opus"].get("title") and article_data.get("title"):
                                major["opus"]["title"] = article_data.get("title")

                if not candidate_text and opus_text:
                    candidate_text = opus_text
                    candidate_source = "opus"

            has_real_images = bool((major.get("opus") or {}).get("pics"))
            if candidate_text and has_real_images:
                candidate_text = strip_image_placeholders(candidate_text)

            if candidate_text:
                should_replace_desc = (
                    not current_desc_text
                    or current_desc_placeholder_count >= 2
                    or len(candidate_text) > len(current_desc_text) + 80
                )

                if should_replace_desc:
                    if not isinstance(md.get("desc"), dict):
                        md["desc"] = {}
                    md["desc"]["text"] = candidate_text
                    existing_nodes = md["desc"].get("rich_text_nodes")
                    if existing_nodes is None:
                        md["desc"]["rich_text_nodes"] = []
                    elif not isinstance(existing_nodes, list):
                        md["desc"]["rich_text_nodes"] = []
                    logger.debug(
                        f"[get_dynamic_detail] Dynamic {dynamic_id}: desc enriched from {candidate_source}, len={len(candidate_text)}"
                    )

                if "opus" in major:
                    summary_obj = major["opus"].get("summary")
                    if not isinstance(summary_obj, dict):
                        summary_obj = {}

                    summary_text = normalize_preview_text(summary_obj.get("text") or "")
                    if not summary_text or count_image_placeholders(summary_text) >= 2:
                        summary_obj["text"] = candidate_text
                        summary_obj["rich_text_nodes"] = (
                            summary_obj.get("rich_text_nodes") or []
                        )
                        major["opus"]["summary"] = summary_obj

            md["major"] = major
            item_modules["module_dynamic"] = md
            item["modules"] = item_modules
            info["item"] = item
        except Exception as e:
            logger.warning(
                f"[get_dynamic_detail] Failed to enrich opus/article content for dynamic {dynamic_id}: {e}"
            )

        return {"status": "success", "type": "dynamic", "data": info}
    except Exception as e:
        import traceback

        error_detail = traceback.format_exc()
        return {"status": "error", "message": str(e), "detail": error_detail}

