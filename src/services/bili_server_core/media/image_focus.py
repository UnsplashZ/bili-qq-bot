import colorsys
import io

import aiohttp
from PIL import Image


async def _fetch_bytes(url: str) -> bytes:
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        }
        timeout = aiohttp.ClientTimeout(total=6)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    return await resp.read()
    except Exception:
        return b""
    return b""


def _rgb_to_hex(rgb):
    r, g, b = rgb
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


def _choose_focus_color(img: Image.Image) -> str:
    try:
        im = img.convert("RGB")
        im = im.resize((64, 64))
        colors = im.getcolors(maxcolors=100000) or []
        best_score = -1.0
        best_color = (255, 255, 255)
        total_r = total_g = total_b = 0
        total_count = 0
        for count, (r, g, b) in colors:
            total_r += r * count
            total_g += g * count
            total_b += b * count
            total_count += count
            _h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            if v < 0.15:
                continue
            if s < 0.15:
                continue
            score = (s * 0.7 + v * 0.3) * count
            if score > best_score:
                best_score = score
                best_color = (r, g, b)
        if best_score < 0 and total_count > 0:
            avg = (
                int(total_r / total_count),
                int(total_g / total_count),
                int(total_b / total_count),
            )
            return _rgb_to_hex(avg)
        return _rgb_to_hex(best_color)
    except Exception:
        return "#ffffff"


async def get_image_focus_color(url: str) -> str:
    if not url:
        return None
    try:
        data = await _fetch_bytes(url)
        if not data:
            return None
        img = Image.open(io.BytesIO(data))
        return _choose_focus_color(img)
    except Exception:
        return None

