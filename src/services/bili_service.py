import sys
import json
import asyncio
from bilibili_api import video, bangumi, user, Credential
import bilibili_api.login as login

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
        b = bangumi.Bangumi(season_id=int(season_id), credential=load_credential())
        info = await b.get_info()
        return {"status": "success", "type": "bangumi", "data": info}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_login_url():
    try:
        # Generate QR Code info
        # returns (url, qrcode_key)
        url, qrcode_key = login.get_qrcode_url()
        return {"status": "success", "data": {"url": url, "key": qrcode_key}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def poll_login(qrcode_key):
    try:
        # Check status
        # returns (status_code, cookies_or_url)
        # status_code: 0=success, 86101=unscanned, 86090=scanned but not confirmed, 86038=expired
        status, data = await login.login_with_key(qrcode_key)
        
        if status == 0:
            # Success, data is credential object or cookies dict depending on version
            # In recent versions, login_with_key returns Credential object on success if used directly?
            # Actually checking docs/source is best. 
            # Assuming 'data' is the credential object or we can construct it.
            # If it returns cookies dict:
            if isinstance(data, dict):
                credential = Credential(sessdata=data['SESSDATA'], bili_jct=data['bili_jct'], buvid3=data['buvid3'])
            else:
                credential = data
            
            save_credential(credential)
            return {"status": "success", "message": "Login successful"}
        else:
            return {"status": "pending", "code": status, "message": "Waiting for scan or confirmation"}
            
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
        # Note: Dynamic API usage might vary. 
        # Using a general method to fetch detail if available, or just use the ID if we can't easily get single detail without context.
        # But 'get_dynamic_detail' is usually what we want.
        # Actually bilibili_api 15+ has 'dynamic' module.
        from bilibili_api import dynamic
        # d = dynamic.Dynamic(dynamic_id) # This might be for operations.
        # To get info, we might need to search or use specific API.
        # Let's try constructing a Dynamic object and getting info if method exists.
        # If not, we can use 'user.get_dynamics' filtering, but that's inefficient.
        # Let's assume we can just return basic info or use the 'get_dynamic_detail' if available in library.
        # Checking docs... 'bilibili_api.dynamic.get_general_dynamic_info' might be it? 
        # Or 'Dynamic(id).get_info()'?
        
        # Let's try:
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

    else:
        print(json.dumps({"status": "error", "message": "Unknown command"}))

if __name__ == "__main__":
    asyncio.run(main())
