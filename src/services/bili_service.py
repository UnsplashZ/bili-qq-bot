import sys
import json
import asyncio
import re
import aiohttp
from bs4 import BeautifulSoup
from bilibili_api import video, bangumi, user, article, live, dynamic, show, topic, opus, Credential
from bilibili_api.utils.network import Api
import bilibili_api.login_v2 as login
import io
from PIL import Image
import colorsys

# Load credentials from a file if they exist
CREDENTIAL_FILE = 'data/cookies.json'

def load_credential():
    try:
        with open(CREDENTIAL_FILE, 'r') as f:
            data = json.load(f)
            return Credential(sessdata=data.get('SESSDATA'), bili_jct=data.get('BILI_JCT'), buvid3=data.get('BUVID3'))
    except FileNotFoundError:
        return None

def save_credential(credential):
    with open(CREDENTIAL_FILE, 'w') as f:
        json.dump({
            'SESSDATA': credential.sessdata,
            'BILI_JCT': credential.bili_jct,
            'BUVID3': credential.buvid3
        }, f)

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

async def get_video_info(bvid):
    try:
        if str(bvid).lower().startswith('av'):
            aid = int(str(bvid)[2:])
            v = video.Video(aid=aid, credential=load_credential())
        else:
            v = video.Video(bvid=bvid, credential=load_credential())
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
        return {"status": "error", "message": str(e)}

async def get_bangumi_info(season_id):
    try:
        # 使用ssid参数初始化Bangumi类，这对某些番剧是必需的
        b = bangumi.Bangumi(ssid=int(season_id), credential=load_credential())

        # 首先使用season_id获取meta信息，以获取media_id
        try:
            meta = await b.get_meta()
            media_id = meta.get('media', {}).get('media_id')

            if media_id:
                # 如果获取到media_id，使用它创建新的Bangumi实例来获取详细信息
                b_with_media = bangumi.Bangumi(media_id=int(media_id), credential=load_credential())

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

async def get_opus_detail(opus_id):
    try:
        o = opus.Opus(int(opus_id), credential=load_credential())
        if await o.is_article():
            result = await get_article_info(opus_id)
            if result.get('status') == 'success':
                return result
            # If article fetch fails (e.g. 404), fallback to dynamic detail
            
        return await get_dynamic_detail(opus_id)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_article_info(cvid):
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
        a = article.Article(cvid_int, credential=load_credential())
        info = await a.get_info()

        # 获取作者信息（头像等）
        author_mid = info.get('mid')
        author_face = None
        if author_mid:
            try:
                u = user.User(uid=int(author_mid), credential=load_credential())
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
                                return await get_opus_detail(opus_id)

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

