import sys
import json
import asyncio
import re
import aiohttp
import time
import secrets
from bs4 import BeautifulSoup
import bilibili_api
from bilibili_api import video, bangumi, user, article, live, dynamic, show, topic, opus, Credential
from bilibili_api.utils.network import Api
import bilibili_api.login_v2 as login
import io
from PIL import Image
import colorsys
import logging

# 设置日志
logger = logging.getLogger(__name__)

# 配置 bilibili_api 以避免412错误
# 1. 更新请求头，添加完整的浏览器特征头部
bilibili_api.HEADERS.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.bilibili.com',
    'Origin': 'https://www.bilibili.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
})

# 2. bili_ticket 配置
# 注意: 启用 bili_ticket 可能减少风控触发，但当前版本的 bilibili-api 库
# 在获取 bili_ticket 时可能失败（KeyError: 'data'），导致每次启动报错
# 因此暂时禁用。如果遇到 412 错误，可以尝试重新启用并调试
try:
    bilibili_api.request_settings.set_enable_bili_ticket(False)  # 暂时禁用
    logger.info("bili_ticket 已禁用（避免启动时获取ticket失败）")
except Exception as e:
    logger.warning(f"无法配置 bili_ticket: {e}")

# Load credentials from a file if they exist
CREDENTIAL_FILE = 'data/cookies.json'
GROUP_COOKIES_MAP_FILE = 'data/cookies_map.json'

import os

# 视频下载目录：写入 Bot 与 NapCat 共享目录（默认 /app/.config/QQ/tmp/downloads）
# 不接受请求侧传入 output_dir，避免路径遍历风险
DOWNLOADS_ALLOWED_BASE = os.path.realpath(
    os.path.join(os.getenv('NAPCAT_TEMP_PATH', '/app/.config/QQ/tmp/'), 'downloads')
)

def get_credential_file(group_id=None):
    if not group_id:
        return CREDENTIAL_FILE
    
    # Try to load mapping
    mapping = {}
    try:
        if os.path.exists(GROUP_COOKIES_MAP_FILE):
            with open(GROUP_COOKIES_MAP_FILE, 'r') as f:
                mapping = json.load(f)
    except:
        pass
        
    group_key = str(group_id)
    if group_key in mapping:
        return mapping[group_key]
    
    # Default to group specific file
    return f'data/cookies_{group_key}.json'

def load_credential(group_id=None):
    """
    加载B站凭证，仅使用全局Cookie (cookies.json)

    注意：group_id参数保留用于兼容性，但已被忽略。
    自2026-02-05起，群级Cookie支持已移除。

    Args:
        group_id: （已废弃）群组ID，保留参数仅用于向后兼容

    Returns:
        Credential对象或None
    """
    # 仅加载全局Cookie (cookies.json)
    if os.path.exists(CREDENTIAL_FILE):
        try:
            with open(CREDENTIAL_FILE, 'r') as f:
                data = json.load(f)
                sessdata = data.get('SESSDATA')
                bili_jct = data.get('BILI_JCT')
                buvid3 = data.get('BUVID3')

                if not buvid3:
                    logger.warning("全局Cookie BUVID3 缺失，可能导致请求被风控")

                timestamp = data.get('_timestamp', 0)
                if timestamp:
                    age_days = (time.time() - timestamp) / (24 * 3600)
                    if age_days > 7:
                        logger.warning(f"全局Cookie 可能已过期 (age: {age_days:.1f} 天)")

                credential = Credential(
                    sessdata=sessdata,
                    bili_jct=bili_jct,
                    buvid3=buvid3,
                    dedeuserid=data.get('DEDEUSERID'),
                    ac_time_value=data.get('AC_TIME_VALUE')
                )
                logger.debug("使用全局Cookie")
                return credential
        except Exception as e:
            logger.error(f"加载全局Cookie失败: {e}")

    logger.debug("未找到可用的Cookie")
    return None

def save_credential(credential, group_id=None):
    # Determine target file
    if group_id:
        group_key = str(group_id)
        target_file = f'data/cookies_{group_key}.json'
        
        # Update mapping
        mapping = {}
        try:
            if os.path.exists(GROUP_COOKIES_MAP_FILE):
                with open(GROUP_COOKIES_MAP_FILE, 'r') as f:
                    mapping = json.load(f)
        except:
            pass
            
        mapping[group_key] = target_file
        with open(GROUP_COOKIES_MAP_FILE, 'w') as f:
            json.dump(mapping, f, indent=4)
    else:
        target_file = CREDENTIAL_FILE

    with open(target_file, 'w') as f:
        json.dump({
            'SESSDATA': credential.sessdata,
            'BILI_JCT': credential.bili_jct,
            'BUVID3': credential.buvid3,
            'DEDEUSERID': credential.dedeuserid,
            'AC_TIME_VALUE': credential.ac_time_value,
            '_timestamp': int(time.time())  # 添加时间戳用于过期检测
        }, f)

async def _fetch_buvid3():
    try:
        timeout = aiohttp.ClientTimeout(total=6)
        headers = bilibili_api.HEADERS.copy()
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get('https://www.bilibili.com', headers=headers) as resp:
                for name in resp.cookies:
                    if name.lower() == 'buvid3':
                        return resp.cookies[name].value
                for item in resp.headers.getall('Set-Cookie', []):
                    for part in item.split(';'):
                        kv = part.strip()
                        if kv.lower().startswith('buvid3='):
                            return kv.split('=', 1)[1]
    except Exception as e:
        logger.warning(f"获取BUVID3失败: {e}")
    return None

async def refresh_credential_if_needed():
    """
    检查并刷新全局 Cookie。
    返回:
      {"status": "ok",    "refreshed": bool, "message": str}
      {"status": "error", "reason": str,     "message": str}
    reason: no_credential | no_ac_time_value | invalid | check_failed | refresh_failed
    """
    credential = load_credential()
    if not credential or not credential.sessdata:
        return {"status": "error", "reason": "no_credential",
                "message": "未找到Cookie，请先在Dashboard扫码登录"}

    # 检查 Cookie 是否有效
    try:
        is_valid = await credential.check_valid()
        if not is_valid:
            return {"status": "error", "reason": "invalid",
                    "message": "Cookie已失效，请在Dashboard重新扫码登录"}
    except Exception as e:
        logger.warning(f"[Cookie] check_valid 异常: {e}")
        return {"status": "error", "reason": "check_failed",
                "message": f"Cookie有效性检查失败: {e}"}

    # 检查是否需要刷新（需要 ac_time_value）
    if not credential.ac_time_value:
        return {"status": "error", "reason": "no_ac_time_value",
                "message": "Cookie缺少ac_time_value，无法自动刷新。请在Dashboard重新扫码登录以启用自动刷新"}

    try:
        need_refresh = await credential.check_refresh()
        if not need_refresh:
            return {"status": "ok", "refreshed": False, "message": "Cookie有效，无需刷新"}

        await credential.refresh()
        await ensure_buvid3(credential)  # 确保 BUVID3 仍然有效
        save_credential(credential)
        logger.info("[Cookie] Cookie已自动刷新成功")
        return {"status": "ok", "refreshed": True, "message": "Cookie已自动刷新成功"}
    except Exception as e:
        logger.error(f"[Cookie] Cookie刷新失败: {e}")
        return {"status": "error", "reason": "refresh_failed",
                "message": f"Cookie刷新失败: {e}"}

async def ensure_buvid3(credential, group_id=None):
    if not credential or credential.buvid3:
        return credential
    buvid3 = await _fetch_buvid3()
    if buvid3:
        credential.buvid3 = buvid3
        save_credential(credential, group_id)
    return credential

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
    return '#{:02x}{:02x}{:02x}'.format(r, g, b)

