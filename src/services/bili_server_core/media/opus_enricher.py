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
    except Exception:
        return {"text": "", "rich_text_nodes": [], "images": []}

    normalized_text = normalize_preview_text("\n".join(text_lines))
    return {
        "text": normalized_text,
        "rich_text_nodes": rich_text_nodes,
        "images": images,
    }
