import sys
import json
import asyncio
import re
import aiohttp
from bs4 import BeautifulSoup
from bilibili_api import video, bangumi, user, article, live, dynamic, Credential
import bilibili_api.login_v2 as login

# Load credentials from a file if they exist
CREDENTIAL_FILE = 'cookies.json'

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

async def get_video_info(bvid):
    try:
        v = video.Video(bvid=bvid, credential=load_credential())
        info = await v.get_info()
        return {"status": "success", "type": "video", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_bangumi_info(season_id):
    try:
        b = bangumi.Bangumi(int(season_id), credential=load_credential())
        # overview contains the summary (evaluate) and basic info
        info = await b.get_overview()
        # Explicitly get stats to ensure accuracy (e.g. follow count)
        stat = await b.get_stat()
        
        data = {
            "title": info.get('title'),
            "cover": info.get('cover'),
            "desc": info.get('evaluate'),
            "stat": stat, # Use the explicitly fetched stat
            "new_ep": info.get('new_ep'),
            "rating": info.get('rating')
        }
        return {"status": "success", "type": "bangumi", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_article_info(cvid):
    try:
        cvid_int = int(cvid.replace('cv', ''))
        a = article.Article(cvid_int, credential=load_credential())
        info = await a.get_info()
        
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
        # get_dynamics(offset=0) returns a dict with 'items' list
        dynamics = await u.get_dynamics(offset=0)
        if dynamics and 'items' in dynamics and len(dynamics['items']) > 0:
            latest = dynamics['items'][0]
            return {"status": "success", "data": {
                "id": latest.get('id_str'),
                "type": latest.get('type'),
                "modules": latest.get('modules') # Contains text, pics etc in new dynamic API
            }}
        return {"status": "success", "data": None}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_user_live(uid):
    try:
        u = user.User(uid=int(uid), credential=load_credential())
        live_info = await u.get_live_info()
        return {"status": "success", "data": live_info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_dynamic_detail(dynamic_id):
    try:
        d = dynamic.Dynamic(int(dynamic_id), credential=load_credential())
        info = await d.get_info()
        return {"status": "success", "type": "dynamic", "data": info}
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

    else:
        print(json.dumps({"status": "error", "message": "Unknown command"}))

if __name__ == "__main__":
    asyncio.run(main())
