from bilibili_api import user

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color


def _extract_decoration_info(decoration_card):
    if not isinstance(decoration_card, dict):
        return None, None

    card_number = (
        decoration_card.get("card_number")
        or decoration_card.get("fan_card_no")
        or decoration_card.get("card_no")
        or decoration_card.get("serial")
        or None
    )
    fan_info = decoration_card.get("fan", {})
    fan_color = fan_info.get("color") if fan_info else None
    return card_number, fan_color


async def _build_focus_colors(card_url, decoration_card, avatar_url):
    card_focus_color = None
    avatar_focus_color = None

    try:
        src = card_url or ((decoration_card or {}).get("card_url"))
        card_focus_color = await get_image_focus_color(src) if src else None
    except Exception:
        card_focus_color = None

    try:
        avatar_focus_color = await get_image_focus_color(avatar_url) if avatar_url else None
    except Exception:
        avatar_focus_color = None

    return card_focus_color, avatar_focus_color


def _build_author_context(
    *,
    level=0,
    pendant_url=None,
    card_url=None,
    decoration_card=None,
    card_number=None,
    fan_color=None,
    card_focus_color=None,
    avatar_focus_color=None,
):
    return {
        "level": level,
        "pendant_url": pendant_url,
        "card_url": card_url,
        "decoration_card": decoration_card,
        "card_number": card_number,
        "card_focus_color": card_focus_color,
        "fan_color": fan_color,
        "avatar_focus_color": avatar_focus_color,
    }


async def build_user_dynamic_author_context(user_client, dynamics):
    author_level = 0
    pendant_url = None
    card_url = None
    decoration_card = None
    card_number = None
    fan_color = None

    try:
        info = await user_client.get_user_info()
        author_level = info.get("level", 0)
    except Exception:
        author_level = 0

    try:
        profile = await user_client.get_user_profile()
        pendant_url = (profile.get("pendant") or {}).get("image") or (
            (profile.get("decorate") or {}).get("pendant") or {}
        ).get("image")
        card_url = (profile.get("decorate") or {}).get("card_url") or (
            profile.get("decorate_card") or {}
        ).get("image")
    except Exception:
        pass

    first_item_ma = ((dynamics or {}).get("items") or [{}])[0].get("modules", {}).get("module_author") or {}

    try:
        pendant_url = pendant_url or ((first_item_ma.get("pendant") or {}).get("image"))
        if "decoration_card" in first_item_ma and first_item_ma["decoration_card"]:
            decoration_card = first_item_ma["decoration_card"]
            card_number, fan_color = _extract_decoration_info(decoration_card)
    except Exception:
        pass

    author_face_url = first_item_ma.get("face") or (((dynamics or {}).get("items") or [{}])[0].get("author") or {}).get("face") or ""
    card_focus_color, avatar_focus_color = await _build_focus_colors(card_url, decoration_card, author_face_url)

    return _build_author_context(
        level=author_level,
        pendant_url=pendant_url,
        card_url=card_url,
        decoration_card=decoration_card,
        card_number=card_number,
        fan_color=fan_color,
        card_focus_color=card_focus_color,
        avatar_focus_color=avatar_focus_color,
    )


async def build_dynamic_detail_author_context(author_module, group_id=None):
    author_module = author_module if isinstance(author_module, dict) else {}
    author_uid = author_module.get("mid") or author_module.get("uid")

    pendant_url = None
    card_url = None
    author_level = 0
    decoration_card = None
    card_number = None
    fan_color = None

    if author_module.get("pendant"):
        pendant_url = author_module["pendant"].get("image")

    if author_module.get("decoration_card"):
        decoration_card = author_module["decoration_card"]
        card_url = decoration_card.get("card_url")
        card_number, fan_color = _extract_decoration_info(decoration_card)

    if author_module.get("level_info"):
        author_level = author_module["level_info"].get("current_level", 0)
    elif author_module.get("vip"):
        author_level = author_module["vip"].get("vip_level", 0)

    if (not pendant_url or not card_url or author_level == 0) and author_uid:
        try:
            user_client = user.User(uid=int(author_uid), credential=load_credential(group_id))
            base = await user_client.get_user_info()
            author_level = base.get("level", author_level)
            profile = await user_client.get_user_profile()
            pendant_url = pendant_url or (profile.get("pendant") or {}).get("image") or (
                (profile.get("decorate") or {}).get("pendant") or {}
            ).get("image")
            card_url = card_url or (profile.get("decorate") or {}).get("card_url") or (
                profile.get("decorate_card") or {}
            ).get("image")
        except Exception:
            pass

    avatar_url = author_module.get("face") or ""
    card_focus_color, avatar_focus_color = await _build_focus_colors(card_url, decoration_card, avatar_url)

    return _build_author_context(
        level=author_level,
        pendant_url=pendant_url,
        card_url=card_url,
        decoration_card=decoration_card,
        card_number=card_number,
        fan_color=fan_color,
        card_focus_color=card_focus_color,
        avatar_focus_color=avatar_focus_color,
    )
