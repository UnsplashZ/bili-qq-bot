import asyncio

from bilibili_api import user
from bilibili_api.utils.network import Api

from ..auth.credential_store import load_credential


async def get_my_followings(group_name=None, group_id=None):
    try:
        cred = load_credential(group_id)
        if not cred:
            return {"status": "error", "message": "未登录，请先配置 cookies.json"}

        self_info = await user.get_self_info(credential=cred)
        my_uid = self_info["mid"]
        u = user.User(uid=my_uid, credential=cred)

        all_followings = []
        page = 1
        page_size = 50

        if group_name:
            try:
                groups_api = Api(
                    "https://api.bilibili.com/x/relation/tags",
                    method="GET",
                    credential=cred,
                )
                groups = await groups_api.result
            except Exception as e:
                return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}

            target_group = None
            if groups:
                for g in groups:
                    if g.get("name") == group_name:
                        target_group = g
                        break

            if not target_group:
                return {"status": "error", "message": f"未找到名为 '{group_name}' 的分组"}

            tagid = target_group["tagid"]

            while True:
                try:
                    group_users_api = Api(
                        "https://api.bilibili.com/x/relation/tag",
                        method="GET",
                        credential=cred,
                    )
                    group_users_api.update_params(
                        mid=my_uid, tagid=tagid, pn=page, ps=page_size
                    )
                    res = await group_users_api.result
                except Exception as e:
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
            while True:
                res = await u.get_followings(pn=page, ps=page_size)
                if not res or "list" not in res or not res["list"]:
                    break

                followings_list = res["list"]
                all_followings.extend(followings_list)

                total = res.get("total", 0)
                if len(all_followings) >= total:
                    break

                page += 1
                if page > 100:
                    break

            try:
                groups_api = Api(
                    "https://api.bilibili.com/x/relation/tags",
                    method="GET",
                    credential=cred,
                )
                groups = await groups_api.result

                if groups:
                    uid_tags_map = {}

                    for g in groups:
                        tag_name = g.get("name")
                        tag_id = g.get("tagid")
                        count = g.get("count", 0)

                        if not count or count == 0:
                            continue

                        g_page = 1
                        while True:
                            try:
                                group_users_api = Api(
                                    "https://api.bilibili.com/x/relation/tag",
                                    method="GET",
                                    credential=cred,
                                )
                                group_users_api.update_params(
                                    mid=my_uid, tagid=tag_id, pn=g_page, ps=50
                                )
                                g_res = await group_users_api.result

                                if not g_res or not isinstance(g_res, list):
                                    break

                                for gu in g_res:
                                    guid = gu.get("mid")
                                    if guid:
                                        if guid not in uid_tags_map:
                                            uid_tags_map[guid] = []
                                        uid_tags_map[guid].append(tag_name)

                                if len(g_res) < 50:
                                    break
                                g_page += 1
                                if g_page > 50:
                                    break

                                await asyncio.sleep(0.1)
                            except Exception as e:
                                print(f"Error fetching users for tag {tag_name}: {e}")
                                break

                    for f in all_followings:
                        f_uid = f.get("mid")
                        if f_uid in uid_tags_map:
                            f["biliGroups"] = uid_tags_map[f_uid]

            except Exception as e:
                print(f"Error fetching groups info: {e}")

        result = []
        for f in all_followings:
            uid = f.get("mid")
            uname = f.get("uname") or f.get("name")
            face = f.get("face")
            sign = f.get("sign", "")
            bili_groups = f.get("biliGroups", [])

            if uid and uname:
                result.append(
                    {
                        "uid": uid,
                        "name": uname,
                        "face": face,
                        "level": 0,
                        "sign": sign,
                        "biliGroups": bili_groups,
                    }
                )

        return {
            "status": "success",
            "type": "user_list",
            "data": result,
            "my_uid": my_uid,
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        return {"status": "error", "message": str(e)}


def _unwrap_bili_response(response, max_depth=5):
    if max_depth <= 0:
        return []

    if isinstance(response, list):
        return response

    if isinstance(response, dict):
        for key in ["data", "result", "list", "items"]:
            if key in response:
                unwrapped = _unwrap_bili_response(response[key], max_depth - 1)
                if isinstance(unwrapped, list):
                    return unwrapped

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
            groups_api = Api(
                "https://api.bilibili.com/x/relation/tags",
                method="GET",
                credential=cred,
            )
            groups_raw = await groups_api.result
            groups = _unwrap_bili_response(groups_raw)
            return {"status": "success", "data": groups}
        except Exception as e:
            return {"status": "error", "message": f"获取分组列表失败: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