async def get_live_room_info(room_id):
    try:
        l = live.LiveRoom(int(room_id), credential=load_credential())
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
        # 使用 QrCodeLogin 类获取二维码
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        await q.generate_qrcode()
        return {"status": "success", "data": {
            "url": q._QrCodeLogin__qr_link, 
            "key": q._QrCodeLogin__qr_key
        }}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def poll_login(qrcode_key):
    try:
        # 实例化并手动设置 key 以支持轮询
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        q._QrCodeLogin__qr_key = qrcode_key
        
        event = await q.check_state()
        
        if event == login.QrCodeLoginEvents.DONE:
            credential = q.get_credential()
            save_credential(credential)
            return {"status": "success", "message": "登录成功"}
        elif event == login.QrCodeLoginEvents.SCAN:
            return {"status": "pending", "code": 86101, "message": "等待扫码"}
        elif event == login.QrCodeLoginEvents.CONF:
            return {"status": "pending", "code": 86090, "message": "已扫码，请在手机上确认"}
        elif event == login.QrCodeLoginEvents.TIMEOUT:
            return {"status": "error", "code": 86038, "message": "二维码已过期"}
        else:
            return {"status": "error", "message": "未知状态"}
            
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_user_dynamic(uid):
    try:
        u = user.User(uid=int(uid), credential=load_credential())
        # 使用新的 get_dynamics_new 接口
        dynamics = await u.get_dynamics_new(offset="")
        if dynamics and 'items' in dynamics and len(dynamics['items']) > 0:
            latest = None
            max_ts = -1
            
            # Check top 5 items to find the latest by timestamp (handling pinned posts)
            for item in dynamics['items'][:5]:
                ts = 0
                try:
                    if 'modules' in item and 'module_author' in item['modules']:
                        ts = int(item['modules']['module_author'].get('pub_ts', 0))
                except:
                    pass
                
                if ts > max_ts:
                    max_ts = ts
                    latest = item

            if not latest and len(dynamics['items']) > 0:
                latest = dynamics['items'][0]

            if not latest:
                 return {"status": "success", "data": None}
            
            # 获取发布时间 (pub_time)
            # 不同的动态类型，时间字段位置可能不同，通常在 modules.module_author.pub_ts
            pub_ts = 0
            if 'modules' in latest and 'module_author' in latest['modules']:
                pub_ts = latest['modules']['module_author'].get('pub_ts', 0)
            
            # 获取作者扩展信息：等级、头像框、动态卡片（若可用）
            author_level = 0
            pendant_url = None
            card_url = None
            decoration_card = None
            card_number = None
            fan_color = None  # 初始化 fan_color
            try:
                info = await u.get_user_info()
                author_level = info.get('level', 0)
            except:
                author_level = 0
            try:
                profile = await u.get_user_profile()
                # 头像挂件/头像框
                # 常见结构：profile['pendant']['image'] 或 profile['decorate']['pendant']['image']
                pendant_url = (
                    (profile.get('pendant') or {}).get('image') or
                    ((profile.get('decorate') or {}).get('pendant') or {}).get('image')
                )
                # 动态卡片（购买的装扮卡片）
                # 常见结构：profile['decorate']['card_url'] 或 profile['decorate_card']['image']
                card_url = (
                    (profile.get('decorate') or {}).get('card_url') or
                    (profile.get('decorate_card') or {}).get('image')
                )
            except:
                pass
            # 从动态本身的作者模块尝试补充头像框
            try:
                ma = (latest.get('modules') or {}).get('module_author') or {}
                pendant_url = pendant_url or ((ma.get('pendant') or {}).get('image'))
                if 'decoration_card' in ma and ma['decoration_card']:
                    decoration_card = ma['decoration_card']
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
                author_face_url = ma.get('face') or (latest.get('author') or {}).get('face') or ''
                avatar_focus_color = await get_image_focus_color(author_face_url) if author_face_url else None
            except:
                avatar_focus_color = None
            
            return {"status": "success", "data": {
                "id": latest.get('id_str'),
                "type": latest.get('type'),
                "modules": latest.get('modules'),
                "orig": latest.get('orig'), # 转发动态的原始内容
                "pub_ts": pub_ts,  # 新增发布时间戳
                "author": {
                    "level": author_level,
                    "pendant_url": pendant_url,
                    "card_url": card_url,
                    "decoration_card": decoration_card,
                    "card_number": card_number,
                    "card_focus_color": card_focus_color,
                    "fan_color": fan_color,
                    "avatar_focus_color": avatar_focus_color
                }
            }}
        return {"status": "success", "data": None}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def get_user_live(uid):
    try:
        u = user.User(uid=int(uid), credential=load_credential())
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

async def get_dynamic_detail(dynamic_id):
    try:
        d = dynamic.Dynamic(int(dynamic_id), credential=load_credential())
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
                    return await get_opus_detail(opus_id)

            return {"status": "error", "message": f"动态 {dynamic_id} 的数据结构异常，可能已被删除"}

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
                u = user.User(uid=int(author_uid), credential=load_credential())
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
                vv = vote_api.Vote(vote_id=int(vote_id), credential=load_credential())
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
        return {"status": "success", "type": "dynamic", "data": info}
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        return {"status": "error", "message": str(e), "detail": error_detail}

