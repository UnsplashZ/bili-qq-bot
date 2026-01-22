from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Union
import uvicorn
import sys
import os

# Add current directory to path to ensure imports work if run directly
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import existing functions from bili_service
from bili_service import (
    check_cookie, 
    get_following_groups,
    get_video_info,
    get_user_dynamic,
    get_user_live,
    get_bangumi_info,
    get_dynamic_detail,
    get_my_followings,
    get_article_info,
    get_live_room_info,
    get_opus_detail,
    get_user_info,
    get_user_card,
    get_ep_info,
    get_media_info,
    get_login_url,
    poll_login
)

app = FastAPI(title="Bilibili API Service")

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Data Models
class CheckCookieRequest(BaseModel):
    group_id: Optional[str] = None

class FollowingGroupsRequest(BaseModel):
    group_id: Optional[str] = None

class VideoRequest(BaseModel):
    bvid: str
    group_id: Optional[str] = None

class UserRequest(BaseModel):
    uid: int
    group_id: Optional[str] = None

class BangumiRequest(BaseModel):
    season_id: int
    group_id: Optional[str] = None

class DynamicDetailRequest(BaseModel):
    dynamic_id: int
    group_id: Optional[str] = None

class ArticleRequest(BaseModel):
    cvid: int
    group_id: Optional[str] = None

class LiveRoomRequest(BaseModel):
    room_id: int
    group_id: Optional[str] = None

class OpusRequest(BaseModel):
    opus_id: int
    group_id: Optional[str] = None

class EpRequest(BaseModel):
    ep_id: int
    group_id: Optional[str] = None

class MediaRequest(BaseModel):
    media_id: int
    group_id: Optional[str] = None

class MyFollowingsRequest(BaseModel):
    group_name: Optional[str] = None
    group_id: Optional[str] = None

class PollLoginRequest(BaseModel):
    qrcode_key: str
    group_id: Optional[str] = None

# API Endpoints

@app.post("/api/check_cookie")
async def api_check_cookie(req: CheckCookieRequest):
    result = await check_cookie(req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/following_groups")
async def api_following_groups(req: FollowingGroupsRequest):
    result = await get_following_groups(req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/video")
async def api_video(req: VideoRequest):
    result = await get_video_info(req.bvid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/user_dynamic")
async def api_user_dynamic(req: UserRequest):
    result = await get_user_dynamic(req.uid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/user_live")
async def api_user_live(req: UserRequest):
    result = await get_user_live(req.uid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/bangumi")
async def api_bangumi(req: BangumiRequest):
    result = await get_bangumi_info(req.season_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/dynamic_detail")
async def api_dynamic_detail(req: DynamicDetailRequest):
    result = await get_dynamic_detail(req.dynamic_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/article")
async def api_article(req: ArticleRequest):
    result = await get_article_info(req.cvid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/live_room")
async def api_live_room(req: LiveRoomRequest):
    result = await get_live_room_info(req.room_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/login_url")
async def api_login_url():
    result = await get_login_url()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/login_check")
async def api_login_check(req: PollLoginRequest):
    result = await poll_login(req.qrcode_key, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/opus")
async def api_opus(req: OpusRequest):
    result = await get_opus_detail(req.opus_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/user_info")
async def api_user_info(req: UserRequest):
    result = await get_user_info(req.uid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/user_card")
async def api_user_card(req: UserRequest):
    result = await get_user_card(req.uid, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/ep")
async def api_ep(req: EpRequest):
    result = await get_ep_info(req.ep_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/media")
async def api_media(req: MediaRequest):
    result = await get_media_info(req.media_id, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

@app.post("/api/my_followings")
async def api_my_followings(req: MyFollowingsRequest):
    result = await get_my_followings(req.group_name, req.group_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Unknown error"))
    return result

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
