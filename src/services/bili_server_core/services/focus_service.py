from ..media.image_focus import get_image_focus_color


async def build_focus(cover="", avatar=""):
    return {
        "cover": await get_image_focus_color(cover or "") if cover else None,
        "avatar": await get_image_focus_color(avatar or "") if avatar else None,
    }


async def build_cover_focus(cover=""):
    return {"cover": await get_image_focus_color(cover or "") if cover else None}


async def build_avatar_focus(avatar=""):
    return {"avatar": await get_image_focus_color(avatar or "") if avatar else None}
