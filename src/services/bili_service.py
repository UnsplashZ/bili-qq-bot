import sys
import json
import asyncio
import re
import aiohttp
from bs4 import BeautifulSoup
from bilibili_api import video, bangumi, user, article, live, dynamic, show, topic, Credential
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
            if s < 0.38:
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
        v = video.Video(bvid=bvid, credential=load_credential())
        info = await v.get_info()
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
            "detail": detail
        }

        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_article_info(cvid):
    try:
        cvid_int = int(cvid.replace('cv', ''))
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
        try:
            content = await a.fetch_content()
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
                        if resp.status == 200:
                            html = await resp.text()
                            soup = BeautifulSoup(html, 'html.parser')
                            # Try specific holders first
                            holder = soup.find(class_='article-holder') or soup.find(id='read-article-holder')
                            if holder:
                                summary = holder.get_text(separator='\n', strip=True)
                            else:
                                # Fallback to body text, removing scripts/styles
                                for script in soup(["script", "style"]):
                                    script.extract()
                                summary = soup.get_text(separator='\n', strip=True)
            except Exception as e:
                summary = f"无法抓取正文: {str(e)}"

        info['summary'] = summary[:2500] if summary else '点击查看详情'
        info['author_face'] = author_face  # 添加作者头像

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
            latest = dynamics['items'][0]
            
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
            try:
                src = card_url or ((decoration_card or {}).get('card_url'))
                card_focus_color = await get_image_focus_color(src) if src else None
            except:
                card_focus_color = None
            
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
                    "fan_color": fan_color
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

        modules = (info.get('item') or {}).get('modules') or info.get('modules') or {}

        # 检查modules是否为空
        if not modules:
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
        try:
            src = card_url or ((decoration_card or {}).get('card_url'))
            card_focus_color = await get_image_focus_color(src) if src else None
        except:
            card_focus_color = None

        author_obj = {
            "level": author_level,
            "pendant_url": pendant_url,
            "card_url": card_url,
            "decoration_card": decoration_card,
            "card_number": card_number,
            "card_focus_color": card_focus_color,
            "fan_color": fan_color
        }
        info['author'] = author_obj
        try:
            if isinstance(info.get('item'), dict):
                info['item']['author'] = author_obj
        except:
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
            "detail": detail
        }
        return {"status": "success", "type": "bangumi", "data": data}
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
                latest_dynamic = dynamics['items'][0]
        except:
            pass

        # 组合信息
        data = {
            "uid": user_info.get('mid', uid),
            "name": user_info.get('name', ''),
            "level": user_info.get('level', 0),
            "face": user_info.get('face', ''),
            "sign": user_info.get('sign', ''),
            "vip": user_info.get('vip', {}),
            "fans_medal": user_info.get('fans_medal', {}),
            "relation": relation,
            "likes": likes,
            "archive_view": archive_view,
            "dynamic": latest_dynamic
        }

        return {"status": "success", "type": "user", "data": data}
    except Exception as e:
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
        
    elif command == "dynamic_detail" or command == "opus":
        did = sys.argv[2]
        result = await get_dynamic_detail(did)
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



    else:
        print(json.dumps({"status": "error", "message": "Unknown command"}))

if __name__ == "__main__":
    asyncio.run(main())
