import re

import aiohttp
from bs4 import BeautifulSoup
from bilibili_api import article, opus, user

from ..auth.credential_store import load_credential
from ..media.image_focus import get_image_focus_color


async def get_opus_detail(opus_id, group_id=None):
    try:
        o = opus.Opus(int(opus_id), credential=load_credential(group_id))
        if await o.is_article():
            result = await get_article_info(opus_id, group_id)
            if result.get("status") == "success":
                return result

        from .dynamic_service import get_dynamic_detail

        return await get_dynamic_detail(opus_id, group_id)
    except Exception as e:
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


async def get_article_info(cvid, group_id=None):
    try:
        base_id = cvid.split("?")[0].split("#")[0]
        base_id = re.sub(r"cv", "", base_id, flags=re.IGNORECASE)
        match = re.search(r"(\d+)", base_id)
        if not match:
            return {"status": "error", "message": "Invalid Article ID"}

        cvid_int = int(match.group(1))
        a = article.Article(cvid_int, credential=load_credential(group_id))
        info = await a.get_info()

        author_mid = info.get("mid")
        author_face = None
        if author_mid:
            try:
                u = user.User(uid=int(author_mid), credential=load_credential(group_id))
                author_info = await u.get_user_info()
                author_face = author_info.get("face")
            except Exception:
                pass

        if not author_face:
            author_face = (
                info.get("author", {}).get("face")
                if isinstance(info.get("author"), dict)
                else None
            )

        summary = ""
        html_content = ""
        try:
            content = await a.fetch_content()
            html_content = content
            summary = re.sub("<[^<]+?>", "", content)
        except Exception:
            pass

        if not summary or len(summary) < 10:
            try:
                url = f"https://www.bilibili.com/read/cv{cvid_int}"
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers) as resp:
                        final_url = str(resp.url)
                        if "/opus/" in final_url:
                            opus_match = re.search(r"/opus/(\d+)", final_url)
                            if opus_match:
                                opus_id = opus_match.group(1)
                                return await get_opus_detail(opus_id, group_id)

                        if resp.status == 200:
                            html = await resp.text()
                            soup = BeautifulSoup(html, "html.parser")
                            holder = (
                                soup.find(class_="article-holder")
                                or soup.find(id="read-article-holder")
                                or soup.find(class_="opus-module-content")
                            )
                            if holder:
                                for script in holder(["script", "style"]):
                                    script.extract()
                                html_content = holder.decode_contents()
                                summary = holder.get_text(separator="\n", strip=True)
                            else:
                                for script in soup(["script", "style"]):
                                    script.extract()
                                html_content = (
                                    soup.body.decode_contents()
                                    if soup.body
                                    else soup.decode_contents()
                                )
                                summary = soup.get_text(separator="\n", strip=True)
            except Exception as e:
                summary = f"无法抓取正文: {str(e)}"
                html_content = ""

        info["summary"] = summary[:2500] if summary else "点击查看详情"
        info["html_content"] = html_content
        info["author_face"] = author_face

        cover = info.get("banner_url")
        if not cover and info.get("image_urls"):
            cover = info["image_urls"][0]
        if not cover:
            cover = ""

        info["focus"] = {
            "cover": await get_image_focus_color(cover),
            "avatar": await get_image_focus_color(author_face),
        }

        if "publish_time" not in info:
            info["publish_time"] = info.get("ctime", info.get("ptime", 0))

        return {"status": "success", "type": "article", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