def _choose_focus_color(img: Image.Image) -> str:
    try:
        im = img.convert('RGB')
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
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            if v < 0.15:
                continue
            if s < 0.15:
                continue
            score = (s * 0.7 + v * 0.3) * count
            if score > best_score:
                best_score = score
                best_color = (r, g, b)
        if best_score < 0 and total_count > 0:
            avg = (int(total_r / total_count), int(total_g / total_count), int(total_b / total_count))
            return _rgb_to_hex(avg)
        return _rgb_to_hex(best_color)
    except Exception:
        return '#ffffff'

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

async def get_video_info(bvid, group_id=None):
    try:
        if str(bvid).lower().startswith('av'):
            aid = int(str(bvid)[2:])
            v = video.Video(aid=aid, credential=load_credential(group_id))
        else:
            v = video.Video(bvid=bvid, credential=load_credential(group_id))
        info = await v.get_info()
        cover_url = info.get('pic') or ''
        owner = info.get('owner') or {}
        avatar_url = owner.get('face') or ''
        cover_focus = await get_image_focus_color(cover_url)
        avatar_focus = await get_image_focus_color(avatar_url)
        info['focus'] = {
            "cover": cover_focus,
            "avatar": avatar_focus
        }
        return {"status": "success", "type": "video", "data": info}
    except Exception as e:
        # 只在非预期错误时打印traceback，已知的cookie无效错误不需要打印
        if str(e) != "'data'":
            import traceback
            traceback.print_exc()

        if str(e) == "'data'":
             return {"status": "error", "message": "Bilibili API format error (KeyError: 'data') - Cookie likely invalid"}
        return {"status": "error", "message": str(e)}

