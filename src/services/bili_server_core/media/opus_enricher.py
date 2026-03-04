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


def extract_opus_content_payload(opus_info):
    text_lines = []
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
                    nodes = ((paragraph.get("text") or {}).get("nodes") or [])
                    line = "".join(
                        [((node.get("word") or {}).get("words") or "") for node in nodes]
                    ).strip()
                    if line:
                        text_lines.append(line)
                elif para_type == 2:
                    pics = ((paragraph.get("pic") or {}).get("pics") or [])
                    for pic in pics:
                        url = pic.get("url")
                        if url:
                            images.append({"url": url})
    except Exception:
        return "", []

    normalized_text = normalize_preview_text("\n".join(text_lines))
    return normalized_text, images