async def get_ep_info(ep_id):
    try:
        # 使用Episode类获取EP信息
        ep = bangumi.Episode(int(ep_id), credential=load_credential())
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

async def get_media_info(media_id):
    try:
        # 使用media_id获取番剧信息
        b = bangumi.Bangumi(media_id=int(media_id), credential=load_credential())

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

async def get_user_card(uid):
    try:
        u = user.User(uid=int(uid), credential=load_credential())
        user_info = await u.get_user_info()
        data = {
            "uid": user_info.get('mid', uid),
            "name": user_info.get('name', ''),
            "face": user_info.get('face', '')
        }
        return {"status": "success", "type": "user_card", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_user_info(uid):
    try:
        u = user.User(uid=int(uid), credential=load_credential())

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
            "focus": {
                "avatar": await get_image_focus_color(user_info.get('face', ''))
            }
        }

        return {"status": "success", "type": "user", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_my_followings(group_name=None):
    try:
        cred = load_credential()
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
                
                # The structure of x/relation/tag result is a list of users directly
                # It doesn't seem to have 'total' field in the root usually?
                # Actually standard pagination usually needs total.
                # But 'res' IS the list of users according to my test script output structure (Users in group: [])
                # Wait, my test script printed: "Users in group: []"
                # If there were users, it would be a list of dicts.
                
                if isinstance(res, list):
                    current_list = res
                    if not current_list:
                        break
                    all_followings.extend(current_list)
                    
                    # If we got fewer items than page_size, we are done
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
                
        # Format the result
        result = []
        for f in all_followings:
            # 统一字段处理
            # x/relation/tag 返回的字段可能略有不同，但通常也有 mid, uname, face 等
            uid = f.get('mid')
            uname = f.get('uname') or f.get('name') # tag api might use name? let's assume uname/mid are standard
            face = f.get('face')
            sign = f.get('sign', '')
            
            if uid and uname:
                result.append({
                    'uid': uid,
                    'name': uname,
                    'face': face,
                    'level': 0, 
                    'sign': sign
                })
            
        return {"status": "success", "type": "user_list", "data": result}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

# Command dispatcher
async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No command provided"}))
        return

    command = sys.argv[1]
    
    if command == "video":
        bvid = sys.argv[2]
        result = await get_video_info(bvid)
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "bangumi":
        season_id = sys.argv[2]
        result = await get_bangumi_info(season_id)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "article":
        cvid = sys.argv[2]
        result = await get_article_info(cvid)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "live_room":
        room_id = sys.argv[2]
        result = await get_live_room_info(room_id)
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "login_url":
        result = await get_login_url()
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "login_check":
        key = sys.argv[2]
        result = await poll_login(key)
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "user_dynamic":
        uid = sys.argv[2]
        result = await get_user_dynamic(uid)
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "user_live":
        uid = sys.argv[2]
        result = await get_user_live(uid)
        print(json.dumps(result, ensure_ascii=False))
        
    elif command == "dynamic_detail":
        did = sys.argv[2]
        result = await get_dynamic_detail(did)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "opus":
        did = sys.argv[2]
        result = await get_opus_detail(did)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "ep":
        ep_id = sys.argv[2]
        result = await get_ep_info(ep_id)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "media":
        media_id = sys.argv[2]
        result = await get_media_info(media_id)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "user_info":
        uid = sys.argv[2]
        result = await get_user_info(uid)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "user_card":
        uid = sys.argv[2]
        result = await get_user_card(uid)
        print(json.dumps(result, ensure_ascii=False))

    elif command == "my_followings":
        group_name = None
        if len(sys.argv) > 2:
            group_name = sys.argv[2]
        result = await get_my_followings(group_name)
        print(json.dumps(result, ensure_ascii=False))

    else:
        print(json.dumps({"status": "error", "message": "Unknown command"}))

if __name__ == "__main__":
    asyncio.run(main())