async def get_bangumi_info(season_id, group_id=None):
    try:
        # 使用ssid参数初始化Bangumi类，这对某些番剧是必需的
        b = bangumi.Bangumi(ssid=int(season_id), credential=load_credential(group_id))

        # 首先使用season_id获取meta信息，以获取media_id
        try:
            meta = await b.get_meta()
            media_id = meta.get('media', {}).get('media_id')

            if media_id:
                # 如果获取到media_id，使用它创建新的Bangumi实例来获取详细信息
                b_with_media = bangumi.Bangumi(media_id=int(media_id), credential=load_credential(group_id))

                # 获取overview和stat信息
                try:
                    overview = await b_with_media.get_overview()
                except:
                    # 如果获取overview失败，至少使用meta中的信息
                    overview = meta.get('media', {})

                try:
                    stat = await b_with_media.get_stat()
                except:
                    stat = {}
            else:
                # 如果没有获取到media_id，尝试直接使用season_id
                try:
                    overview = await b.get_overview()
                except:
                    overview = meta.get('media', {})

                try:
                    stat = await b.get_stat()
                except:
                    stat = {}
        except Exception as meta_error:
            # 如果get_meta失败，尝试直接使用season_id
            try:
                overview = await b.get_overview()
            except:
                return {"status": "error", "message": f"无法获取番剧信息: {str(meta_error)}"}

            try:
                stat = await b.get_stat()
            except:
                stat = {}

        # Get additional details
        try:
            detail = await b.get_detail()
        except:
            detail = {}

        # 构建返回数据
        data = {
            "title": overview.get('title', overview.get('season_title', '')),
            "cover": overview.get('cover', ''),
            "desc": overview.get('evaluate', overview.get('desc', '')),
            "stat": stat,
            "new_ep": overview.get('new_ep', {}),
            "rating": overview.get('rating', {}),
            "styles": overview.get('styles', []),
            "areas": overview.get('areas', []),
            "publish": overview.get('publish', {}),
            "season_id": overview.get('season_id', season_id),
            "season_type": overview.get('season_type'),
            "type_desc": overview.get('type_desc'),
            "series": overview.get('series', {}),
            "detail": detail,
            "focus": {
                "cover": await get_image_focus_color(overview.get('cover', ''))
            }
        }

        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_opus_detail(opus_id, group_id=None):
    try:
        o = opus.Opus(int(opus_id), credential=load_credential(group_id))
        if await o.is_article():
            result = await get_article_info(opus_id, group_id)
            if result.get('status') == 'success':
                return result
            # If article fetch fails (e.g. 404), fallback to dynamic detail
            
        # Fallback to dynamic detail
        return await get_dynamic_detail(opus_id, group_id)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_article_info(cvid, group_id=None):
    try:
        # Clean cvid: remove 'cv' prefix
        # Handle cases like "cv123456?param=1" -> "123456"
        # Split by '?' first to remove query params
        base_id = cvid.split('?')[0].split('#')[0]
        # Remove 'cv' (case insensitive)
        base_id = re.sub(r'cv', '', base_id, flags=re.IGNORECASE)
        # Extract the first sequence of digits
        match = re.search(r'(\d+)', base_id)
        if not match:
             return {"status": "error", "message": "Invalid Article ID"}
             
        cvid_int = int(match.group(1))
        a = article.Article(cvid_int, credential=load_credential(group_id))
        info = await a.get_info()

        # 获取作者信息（头像等）
        author_mid = info.get('mid')
        author_face = None
        if author_mid:
            try:
                u = user.User(uid=int(author_mid), credential=load_credential(group_id))
                author_info = await u.get_user_info()
                author_face = author_info.get('face')
            except:
                pass

        # 如果通过API获取失败，从info中尝试获取
        if not author_face:
            author_face = info.get('author', {}).get('face') if isinstance(info.get('author'), dict) else None

        # Try to get content for summary
        summary = ""
        html_content = ""
        try:
            content = await a.fetch_content()
            html_content = content
            summary = re.sub('<[^<]+?>', '', content)
        except Exception:
            pass

        # Fallback scraping if summary is empty/failed
        if not summary or len(summary) < 10:
            try:
                url = f"https://www.bilibili.com/read/cv{cvid_int}"
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                }
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers) as resp:
                        # Check for redirect to Opus
                        final_url = str(resp.url)
                        if '/opus/' in final_url:
                            opus_match = re.search(r'/opus/(\d+)', final_url)
                            if opus_match:
                                opus_id = opus_match.group(1)
                                return await get_opus_detail(opus_id, group_id)

                        if resp.status == 200:
                            html = await resp.text()
                            soup = BeautifulSoup(html, 'html.parser')
                            # Try specific holders first
                            holder = soup.find(class_='article-holder') or soup.find(id='read-article-holder') or soup.find(class_='opus-module-content')
                            if holder:
                                # Clean up scripts/styles from holder
                                for script in holder(["script", "style"]):
                                    script.extract()
                                html_content = holder.decode_contents()
                                summary = holder.get_text(separator='\n', strip=True)
                            else:
                                # Fallback to body text, removing scripts/styles
                                for script in soup(["script", "style"]):
                                    script.extract()
                                html_content = soup.body.decode_contents() if soup.body else soup.decode_contents()
                                summary = soup.get_text(separator='\n', strip=True)
            except Exception as e:
                summary = f"无法抓取正文: {str(e)}"
                html_content = ""

        info['summary'] = summary[:2500] if summary else '点击查看详情'
        info['html_content'] = html_content

        info['author_face'] = author_face  # 添加作者头像
        
        # Determine cover image
        cover = info.get('banner_url')
        if not cover and info.get('image_urls'):
            cover = info['image_urls'][0]
        if not cover:
            cover = ''

        info['focus'] = {
            "cover": await get_image_focus_color(cover),
            "avatar": await get_image_focus_color(author_face)
        }

        # Map publish_time if missing (Article API varies)
        if 'publish_time' not in info:
            # Some APIs use ctime or ptime
            info['publish_time'] = info.get('ctime', info.get('ptime', 0))

        return {"status": "success", "type": "article", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_live_room_info(room_id, group_id=None):
    try:
        l = live.LiveRoom(int(room_id), credential=load_credential(group_id))
        info = await l.get_room_info()
        room_info = info.get('room_info', {})
        anchor_info = info.get('anchor_info', {}).get('base_info', {})
        cover_url = room_info.get('cover') or ''
        avatar_url = anchor_info.get('face') or ''
        info['focus'] = {
            "cover": await get_image_focus_color(cover_url),
            "avatar": await get_image_focus_color(avatar_url)
        }
        return {"status": "success", "type": "live", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_login_url():
    try:
        logger.info("开始生成登录二维码...")
        # 使用 QrCodeLogin 类获取二维码
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        await q.generate_qrcode()
        logger.info("登录二维码生成成功")
        return {"status": "success", "data": {
            "url": q._QrCodeLogin__qr_link,
            "key": q._QrCodeLogin__qr_key
        }}
    except Exception as e:
        logger.error(f"生成登录二维码失败: {type(e).__name__}: {str(e)}")
        import traceback
        logger.error(f"详细错误: {traceback.format_exc()}")
        return {"status": "error", "message": str(e)}

async def poll_login(qrcode_key, group_id=None):
    try:
        # 实例化并手动设置 key 以支持轮询
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        q._QrCodeLogin__qr_key = qrcode_key

        event = await q.check_state()

        if event == login.QrCodeLoginEvents.DONE:
            logger.info(f"登录成功 (group_id: {group_id})")
            credential = q.get_credential()
            save_credential(credential, group_id)
            await ensure_buvid3(credential, group_id)
            return {"status": "success", "message": "登录成功"}
        elif event == login.QrCodeLoginEvents.SCAN:
            return {"status": "pending", "code": 86101, "message": "等待扫码"}
        elif event == login.QrCodeLoginEvents.CONF:
            return {"status": "pending", "code": 86090, "message": "已扫码，请在手机上确认"}
        elif event == login.QrCodeLoginEvents.TIMEOUT:
            logger.warning("登录二维码已过期")
            return {"status": "error", "code": 86038, "message": "二维码已过期"}
        else:
            logger.warning(f"未知的登录状态: {event}")
            return {"status": "error", "message": "未知状态"}

    except Exception as e:
        logger.error(f"检查登录状态失败: {type(e).__name__}: {str(e)}")
        return {"status": "error", "message": str(e)}

async def get_user_dynamic(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        # 使用新的 get_dynamics_new 接口
        dynamics = await u.get_dynamics_new(offset="")
        if dynamics and 'items' in dynamics and len(dynamics['items']) > 0:
            # 获取作者扩展信息：等级、头像框、动态卡片（若可用）
            # 这些信息对于所有动态都是通用的（基于当前用户状态）
            author_level = 0
            pendant_url = None
            card_url = None
            decoration_card = None
            card_number = None
            fan_color = None
            
            try:
                info = await u.get_user_info()
                author_level = info.get('level', 0)
            except:
                author_level = 0
                
            try:
                profile = await u.get_user_profile()
                # 头像挂件/头像框
                pendant_url = (
                    (profile.get('pendant') or {}).get('image') or
                    ((profile.get('decorate') or {}).get('pendant') or {}).get('image')
                )
                # 动态卡片
                card_url = (
                    (profile.get('decorate') or {}).get('card_url') or
                    (profile.get('decorate_card') or {}).get('image')
                )
            except:
                pass

            # 尝试从第一条动态补充信息 (如果 API 没返回)
            first_item_ma = (dynamics['items'][0].get('modules') or {}).get('module_author') or {}
            try:
                pendant_url = pendant_url or ((first_item_ma.get('pendant') or {}).get('image'))
                if 'decoration_card' in first_item_ma and first_item_ma['decoration_card']:
                    decoration_card = first_item_ma['decoration_card']
                    card_number = (
                        decoration_card.get('card_number') or
                        decoration_card.get('fan_card_no') or
                        decoration_card.get('card_no') or
                        decoration_card.get('serial') or
                        None
                    )
                    fan_info = decoration_card.get('fan', {})
                    fan_color = fan_info.get('color') if fan_info else None
            except:
                pass
            
            # 颜色计算
            card_focus_color = None
            avatar_focus_color = None
            try:
                src = card_url or ((decoration_card or {}).get('card_url'))
                card_focus_color = await get_image_focus_color(src) if src else None
            except:
                pass
            try:
                author_face_url = first_item_ma.get('face') or (dynamics['items'][0].get('author') or {}).get('face') or ''
                avatar_focus_color = await get_image_focus_color(author_face_url) if author_face_url else None
            except:
                pass

            author_info = {
                "level": author_level,
                "pendant_url": pendant_url,
                "card_url": card_url,
                "decoration_card": decoration_card,
                "card_number": card_number,
                "card_focus_color": card_focus_color,
                "fan_color": fan_color,
                "avatar_focus_color": avatar_focus_color
            }

            result_items = []
            # 返回前 5 条动态，让 JS 端处理过滤
            for item in dynamics['items'][:5]:
                pub_ts = 0
                if 'modules' in item and 'module_author' in item['modules']:
                    pub_ts = item['modules']['module_author'].get('pub_ts', 0)

                # Normalize modules data to ensure text content is available
                modules = item.get('modules') or {}
                module_dynamic = modules.get('module_dynamic')

                if module_dynamic:
                    # Fix missing desc: Extract text from opus.summary if desc is missing
                    if not module_dynamic.get('desc'):
                        major = module_dynamic.get('major') or {}
                        opus = major.get('opus')
                        if opus and opus.get('summary'):
                            # Construct desc structure from opus.summary
                            module_dynamic['desc'] = {
                                'text': opus['summary'].get('text', ''),
                                'rich_text_nodes': opus['summary'].get('rich_text_nodes', [])
                            }
                            logger.debug(f"[get_user_dynamic] Dynamic {item.get('id_str')}: Extracted desc from opus.summary")

                    # 话题修复（与 get_dynamic_detail 保持一致）
                    topic_added = False
                    try:
                        topic = module_dynamic.get('topic')
                        if topic and isinstance(topic, dict):
                            topic_name = topic.get('name', '')
                            topic_id = topic.get('id', 0)
                            if topic_name and topic_id:
                                # 确保 desc 存在
                                if not module_dynamic.get('desc'):
                                    module_dynamic['desc'] = {'text': '', 'rich_text_nodes': []}

                                # 在文本结尾添加话题标签（与 get_dynamic_detail 保持一致）
                                desc = module_dynamic['desc']
                                topic_tag = f"#{topic_name}#"
                                if topic_tag not in desc['text']:
                                    desc['text'] = desc['text'] + f" #{topic_name}#"

                                # 在 rich_text_nodes 开头添加话题节点
                                if not desc.get('rich_text_nodes'):
                                    desc['rich_text_nodes'] = []

                                topic_node = {
                                    'type': 'RICH_TEXT_NODE_TYPE_TOPIC',
                                    'text': topic_tag,
                                    'jump_url': f"https://www.bilibili.com/v/topic/detail/?topic_id={topic_id}",
                                    'orig_text': topic_tag
                                }

                                # 检查是否已存在话题节点
                                if not any(n.get('type') == 'RICH_TEXT_NODE_TYPE_TOPIC' for n in desc['rich_text_nodes']):
                                    desc['rich_text_nodes'].insert(0, topic_node)

                                topic_added = True
                                logger.debug(f"[get_user_dynamic] Dynamic {item.get('id_str')}: Added topic '{topic_name}' from topic field")
                    except Exception as e:
                        logger.warning(f"[get_user_dynamic] Failed to process topic: {e}")

                    # 兜底：使用正则表达式修复话题格式（与 get_dynamic_detail 保持一致）
                    # Keep this as a fallback for cases where topics are embedded in text but not in topic field
                    if not topic_added:
                        # 使用 `or {}` 处理 desc 为 None 的情况
                        desc_text = (module_dynamic.get('desc') or {}).get('text', '')
                        if desc_text and '#' in desc_text:
                            # Fix topic hashtag formatting (B站API返回的话题可能格式不完整)
                            fixed_text = re.sub(r'#([^#\s]+?)#', r'#\1# ', desc_text)
                            if fixed_text != desc_text:
                                # 确保 desc 存在且不为 None
                                if not module_dynamic.get('desc'):
                                    module_dynamic['desc'] = {'text': '', 'rich_text_nodes': []}
                                module_dynamic['desc']['text'] = fixed_text
                                logger.debug(f"[get_user_dynamic] Dynamic {item.get('id_str')}: Fixed topic formatting")

                # Construct desc object for backward compatibility with old API format
                desc = {
                    "dynamic_id_str": item.get('id_str'),
                    "type": item.get('type'),
                    "timestamp": pub_ts,
                    "user_profile": {
                        "info": {
                            "face": (item.get('modules', {}).get('module_author', {}).get('face', ''))
                        }
                    }
                }

                result_items.append({
                    "desc": desc,  # Old API compatibility
                    "card": item.get('card'),  # Original card string (if exists)
                    "extend_json": item.get('extend_json'),  # Original extend_json (if exists)
                    # New API fields
                    "id_str": item.get('id_str'),
                    "type": item.get('type'),
                    "modules": modules,  # Use normalized modules
                    "orig": item.get('orig'),
                    "pub_ts": pub_ts,
                    "author": author_info
                })

            return {"status": "success", "data": {"cards": result_items}}
        return {"status": "success", "data": {"cards": []}}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_user_live(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        live_info = await u.get_live_info()
        
        # 兼容性处理：确保 JS 端需要的字段存在
        if 'live_room' in live_info:
            lr = live_info['live_room']
            # room_id 兼容
            if 'roomid' in lr and 'room_id' not in lr:
                lr['room_id'] = lr['roomid']
            # live_status 兼容
            if 'liveStatus' in lr and 'live_status' not in lr:
                lr['live_status'] = lr['liveStatus']
                
        return {"status": "success", "data": live_info}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_user_videos(uid, group_id=None):
    """
    获取用户视频列表

    Args:
        uid: 用户UID
        group_id: 群组ID（用于Cookie）

    Returns:
        {
            "status": "success",
            "data": {
                "videos": [
                    {
                        "bvid": "BV...",
                        "aid": 123456,
                        "title": "视频标题",
                        "created": 1234567890,
                        "pic": "封面URL",
                        "description": "简介",
                        "play": 1000,
                        "video_review": 100
                    },
                    ...
                ]
            }
        }
    """
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        # 获取视频列表（只获取第一页，pn=1）
        result = await u.get_videos(pn=1, ps=30)

        # 提取视频列表
        if 'list' in result and 'vlist' in result['list']:
            videos = result['list']['vlist']

            return {
                "status": "success",
                "data": {
                    "videos": videos
                }
            }
        else:
            return {
                "status": "success",
                "data": {"videos": []}
            }

    except Exception as e:
        logger.error(f"获取用户视频列表失败 (UID: {uid}): {e}")
        return {
            "status": "error",
            "message": str(e)
        }


async def get_user_articles(uid, group_id=None):
    """
    获取用户专栏列表

    Args:
        uid: 用户UID
        group_id: 群组ID（用于Cookie）

    Returns:
        {
            "status": "success",
            "data": {
                "articles": [
                    {
                        "id": 45123193,
                        "title": "专栏标题",
                        "publish_time": 1234567890,
                        "summary": "摘要",
                        "banner_url": "封面URL",
                        "view": 1000,
                        "reply": 100
                    },
                    ...
                ]
            }
        }
    """
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        # 获取专栏列表（只获取第一页，pn=1）
        result = await u.get_articles(pn=1, ps=30)

        # 提取专栏列表
        if 'articles' in result:
            articles = result['articles']

            return {
                "status": "success",
                "data": {
                    "articles": articles
                }
            }
        else:
            return {
                "status": "success",
                "data": {"articles": []}
            }

    except Exception as e:
        logger.error(f"获取用户专栏列表失败 (UID: {uid}): {e}")
        return {
            "status": "error",
            "message": str(e)
        }


async def get_dynamic_detail(dynamic_id, group_id=None):
    try:
        d = dynamic.Dynamic(int(dynamic_id), credential=load_credential(group_id))
        info = await d.get_info()

        # 检查返回的数据是否有效
        if not info:
            return {"status": "error", "message": f"无法获取动态 {dynamic_id} 的信息，可能已被删除或设置为私密"}

        # 检查modules是否为空
        modules = (info.get('item') or {}).get('modules') or info.get('modules') or {}

        if not modules:
            # Check for Opus redirect in basic info as fallback
            item = info.get('item', {})
            basic = item.get('basic', {})
            jump_url = basic.get('jump_url', '')
            if '/opus/' in jump_url:
                opus_match = re.search(r'/opus/(\d+)', jump_url)
                if opus_match:
                    opus_id = opus_match.group(1)
                    return await get_opus_detail(opus_id, group_id)

            return {"status": "error", "message": f"动态 {dynamic_id} 的数据结构异常，可能已被删除"}

        # 修复话题显示问题：将独立的话题字段追加到文本内容中
        try:
            md = modules.get('module_dynamic') or {}
            topic_info = md.get('topic')
            if topic_info and topic_info.get('name'):
                topic_name = topic_info.get('name')
                desc_obj = md.get('desc')
                if desc_obj:
                    text = desc_obj.get('text', '')
                    # 如果文本中没有包含该话题（简单判断），则追加到末尾
                    if f"{topic_name}" not in text:
                         desc_obj['text'] = text + f" #{topic_name}#"
                         
                         # 同时追加到 rich_text_nodes 以支持富文本渲染
                         nodes = desc_obj.get('rich_text_nodes')
                         if isinstance(nodes, list):
                             # 添加一个空格节点作为分隔
                             nodes.append({
                                 "text": " ",
                                 "type": "RICH_TEXT_NODE_TYPE_TEXT",
                                 "orig_text": " "
                             })
                             # 添加话题节点
                             nodes.append({
                                 "text": f"{topic_name}",
                                 "type": "RICH_TEXT_NODE_TYPE_TOPIC",
                                 "orig_text": f"#{topic_name}#"
                             })
        except:
            pass

        author_module = modules.get('module_author') or {}
        author_uid = author_module.get('mid') or author_module.get('uid')

        # 从 author_module 中直接提取装饰信息
        pendant_url = None
        card_url = None
        author_level = 0
        decoration_card = None
        card_number = None
        fan_color = None  # 初始化 fan_color

        # 从模块中获取头像框
        if 'pendant' in author_module and author_module['pendant']:
            pendant_url = author_module['pendant'].get('image')

        # 从模块中获取装饰卡片
        if 'decoration_card' in author_module and author_module['decoration_card']:
            decoration_card = author_module['decoration_card']
            card_url = decoration_card.get('card_url')
            card_number = (
                decoration_card.get('card_number') or
                decoration_card.get('fan_card_no') or
                decoration_card.get('card_no') or
                decoration_card.get('serial') or
                None
            )
            # 获取粉丝牌颜色信息
            fan_info = decoration_card.get('fan', {})
            fan_color = fan_info.get('color') if fan_info else None

        # 从模块中获取等级
        if 'level_info' in author_module and author_module['level_info']:
            author_level = author_module['level_info'].get('current_level', 0)
        elif 'vip' in author_module and author_module['vip']:
            # 从VIP信息中获取等级（如果可用）
            author_level = author_module['vip'].get('vip_level', 0)
        elif 'pendant' in author_module and author_module['pendant']:
            # 有些情况下等级信息可能在pendant中
            pass

        # 如果上面没有获取到装饰信息或等级，再尝试通过用户API获取
        if (not pendant_url or not card_url or author_level == 0) and author_uid:
            try:
                u = user.User(uid=int(author_uid), credential=load_credential(group_id))
                base = await u.get_user_info()
                author_level = base.get('level', author_level)  # 保持之前获取到的等级，如果获取不到则使用之前的值
                profile = await u.get_user_profile()
                pendant_url = pendant_url or (
                    (profile.get('pendant') or {}).get('image') or
                    ((profile.get('decorate') or {}).get('pendant') or {}).get('image')
                )
                card_url = card_url or (
                    (profile.get('decorate') or {}).get('card_url') or
                    (profile.get('decorate_card') or {}).get('image')
                )
            except:
                pass
        card_focus_color = None
        avatar_focus_color = None
        try:
            src = card_url or ((decoration_card or {}).get('card_url'))
            card_focus_color = await get_image_focus_color(src) if src else None
        except:
            card_focus_color = None
        try:
            avatar_url = author_module.get('face') or ''
            avatar_focus_color = await get_image_focus_color(avatar_url) if avatar_url else None
        except:
            avatar_focus_color = None

        author_obj = {
            "level": author_level,
            "pendant_url": pendant_url,
            "card_url": card_url,
            "decoration_card": decoration_card,
            "card_number": card_number,
            "card_focus_color": card_focus_color,
            "fan_color": fan_color,
            "avatar_focus_color": avatar_focus_color
        }
        info['author'] = author_obj
        try:
            if isinstance(info.get('item'), dict):
                info['item']['author'] = author_obj
        except:
            pass
        # Enrich vote info (if present) using bilibili_api.vote by vote_id
        try:
            mods = (info.get('item') or {}).get('modules') or info.get('modules') or {}
            md = mods.get('module_dynamic') or {}
            additional = md.get('additional') or {}
            vobj = additional.get('vote') or {}
            vote_id = vobj.get('vote_id')
            if vote_id:
                from bilibili_api import vote as vote_api
                vv = vote_api.Vote(vote_id=int(vote_id), credential=load_credential(group_id))
                vinfo = await vv.get_info()
                # Normalize to expected fields for Node renderer
                # choices may reside under data['choices'] or info['options'] or similar
                items = []
                try:
                    # Priority: info.options (seen in debug) -> data.choices -> choices
                    choices = (vinfo.get('info') or {}).get('options') or vinfo.get('data', {}).get('choices') or vinfo.get('choices') or []
                except:
                    choices = []
                for ch in choices:
                    # support both dict and tuple-like entries
                    desc = (ch.get('desc') if isinstance(ch, dict) else str(ch)) or ''
                    img = (ch.get('image') if isinstance(ch, dict) else None)
                    cnt = (ch.get('cnt') if isinstance(ch, dict) else 0)
                    items.append({"desc": desc, "image": img, "cnt": cnt})
                
                # Join num and choice cnt
                join_num = (vinfo.get('info') or {}).get('cnt') or vinfo.get('data', {}).get('join_num') or vinfo.get('join_num') or vobj.get('join_num')
                choice_cnt = (vinfo.get('info') or {}).get('choice_cnt') or vinfo.get('data', {}).get('choice_cnt') or vinfo.get('choice_cnt') or vobj.get('choice_cnt')
                title = (vinfo.get('info') or {}).get('title') or vinfo.get('data', {}).get('title') or vinfo.get('title') or vobj.get('title')
                desc = (vinfo.get('info') or {}).get('desc') or vinfo.get('data', {}).get('desc') or vinfo.get('desc') or vobj.get('desc')
                # Attach normalized fields back to structure
                vobj['items'] = items
                if join_num is not None:
                    vobj['join_num'] = join_num
                if choice_cnt is not None:
                    vobj['choice_cnt'] = choice_cnt
                if title is not None:
                    vobj['title'] = title
                if desc is not None:
                    vobj['desc'] = desc
                # write back
                additional['vote'] = vobj
                md['additional'] = additional
                mods['module_dynamic'] = md
                # Update both places (item.modules and top-level modules) for robustness
                if isinstance(info.get('item'), dict):
                    info['item']['modules'] = mods
                info['modules'] = mods
        except Exception:
            # ignore enrichment errors
            pass

        # 尝试补充Opus内容图片（针对文章类型和Opus类型动态图片缺失的情况）
        try:
            # 处理info可能是{'item': {...}}的情况
            item = info.get('item', {})
            md = item.get('modules', {}).get('module_dynamic', {})
            major = md.get('major', {})

            if major.get('type') in ['DYNAMIC_TYPE_ARTICLE', 'MAJOR_TYPE_OPUS'] and not (major.get('opus') or {}).get('pics'):
                # 需要通过Opus API获取详细内容
                opus_id = item.get('id_str', info.get('id_str'))
                if opus_id:
                     o = opus.Opus(int(opus_id), credential=load_credential(group_id))
                     opus_info = await o.get_info()

                     opus_item = opus_info.get('item', {})
                     opus_modules = opus_item.get('modules', [])

                     images = []
                     for mod in opus_modules:
                         if mod.get('module_type') == 'MODULE_TYPE_CONTENT':
                             paragraphs = mod.get('module_content', {}).get('paragraphs', [])
                             for p in paragraphs:
                                 if p.get('para_type') == 2: # Image
                                     pics = p.get('pic', {}).get('pics', [])
                                     for pic in pics:
                                         if pic.get('url'):
                                             images.append({'url': pic['url']})

                     if images:
                         if 'opus' not in major:
                             major['opus'] = {}
                         major['opus']['pics'] = images
                         # 更新数据结构
                         md['major'] = major
                         item['modules']['module_dynamic'] = md
                         info['item'] = item
        except Exception as e:
            # 静默处理Opus图片获取失败（可能是风控等原因）
            # 不影响主流程，继续返回基础数据
            pass

        return {"status": "success", "type": "dynamic", "data": info}
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        return {"status": "error", "message": str(e), "detail": error_detail}

async def get_ep_info(ep_id, group_id=None):
    try:
        # 使用Episode类获取EP信息
        ep = bangumi.Episode(int(ep_id), credential=load_credential(group_id))
        info, _ = await ep.get_episode_info()  # 获取信息和数据类型，但只使用信息

        # 获取对应的番剧信息
        bangumi_info = await ep.get_bangumi_from_episode()
        bangumi_overview = await bangumi_info.get_overview()
        bangumi_stat = await bangumi_info.get_stat()

        # 组合信息
        data = {
            "title": bangumi_overview.get('title', ''),
            "cover": bangumi_overview.get('cover', ''),
            "desc": bangumi_overview.get('evaluate', ''),
            "stat": bangumi_stat,
            "rating": bangumi_overview.get('rating', {}),
            "styles": bangumi_overview.get('styles', []),
            "areas": bangumi_overview.get('areas', []),
            "publish": bangumi_overview.get('publish', {}),
            "season_id": bangumi_overview.get('season_id'),
            "season_type": bangumi_overview.get('season_type'),
            "type_desc": bangumi_overview.get('type_desc'),
            "series": bangumi_overview.get('series', {}),
            "new_ep": bangumi_overview.get('new_ep', {}),
            "ep_id": ep_id
        }
        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_media_info(media_id, group_id=None):
    try:
        # 使用media_id获取番剧信息
        b = bangumi.Bangumi(media_id=int(media_id), credential=load_credential(group_id))

        # 获取番剧概览信息
        overview = await b.get_overview()

        # 获取统计信息
        try:
            stat = await b.get_stat()
        except:
            stat = {}

        # 获取额外详情
        try:
            detail = await b.get_detail()
        except:
            detail = {}

        # 组合信息
        data = {
            "title": overview.get('title', ''),
            "cover": overview.get('cover', ''),
            "desc": overview.get('evaluate', ''),
            "stat": stat,
            "new_ep": overview.get('new_ep', {}),
            "rating": overview.get('rating', {}),
            "styles": overview.get('styles', []),
            "areas": overview.get('areas', []),
            "publish": overview.get('publish', {}),
            "season_id": overview.get('season_id', ''),
            "series": overview.get('series', {}),
            "detail": detail,
            "focus": {
                "cover": await get_image_focus_color(overview.get('cover', ''))
            }
        }
        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_user_card(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))
        user_info = await u.get_user_info()
        data = {
            "uid": user_info.get('mid', uid),
            "name": user_info.get('name', ''),
            "face": user_info.get('face', '')
        }
        return {"status": "success", "type": "user_card", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_user_info(uid, group_id=None):
    try:
        u = user.User(uid=int(uid), credential=load_credential(group_id))

        # 获取用户基本信息
        user_info = await u.get_user_info()

        # 获取关系信息 (粉丝数/关注数)
        try:
            relation = await u.get_relation_info()
        except:
            relation = {}

        # 获取统计信息 (获赞/播放)
        try:
            up_stat = await u.get_up_stat()
            likes = up_stat.get('likes', 0)
            archive_view = up_stat.get('archive', {}).get('view', 0)
        except:
            likes = 0
            archive_view = 0

        # 获取最新动态 (使用 get_dynamics_new)
        latest_dynamic = None
        try:
            dynamics = await u.get_dynamics_new(offset="")
            if dynamics and 'items' in dynamics and len(dynamics['items']) > 0:
                max_ts = -1
                for item in dynamics['items'][:5]:
                    ts = 0
                    try:
                        if 'modules' in item and 'module_author' in item['modules']:
                            ts = int(item['modules']['module_author'].get('pub_ts', 0))
                    except:
                        pass
                    
                    if ts > max_ts:
                        max_ts = ts
                        latest_dynamic = item

                if not latest_dynamic:
                    latest_dynamic = dynamics['items'][0]
        except:
            pass

        # 组合信息
        data = {
            "uid": user_info.get('mid', uid),
            "name": user_info.get('name', ''),
            "level": user_info.get('level', 0),
            "face": user_info.get('face', ''),
            "pendant": user_info.get('pendant', {}),
            "sign": user_info.get('sign', ''),
            "vip": user_info.get('vip', {}),
            "fans_medal": user_info.get('fans_medal', {}),
            "relation": relation,
            "likes": likes,
            "archive_view": archive_view,
            "dynamic": latest_dynamic,
            "live_room": user_info.get('live_room', {}),  # 直播间信息
            "focus": {
                "avatar": await get_image_focus_color(user_info.get('face', ''))
            }
        }

        return {"status": "success", "type": "user", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_my_followings(group_name=None, group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}
        
        # Get self info to find my_uid
        self_info = await user.get_self_info(credential=cred)
        my_uid = self_info['mid']
        u = user.User(uid=my_uid, credential=cred)
        
        all_followings = []
        page = 1
        page_size = 50
        
        if group_name:
            # 1. 获取所有分组
            try:
                groups_api = Api("https://api.bilibili.com/x/relation/tags", method="GET", credential=cred)
                groups = await groups_api.result
            except Exception as e:
                return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}
            
            target_group = None
            if groups:
                for g in groups:
                    if g.get('name') == group_name:
                        target_group = g
                        break
            
            if not target_group:
                 return {"status": "error", "message": f"未找到名为 '{group_name}' 的分组"}
            
            tagid = target_group['tagid']
            
            # 2. 获取分组下的用户
            while True:
                try:
                    group_users_api = Api("https://api.bilibili.com/x/relation/tag", method="GET", credential=cred)
                    group_users_api.update_params(mid=my_uid, tagid=tagid, pn=page, ps=page_size)
                    res = await group_users_api.result
                except Exception as e:
                    # 某些情况下 API 可能报错或返回非标准格式
                    print(f"Error fetching group users: {e}")
                    break

                if not res:
                    break
                
                if isinstance(res, list):
                    current_list = res
                    if not current_list:
                        break
                    all_followings.extend(current_list)
                    
                    if len(current_list) < page_size:
                        break
                else:
                    break

                page += 1
                if page > 100:
                    break
                    
        else:
            # 原有逻辑：获取所有关注
            while True:
                # get_followings returns a dict with 'list', 'total', 're_version'
                res = await u.get_followings(pn=page, ps=page_size)
                if not res or 'list' not in res or not res['list']:
                    break
                    
                followings_list = res['list']
                all_followings.extend(followings_list)
                
                total = res.get('total', 0)
                if len(all_followings) >= total:
                    break
                
                page += 1
                if page > 100: 
                    break

            # 增强逻辑：获取分组信息并关联
            try:
                groups_api = Api("https://api.bilibili.com/x/relation/tags", method="GET", credential=cred)
                groups = await groups_api.result
                
                if groups:
                    uid_tags_map = {}
                    
                    for g in groups:
                        tag_name = g.get('name')
                        tag_id = g.get('tagid')
                        count = g.get('count', 0)
                        
                        if not count or count == 0:
                            continue

                        # 获取该分组下的用户
                        g_page = 1
                        while True:
                            try:
                                group_users_api = Api("https://api.bilibili.com/x/relation/tag", method="GET", credential=cred)
                                group_users_api.update_params(mid=my_uid, tagid=tag_id, pn=g_page, ps=50)
                                g_res = await group_users_api.result
                                
                                if not g_res or not isinstance(g_res, list):
                                    break
                                
                                for gu in g_res:
                                    guid = gu.get('mid')
                                    if guid:
                                        if guid not in uid_tags_map:
                                            uid_tags_map[guid] = []
                                        uid_tags_map[guid].append(tag_name)
                                
                                if len(g_res) < 50:
                                    break
                                g_page += 1
                                if g_page > 50: # Safety limit
                                    break
                                    
                                # Small delay to be nice to API
                                import asyncio
                                await asyncio.sleep(0.1)
                            except Exception as e:
                                print(f"Error fetching users for tag {tag_name}: {e}")
                                break
                    
                    # 将分组信息注入到 all_followings
                    for f in all_followings:
                        f_uid = f.get('mid')
                        if f_uid in uid_tags_map:
                            f['biliGroups'] = uid_tags_map[f_uid]
                            
            except Exception as e:
                # 分组获取失败不影响主流程，打印日志即可
                print(f"Error fetching groups info: {e}")
                
        # Format the result
        result = []
        for f in all_followings:
            # 统一字段处理
            # x/relation/tag 返回的字段可能略有不同，但通常也有 mid, uname, face 等
            uid = f.get('mid')
            uname = f.get('uname') or f.get('name') # tag api might use name? let's assume uname/mid are standard
            face = f.get('face')
            sign = f.get('sign', '')
            bili_groups = f.get('biliGroups', [])
            
            if uid and uname:
                result.append({
                    'uid': uid,
                    'name': uname,
                    'face': face,
                    'level': 0, 
                    'sign': sign,
                    'biliGroups': bili_groups
                })
            
        return {"status": "success", "type": "user_list", "data": result, "my_uid": my_uid}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_my_info(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
             return {"status": "error", "message": "未登录"}

        self_info = await user.get_self_info(credential=cred)
        return {"status": "success", "data": self_info}
    except Exception as e:
        # 只在非预期错误时打印traceback，已知的cookie无效错误不需要打印
        if str(e) != "'data'":
            import traceback
            traceback.print_exc()

        if str(e) == "'data'":
             return {"status": "error", "message": "Bilibili API format error (KeyError: 'data') - Cookie likely invalid"}
        return {"status": "error", "message": str(e)}

def _unwrap_bili_response(response, max_depth=5):
    """
    Recursively unwrap Bilibili API response to find the actual data list.
    Handles nested structures like {data: {data: [...]}}, {result: [...}}, etc.
    Returns the first list found, or empty list if none found.
    """
    if max_depth <= 0:
        return []

    if isinstance(response, list):
        return response

    if isinstance(response, dict):
        # Priority search keys (common Bilibili API patterns)
        for key in ['data', 'result', 'list', 'items']:
            if key in response:
                unwrapped = _unwrap_bili_response(response[key], max_depth - 1)
                if isinstance(unwrapped, list):
                    return unwrapped

        # If no priority key found, search all dict values
        for value in response.values():
            if isinstance(value, (list, dict)):
                unwrapped = _unwrap_bili_response(value, max_depth - 1)
                if isinstance(unwrapped, list) and unwrapped:
                    return unwrapped

    return []

async def get_follow_groups(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        try:
            groups_api = Api("https://api.bilibili.com/x/relation/tags", method="GET", credential=cred)
            groups_raw = await groups_api.result

            # Use deep unwrapping to handle various API response structures
            groups = _unwrap_bili_response(groups_raw)

            return {"status": "success", "data": groups}
        except Exception as e:
            return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_dynamic_feed(offset=None, group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        url = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all"
        params = {
            "type": "all",
            "page": 1,
            "timezone_offset": -480
        }
        if offset:
            params["offset"] = offset

        api = Api(url, method="GET", credential=cred)
        api.update_params(**params)
        data = await api.result
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_live_feed(group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        url = "https://api.live.bilibili.com/relation/v1/feed/feed_list"
        params = {
            "page": 1,
            "pagesize": 10
        }

        api = Api(url, method="GET", credential=cred)
        api.update_params(**params)
        data = await api.result
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Command dispatcher

# Server specific imports
from aiohttp import web
import logging
import argparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- Route Handlers ---

async def handle_video(request):
    try:
        data = await request.json()
        bvid = data.get('bvid')
        group_id = data.get('group_id')
        result = await get_video_info(bvid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in video handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

_MAX_STREAM_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 单流最大 2GB，防止异常响应耗尽磁盘


async def _download_stream_to_file(url: str, output_path: str) -> None:
    """分块下载单个流到文件"""
    headers = {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    timeout = aiohttp.ClientTimeout(total=600, connect=30, sock_read=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, headers=headers) as resp:
            resp.raise_for_status()
            total_written = 0
            with open(output_path, 'wb') as f:
                async for chunk in resp.content.iter_chunked(1024 * 1024):
                    total_written += len(chunk)
                    if total_written > _MAX_STREAM_FILE_SIZE:
                        raise RuntimeError(f'Stream file size exceeded {_MAX_STREAM_FILE_SIZE} bytes')
                    f.write(chunk)


async def download_video_file(bvid: str, page_index: int, resolution: str,
                               output_dir: str, group_id=None, video_meta=None) -> dict:
    """
    下载视频到本地文件，返回文件路径和元信息。
    使用 DASH 流时分别下载视频/音频再用 FFmpeg 合并。
    """
    from bilibili_api.video import VideoDownloadURLDataDetecter, VideoQuality, VideoCodecs

    quality_map = {
        '360p':  VideoQuality._360P,
        '480p':  VideoQuality._480P,
        '720p':  VideoQuality._720P,
        '1080p': VideoQuality._1080P,
        '1080p+': VideoQuality._1080P_PLUS,
    }
    target_quality = quality_map.get(resolution)
    if target_quality is None:
        logger.warning(f'[download_video_file] Unknown resolution "{resolution}", defaulting to 1080p')
        target_quality = VideoQuality._1080P

    v = video.Video(bvid=bvid, credential=load_credential(group_id))

    if video_meta:
        # 使用 Node 侧传入的元信息，跳过 API 调用
        title = video_meta.get('title', bvid)
        owner = video_meta.get('owner', 'Unknown')
        duration = video_meta.get('duration', 0)
        total_pages = video_meta.get('total_pages', 1)
    else:
        # fallback：自行拉取（兼容其他调用方）
        info = await v.get_info()
        title = info.get('title', bvid)
        owner = info.get('owner', {}).get('name', 'Unknown')
        duration = info.get('duration', 0)
        pages = info.get('pages', [])
        total_pages = len(pages) if pages else 1

    download_data = await v.get_download_url(page_index=page_index)
    detector = VideoDownloadURLDataDetecter(download_data)
    try:
        # 传入编码优先级：优先 AVC，其次 HEV，最后 AV1
        streams = detector.detect_best_streams(
            video_max_quality=target_quality,
            codecs=[VideoCodecs.AVC, VideoCodecs.HEV, VideoCodecs.AV1],
        )
    except TypeError as e:
        # 兼容旧版签名：不支持 codecs 参数
        if 'codecs' not in str(e):
            raise
        logger.warning('[download_video_file] detect_best_streams does not support codecs, falling back')
        streams = detector.detect_best_streams(video_max_quality=target_quality)

    if not streams:
        return {'status': 'error', 'message': 'no_streams_available'}

    # 路径安全验证（使用模块级 DOWNLOADS_ALLOWED_BASE，防止路径遍历）
    resolved_dir = os.path.realpath(output_dir)
    if resolved_dir != DOWNLOADS_ALLOWED_BASE and not resolved_dir.startswith(DOWNLOADS_ALLOWED_BASE + os.sep):
        return {'status': 'error', 'message': 'invalid output_dir'}
    os.makedirs(resolved_dir, exist_ok=True)
    timestamp = int(time.time())
    safe_bvid = re.sub(r'[^a-zA-Z0-9_-]', '_', bvid)
    safe_group = re.sub(r'[^a-zA-Z0-9_-]', '_', str(group_id or 'default'))
    rand_suffix = secrets.token_hex(4)
    output_path = os.path.join(resolved_dir, f'{safe_bvid}_{safe_group}_{timestamp}_{rand_suffix}.mp4')

    if len(streams) == 1:
        # 单流：先下载，再尝试重封装为 faststart MP4；失败时回退原始文件
        single_tmp = output_path + '_s.tmp'
        await _download_stream_to_file(streams[0].url, single_tmp)
        proc = None
        remux_ok = False
        try:
            proc = await asyncio.create_subprocess_exec(
                'ffmpeg', '-y', '-i', single_tmp,
                '-c', 'copy', '-movflags', '+faststart', output_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
            except asyncio.TimeoutError:
                proc.kill()
                raise RuntimeError('FFmpeg timeout after 300s')
            if proc.returncode != 0:
                raise RuntimeError(f'FFmpeg failed: {stderr.decode()[-500:]}')
            remux_ok = True
        except Exception as e:
            logger.warning(f'[download_video_file] Single stream remux failed, fallback raw stream: {e}')
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except Exception:
                pass
            os.replace(single_tmp, output_path)
        finally:
            # 确保 FFmpeg 进程被终止（防止 asyncio cancel 导致孤儿进程）
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            if remux_ok:
                try:
                    if os.path.exists(single_tmp):
                        os.remove(single_tmp)
                except Exception:
                    pass
    else:
        # DASH：并发下载视频流和音频流，再合并
        video_tmp = output_path + '_v.tmp'
        audio_tmp = output_path + '_a.tmp'
        proc = None
        try:
            await asyncio.gather(
                _download_stream_to_file(streams[0].url, video_tmp),
                _download_stream_to_file(streams[1].url, audio_tmp),
            )
            proc = await asyncio.create_subprocess_exec(
                'ffmpeg', '-y', '-i', video_tmp, '-i', audio_tmp,
                '-c', 'copy', '-movflags', '+faststart', output_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
            except asyncio.TimeoutError:
                proc.kill()
                raise RuntimeError('FFmpeg timeout after 300s')
            if proc.returncode != 0:
                raise RuntimeError(f'FFmpeg failed: {stderr.decode()[-500:]}')
        finally:
            # 确保 FFmpeg 进程被终止（防止 asyncio cancel 导致孤儿进程）
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            for tmp in [video_tmp, audio_tmp]:
                try:
                    if os.path.exists(tmp):
                        os.remove(tmp)
                except Exception:
                    pass

    return {
        'status': 'success',
        'file_path': output_path,
        'title': title,
        'owner': owner,
        'duration': duration,
        'total_pages': total_pages,
        'page_index': page_index,
    }


async def handle_video_download(request):
    try:
        data = await request.json()
        bvid = data.get('bvid', '').strip()
        try:
            page_index = int(data.get('page_index', 0))
            if page_index < 0:
                raise ValueError()
        except (ValueError, TypeError):
            return web.json_response({'status': 'error', 'message': 'invalid page_index'}, status=400)
        resolution = data.get('resolution', '1080p')
        # output_dir 固定使用模块级 DOWNLOADS_ALLOWED_BASE，不接受外部传入
        group_id = data.get('group_id')
        video_meta = data.get('video_meta')

        if not bvid:
            return web.json_response({'status': 'error', 'message': 'bvid is required'}, status=400)

        VALID_RESOLUTIONS = {'360p', '480p', '720p', '1080p', '1080p+'}
        if resolution not in VALID_RESOLUTIONS:
            return web.json_response({'status': 'error', 'message': 'invalid resolution'}, status=400)

        try:
            result = await asyncio.wait_for(
                download_video_file(bvid, page_index, resolution, DOWNLOADS_ALLOWED_BASE, group_id, video_meta),
                timeout=270  # 略低于 Node 侧 300s 超时，确保 Python 先返回错误
            )
        except asyncio.TimeoutError:
            logger.error(f'[handle_video_download] Timeout after 270s for {bvid}')
            return web.json_response({'status': 'error', 'message': 'download_timeout'})

        return web.json_response(result)
    except Exception as e:
        import traceback
        logger.error(f'[handle_video_download] Error: {e}\n{traceback.format_exc()}')
        return web.json_response({'status': 'error', 'message': str(e)}, status=500)


async def handle_bangumi(request):
    try:
        data = await request.json()
        season_id = data.get('season_id')
        group_id = data.get('group_id')
        result = await get_bangumi_info(season_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in bangumi handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_article(request):
    try:
        data = await request.json()
        cvid = data.get('cvid')
        group_id = data.get('group_id')
        result = await get_article_info(cvid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in article handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_live_room(request):
    try:
        data = await request.json()
        room_id = data.get('room_id')
        group_id = data.get('group_id')
        result = await get_live_room_info(room_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in live_room handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_login_url(request):
    try:
        result = await get_login_url()
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in login_url handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_login_check(request):
    try:
        data = await request.json()
        key = data.get('key')
        group_id = data.get('group_id')
        result = await poll_login(key, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in login_check handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_dynamic(request):
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')
        result = await get_user_dynamic(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_dynamic handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_live(request):
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')
        result = await get_user_live(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_live handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_videos(request):
    """HTTP处理器：获取用户视频列表"""
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')

        if not uid:
            return web.json_response({
                "status": "error",
                "message": "缺少参数: uid"
            })

        result = await get_user_videos(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_videos handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_articles(request):
    """HTTP处理器：获取用户专栏列表"""
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')

        if not uid:
            return web.json_response({
                "status": "error",
                "message": "缺少参数: uid"
            })

        result = await get_user_articles(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_articles handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_dynamic_detail(request):
    try:
        data = await request.json()
        # Mapped from 'did' in CLI
        dynamic_id = data.get('dynamic_id')
        group_id = data.get('group_id')
        result = await get_dynamic_detail(dynamic_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in dynamic_detail handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_opus(request):
    try:
        data = await request.json()
        # Mapped from 'did' in CLI (opus_id)
        opus_id = data.get('opus_id')
        group_id = data.get('group_id')
        result = await get_opus_detail(opus_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in opus handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_ep(request):
    try:
        data = await request.json()
        ep_id = data.get('ep_id')
        group_id = data.get('group_id')
        result = await get_ep_info(ep_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in ep handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_media(request):
    try:
        data = await request.json()
        media_id = data.get('media_id')
        group_id = data.get('group_id')
        result = await get_media_info(media_id, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in media handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_info(request):
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')
        result = await get_user_info(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_info handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_user_card(request):
    try:
        data = await request.json()
        uid = data.get('uid')
        group_id = data.get('group_id')
        result = await get_user_card(uid, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in user_card handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_my_followings(request):
    try:
        data = await request.json()
        group_name = data.get('group_name')
        if group_name == "None" or group_name == "":
            group_name = None
        group_id = data.get('group_id')
        result = await get_my_followings(group_name, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in my_followings handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_my_info(request):
    try:
        data = await request.json()
        group_id = data.get('group_id')
        result = await get_my_info(group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in my_info handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_get_follow_groups(request):
    try:
        data = await request.json()
        group_id = data.get('group_id')
        result = await get_follow_groups(group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in get_follow_groups handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_dynamic_feed(request):
    try:
        data = await request.json()
        offset = data.get('offset')
        group_id = data.get('group_id')
        result = await get_dynamic_feed(offset, group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in dynamic_feed handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def handle_live_feed(request):
    try:
        data = await request.json()
        group_id = data.get('group_id')
        result = await get_live_feed(group_id)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error in live_feed handler: {e}")
        return web.json_response({"status": "error", "message": str(e)})

async def health_check(request):
    return web.json_response({"status": "ok"})

# --- Application Setup ---

async def on_startup(app):
    logger.info("Application starting up...")
    # Place to initialize global sessions if needed
    pass

async def handle_credential_info(request):
    """
    获取Cookie对应的用户信息

    Request Body:
        {
            "group_id": "123456" (可选，用于测试特定群组Cookie)
        }

    Response:
        {
            "status": "success",
            "data": {
                "uid": 123456,
                "username": "用户名",
                "is_logged_in": true,
                "timestamp": 1706428800
            }
        }
    """
    try:
        data = await request.json()
        group_id = data.get('group_id')

        # 加载凭证
        credential = load_credential(group_id)
        if not credential:
            return web.json_response({
                'status': 'error',
                'message': 'No credential found'
            })
        credential = await ensure_buvid3(credential, group_id)

        info = await user.get_self_info(credential=credential)

        return web.json_response({
            'status': 'success',
            'data': {
                'uid': info['mid'],
                'username': info['name'],
                'is_logged_in': True,
                'timestamp': int(time.time())
            }
        })
    except Exception as e:
        logger.error(f"获取凭证信息失败: {e}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            'status': 'error',
            'message': str(e)
        })

async def handle_refresh_credential(request):
    result = await refresh_credential_if_needed()
    return web.json_response(result)

async def on_cleanup(app):
    logger.info("Application shutting down...")
    # Place to close global sessions if needed
    pass

def create_app():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    
    # Register routes
    app.add_routes([
        web.post('/video', handle_video),
        web.post('/bangumi', handle_bangumi),
        web.post('/article', handle_article),
        web.post('/live_room', handle_live_room),
        web.post('/login_url', handle_login_url),
        web.post('/login_check', handle_login_check),
        web.post('/user_dynamic', handle_user_dynamic),
        web.post('/user_live', handle_user_live),
        web.post('/user_videos', handle_user_videos),
        web.post('/user_articles', handle_user_articles),
        web.post('/dynamic_detail', handle_dynamic_detail),
        web.post('/opus', handle_opus),
        web.post('/ep', handle_ep),
        web.post('/media', handle_media),
        web.post('/user_info', handle_user_info),
        web.post('/user_card', handle_user_card),
        web.post('/my_followings', handle_my_followings),
        web.post('/my_info', handle_my_info),
        web.post('/get_follow_groups', handle_get_follow_groups),
        web.post('/dynamic_feed', handle_dynamic_feed),
        web.post('/live_feed', handle_live_feed),
        web.post('/credential_info', handle_credential_info),
        web.post('/refresh_credential', handle_refresh_credential),
        web.post('/video_download', handle_video_download),
        web.get('/health', health_check),
    ])
    return app

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bili Service Server")
    parser.add_argument("--port", type=int, default=10001, help="Port to run the server on")
    args = parser.parse_args()

    app = create_app()
    logger.info(f"Starting server on 127.0.0.1:{args.port}")
    web.run_app(app, host='127.0.0.1', port=args.port)
