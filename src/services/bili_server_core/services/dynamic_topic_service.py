def ensure_topic_on_body(body_obj, topic_info):
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


def ensure_topic_on_dynamic(module_dynamic):
    if not isinstance(module_dynamic, dict):
        return

    topic_info = module_dynamic.get("topic") or {}
    ensure_topic_on_body(module_dynamic.get("desc"), topic_info)

    major = module_dynamic.get("major") or {}
    opus_body = major.get("opus") or {}
    ensure_topic_on_body(opus_body.get("summary"), topic_info)
