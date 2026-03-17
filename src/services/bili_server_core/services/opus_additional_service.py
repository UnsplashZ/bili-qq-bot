from copy import deepcopy

from bilibili_api import opus, vote as vote_api

from ..auth.credential_store import load_credential
from ..media.opus_enricher import extract_opus_content_payload, normalize_preview_text


def _unwrap_vote_obj(value):
    if not isinstance(value, dict):
        return None
    nested_vote = value.get("vote")
    if isinstance(nested_vote, dict):
        return nested_vote
    return value


def has_existing_vote(modules):
    if not isinstance(modules, dict):
        return False

    module_interaction = modules.get("module_interaction") or {}
    module_dynamic = modules.get("module_dynamic") or {}
    major = module_dynamic.get("major") or {}
    additional = module_dynamic.get("additional") or {}

    candidates = (
        module_interaction.get("vote"),
        module_interaction.get("vote_info"),
        major.get("vote"),
        additional.get("vote"),
    )
    for candidate in candidates:
        vote_obj = _unwrap_vote_obj(candidate)
        if isinstance(vote_obj, dict) and vote_obj:
            return True
    return False


def _normalize_card_identity(value):
    if not value:
        return ""
    return normalize_preview_text(str(value)).replace(" ", "").lower()


def _is_matching_common_resource(common_card, link_card):
    if not isinstance(common_card, dict) or not isinstance(link_card, dict):
        return False

    common_jump_url = _normalize_card_identity(
        common_card.get("jump_url") or (common_card.get("button") or {}).get("jump_url")
    )
    link_jump_url = _normalize_card_identity(link_card.get("jump_url"))
    if common_jump_url and link_jump_url and common_jump_url == link_jump_url:
        return True

    common_title = _normalize_card_identity(common_card.get("title"))
    link_title = _normalize_card_identity(link_card.get("title"))
    if common_title and link_title and common_title == link_title:
        common_cover = _normalize_card_identity(common_card.get("cover"))
        link_cover = _normalize_card_identity(link_card.get("cover_url"))
        if not common_cover or not link_cover or common_cover == link_cover:
            return True

    return False


def _filter_duplicate_common_link_cards(link_cards, existing_common):
    if not isinstance(existing_common, dict):
        return deepcopy(link_cards or [])

    filtered = []
    for card in link_cards or []:
        if (card or {}).get("card_type") == "LINK_CARD_TYPE_COMMON" and _is_matching_common_resource(
            existing_common, card
        ):
            continue
        filtered.append(deepcopy(card))
    return filtered


def apply_opus_link_card_contract(modules, opus_body):
    if not isinstance(modules, dict):
        return False

    module_dynamic = modules.get("module_dynamic") or {}
    major = module_dynamic.get("major") or {}
    if major.get("type") != "MAJOR_TYPE_OPUS":
        return False

    additional = module_dynamic.get("additional")
    additional = additional if isinstance(additional, dict) else {}
    existing_common = additional.get("common") or major.get("common")
    changed = False

    filtered_link_cards = _filter_duplicate_common_link_cards(
        (opus_body or {}).get("link_cards") or [],
        existing_common,
    )
    if filtered_link_cards:
        additional["opus_link_cards"] = filtered_link_cards
        changed = True
    elif "opus_link_cards" in additional:
        additional.pop("opus_link_cards", None)
        changed = True

    if not has_existing_vote(modules):
        fallback_vote = deepcopy((opus_body or {}).get("fallback_vote") or {})
        if fallback_vote:
            additional["vote"] = fallback_vote
            changed = True

    if additional:
        module_dynamic["additional"] = additional
        modules["module_dynamic"] = module_dynamic

    return changed


async def enrich_additional_vote(additional, group_id=None):
    if not isinstance(additional, dict):
        return

    vote_obj = additional.get("vote")
    if not isinstance(vote_obj, dict):
        return

    vote_id = vote_obj.get("vote_id")
    if not vote_id:
        additional["vote"] = vote_obj
        return

    vote_client = vote_api.Vote(vote_id=int(vote_id), credential=load_credential(group_id))
    vote_info = await vote_client.get_info()
    items = []
    try:
        choices = (
            (vote_info.get("info") or {}).get("options")
            or vote_info.get("data", {}).get("choices")
            or vote_info.get("choices")
            or []
        )
    except Exception:
        choices = []

    for choice in choices:
        desc = (choice.get("desc") if isinstance(choice, dict) else str(choice)) or ""
        image = (choice.get("image") if isinstance(choice, dict) else None)
        count = (choice.get("cnt") if isinstance(choice, dict) else 0)
        items.append({"desc": desc, "image": image, "cnt": count})

    join_num = (
        (vote_info.get("info") or {}).get("cnt")
        or vote_info.get("data", {}).get("join_num")
        or vote_info.get("join_num")
        or vote_obj.get("join_num")
    )
    choice_cnt = (
        (vote_info.get("info") or {}).get("choice_cnt")
        or vote_info.get("data", {}).get("choice_cnt")
        or vote_info.get("choice_cnt")
        or vote_obj.get("choice_cnt")
    )
    title = (
        (vote_info.get("info") or {}).get("title")
        or vote_info.get("data", {}).get("title")
        or vote_info.get("title")
        or vote_obj.get("title")
    )
    desc = (
        (vote_info.get("info") or {}).get("desc")
        or vote_info.get("data", {}).get("desc")
        or vote_info.get("desc")
        or vote_obj.get("desc")
    )

    vote_obj["items"] = items
    if join_num is not None:
        vote_obj["join_num"] = join_num
    if choice_cnt is not None:
        vote_obj["choice_cnt"] = choice_cnt
    if title is not None:
        vote_obj["title"] = title
    if desc is not None:
        vote_obj["desc"] = desc
    additional["vote"] = vote_obj


async def enrich_opus_modules(modules, item_id, group_id=None, opus_body=None):
    if not isinstance(modules, dict):
        return modules

    module_dynamic = modules.get("module_dynamic") or {}
    major = module_dynamic.get("major") or {}
    if major.get("type") != "MAJOR_TYPE_OPUS":
        return modules

    additional = module_dynamic.get("additional")
    additional = additional if isinstance(additional, dict) else {}
    need_contract = additional.get("opus_link_cards") is None or not has_existing_vote(modules)

    if need_contract and opus_body is None and item_id and str(item_id).isdigit():
        opus_client = opus.Opus(int(item_id), credential=load_credential(group_id))
        opus_info = await opus_client.get_info()
        opus_body = extract_opus_content_payload(opus_info)

    if need_contract and opus_body:
        apply_opus_link_card_contract(modules, opus_body)

    additional = ((modules.get("module_dynamic") or {}).get("additional") or {})
    if isinstance(additional, dict) and additional.get("vote"):
        await enrich_additional_vote(additional, group_id)

    return modules
