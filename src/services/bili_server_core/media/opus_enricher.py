import re


def extract_cv_id(value):
    if not value:
        return None
    match = re.search(r"/read/cv(\d+)", str(value), flags=re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def normalize_preview_text(text):
    if not text:
        return ""
    normalized = (
        str(text).replace("\r\n", "\n").replace("\r", "\n").replace("\u200b", "")
    )
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def count_image_placeholders(text):
    if not text:
        return 0
    return len(re.findall(r"\[图片\]", str(text)))


def strip_image_placeholders(text):
    if not text:
        return ""
    cleaned = re.sub(r"\s*\[图片\]\s*", "\n", str(text))
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _to_safe_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_rich_text_value(value):
    if value is None:
        return ""
    return str(value)


def _build_text_node(text):
    normalized_text = _normalize_rich_text_value(text)
    return {
        "type": "RICH_TEXT_NODE_TYPE_TEXT",
        "text": normalized_text,
        "orig_text": normalized_text,
    }


def _normalize_rich_content_node(node):
    if not isinstance(node, dict):
        return None

    node_type = node.get("type")
    if node_type == "TEXT_NODE_TYPE_WORD":
        words = ((node.get("word") or {}).get("words") or "")
        if not words:
            return None
        return _build_text_node(words)

    if node_type != "TEXT_NODE_TYPE_RICH":
        return None

    rich = node.get("rich") or {}
    text = _normalize_rich_text_value(rich.get("text") or rich.get("orig_text") or "")
    rich_type = rich.get("type") or "RICH_TEXT_NODE_TYPE_TEXT"
    if not text and rich_type == "RICH_TEXT_NODE_TYPE_TEXT":
        return None

    normalized = {
        "type": rich_type,
        "text": text,
        "orig_text": _normalize_rich_text_value(rich.get("orig_text") or text),
    }

    for key in ("jump_url", "rid", "style"):
        value = rich.get(key)
        if value is not None:
            normalized[key] = value

    if rich_type == "RICH_TEXT_NODE_TYPE_EMOJI" and isinstance(rich.get("emoji"), dict):
        normalized["emoji"] = dict(rich.get("emoji") or {})

    return normalized


def _normalize_link_card_stats(stats_like, keys=None):
    if not isinstance(stats_like, dict):
        return []

    label_map = {
        "play": "播放",
        "view": "播放",
        "vt": "播放",
        "danmaku": "弹幕",
        "comment": "评论",
        "collect": "收藏",
        "favorite": "收藏",
        "fans": "粉丝",
    }

    ordered_keys = list(keys or stats_like.keys())
    normalized = []
    for key in ordered_keys:
        value = stats_like.get(key)
        if value in (None, ""):
            continue
        normalized.append({"label": label_map.get(key, str(key)), "value": value})
    return normalized


def _extract_link_card_cover(card_obj):
    if not isinstance(card_obj, dict):
        return {"url": "", "width": 0, "height": 0}

    return {
        "url": (
            card_obj.get("cover")
            or card_obj.get("cover_url")
            or card_obj.get("image")
            or card_obj.get("pic")
            or ""
        ),
        "width": _to_safe_int(
            card_obj.get("cover_width") or card_obj.get("width") or card_obj.get("pic_width")
        ),
        "height": _to_safe_int(
            card_obj.get("cover_height")
            or card_obj.get("height")
            or card_obj.get("pic_height")
        ),
    }


def _build_opus_link_card(card_type, card_obj):
    if not isinstance(card_obj, dict):
        return None

    cover = _extract_link_card_cover(card_obj)
    title = _normalize_rich_text_value(card_obj.get("title") or "")
    subtitle = _normalize_rich_text_value(
        card_obj.get("sub_title") or card_obj.get("subtitle") or card_obj.get("desc1") or ""
    )
    desc = _normalize_rich_text_value(
        card_obj.get("desc") or card_obj.get("desc2") or card_obj.get("desc_second") or ""
    )
    jump_url = _normalize_rich_text_value(card_obj.get("jump_url") or "")

    normalized = {
        "card_type": card_type,
        "title": title,
        "jump_url": jump_url,
        "cover_url": cover["url"],
        "cover_width": cover["width"],
        "cover_height": cover["height"],
        "badge_text": "",
        "subtitle": subtitle,
        "desc": desc,
        "duration_text": "",
        "stats": [],
    }

    if card_type == "LINK_CARD_TYPE_UGC":
        normalized["badge_text"] = _normalize_rich_text_value(
            card_obj.get("head_text") or "视频"
        )
        normalized["duration_text"] = _normalize_rich_text_value(card_obj.get("duration") or "")
        normalized["stats"] = _normalize_link_card_stats(
            card_obj.get("stat") or {}, keys=("play", "danmaku")
        )
    elif card_type == "LINK_CARD_TYPE_COMMON":
        normalized["badge_text"] = _normalize_rich_text_value(
            card_obj.get("head_text") or card_obj.get("badge_text") or ""
        )
        normalized["stats"] = _normalize_link_card_stats(card_obj.get("stat") or {})
    else:
        return None

    if not (
        normalized["title"]
        or normalized["subtitle"]
        or normalized["desc"]
        or normalized["cover_url"]
        or normalized["stats"]
    ):
        return None
    return normalized


def _normalize_fallback_vote(card_obj):
    if not isinstance(card_obj, dict):
        return None

    vote_obj = (
        card_obj.get("vote")
        or card_obj.get("eva3_vote")
        or card_obj.get("vote_card")
        or card_obj
    )
    if not isinstance(vote_obj, dict):
        return None

    items = []
    for item in vote_obj.get("items") or vote_obj.get("options") or []:
        if not isinstance(item, dict):
            continue
        item_desc = _normalize_rich_text_value(item.get("desc") or item.get("name") or item.get("text"))
        if not item_desc and not item.get("image"):
            continue
        items.append(
            {
                "desc": item_desc,
                "image": item.get("image"),
                "cnt": _to_safe_int(item.get("cnt")),
            }
        )

    normalized = {
        "vote_id": vote_obj.get("vote_id") or vote_obj.get("rid") or vote_obj.get("id"),
        "title": _normalize_rich_text_value(vote_obj.get("title") or ""),
        "desc": _normalize_rich_text_value(vote_obj.get("desc") or vote_obj.get("title") or ""),
        "join_num": _to_safe_int(
            vote_obj.get("join_num")
            or vote_obj.get("participant")
            or vote_obj.get("total")
            or vote_obj.get("total_num")
        ),
        "choice_cnt": _to_safe_int(vote_obj.get("choice_cnt") or vote_obj.get("choiceCount") or 1),
        "items": items,
    }

    if not (normalized["vote_id"] or normalized["title"] or normalized["desc"] or normalized["items"]):
        return None
    return normalized


def _collect_paragraph_nodes(paragraph):
    nodes = ((paragraph.get("text") or {}).get("nodes") or [])
    normalized_nodes = []
    for node in nodes:
        normalized = _normalize_rich_content_node(node)
        if normalized:
            normalized_nodes.append(normalized)
    return normalized_nodes


def _nodes_to_plain_text(nodes):
    if not isinstance(nodes, list):
        return ""
    return "".join(
        _normalize_rich_text_value(node.get("text"))
        for node in nodes
        if isinstance(node, dict)
    )


def extract_opus_content_payload(opus_info):
    text_lines = []
    rich_text_nodes = []
    images = []
    link_cards = []
    fallback_vote = None

    try:
        opus_item = (opus_info or {}).get("item", {})
        opus_modules = opus_item.get("modules", []) or []

        for mod in opus_modules:
            if mod.get("module_type") != "MODULE_TYPE_CONTENT":
                continue

            paragraphs = (mod.get("module_content") or {}).get("paragraphs", []) or []
            for paragraph in paragraphs:
                para_type = paragraph.get("para_type")

                if para_type == 1:
                    paragraph_nodes = _collect_paragraph_nodes(paragraph)
                    line = _nodes_to_plain_text(paragraph_nodes).strip()
                    if line:
                        if rich_text_nodes:
                            rich_text_nodes.append(_build_text_node("\n"))
                        rich_text_nodes.extend(paragraph_nodes)
                        text_lines.append(line)
                elif para_type == 2:
                    pics = ((paragraph.get("pic") or {}).get("pics") or [])
                    for pic in pics:
                        url = pic.get("url")
                        if url:
                            images.append(
                                {
                                    "url": url,
                                    "width": _to_safe_int(pic.get("width")),
                                    "height": _to_safe_int(pic.get("height")),
                                }
                            )
                elif para_type == 6:
                    link_card = paragraph.get("link_card") or {}
                    raw_card = link_card.get("card") or {}
                    card_type = link_card.get("card_type") or raw_card.get("type")

                    if card_type == "LINK_CARD_TYPE_UGC":
                        normalized_card = _build_opus_link_card(
                            card_type,
                            raw_card.get("ugc") or raw_card,
                        )
                        if normalized_card:
                            link_cards.append(normalized_card)
                    elif card_type == "LINK_CARD_TYPE_COMMON":
                        normalized_card = _build_opus_link_card(
                            card_type,
                            raw_card.get("common") or raw_card,
                        )
                        if normalized_card:
                            link_cards.append(normalized_card)
                    elif card_type == "LINK_CARD_TYPE_EVA3_VOTE" and fallback_vote is None:
                        fallback_vote = _normalize_fallback_vote(
                            raw_card.get("vote")
                            or raw_card.get("eva3_vote")
                            or raw_card
                        )
    except Exception:
        return {
            "text": "",
            "rich_text_nodes": [],
            "images": [],
            "link_cards": [],
            "fallback_vote": None,
        }

    normalized_text = normalize_preview_text("\n".join(text_lines))
    return {
        "text": normalized_text,
        "rich_text_nodes": rich_text_nodes,
        "images": images,
        "link_cards": link_cards,
        "fallback_vote": fallback_vote,
    }
