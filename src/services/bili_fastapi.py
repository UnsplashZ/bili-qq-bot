from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn

# Import existing functions from bili_service
from bili_service import check_cookie, get_following_groups

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

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
