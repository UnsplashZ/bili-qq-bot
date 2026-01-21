import os
import sys

# 1. Modify src/services/bili_service.py
bili_service_path = 'src/services/bili_service.py'
try:
    with open(bili_service_path, 'r') as f:
        content = f.read()

    new_function = '''
async def check_cookie(group_id=None):
    try:
        credential = load_credential(group_id)
        if not credential:
            return {"status": "success", "data": {"logged_in": False}}
        
        # Get self info to verify cookie
        info = await user.get_self_info(credential)
        return {
            "status": "success",
            "data": {
                "logged_in": True,
                "uid": info.get('mid'),
                "name": info.get('name'),
                "face": info.get('face')
            }
        }
    except Exception as e:
        return {
            "status": "success",
            "data": {
                "logged_in": False,
                "message": str(e)
            }
        }

'''

    new_command_handler = '''
    elif command == "check_cookie":
        group_id = sys.argv[2] if len(sys.argv) > 2 else None
        result = await check_cookie(group_id)
        print(json.dumps(result, ensure_ascii=False))

'''

    if 'async def check_cookie' not in content:
        # Insert function before main
        content = content.replace('async def main():', new_function + 'async def main():')
        
        # Insert handler before the final else
        target_else = '    else:\n        print(json.dumps({"status": "error", "message": "Unknown command"}))'
        if target_else in content:
            content = content.replace(target_else, new_command_handler + target_else)
        else:
            print(f"Warning: Could not find target else block in {bili_service_path}")
        
        with open(bili_service_path, 'w') as f:
            f.write(content)
        print(f"Updated {bili_service_path}")
    else:
        print(f"Skipped {bili_service_path} (already updated)")

except Exception as e:
    print(f"Error updating {bili_service_path}: {e}")

# 2. Modify src/services/biliApi.js
bili_api_path = 'src/services/biliApi.js'
try:
    with open(bili_api_path, 'r') as f:
        content = f.read()

    new_method = '''
    async getCredentialStatus(groupId) {
        const args = [];
        if (groupId) args.push(groupId);
        return this.runCommand('check_cookie', args);
    }
'''

    if 'getCredentialStatus' not in content:
        # Insert before the last closing brace of the class
        # We search for the last curly brace before module.exports
        
        # Find position of module.exports
        mod_exports_idx = content.rfind('module.exports')
        if mod_exports_idx != -1:
            # Search backwards for '}' from mod_exports_idx
            last_brace_idx = content.rfind('}', 0, mod_exports_idx)
            if last_brace_idx != -1:
                content = content[:last_brace_idx] + new_method + content[last_brace_idx:]
                
                with open(bili_api_path, 'w') as f:
                    f.write(content)
                print(f"Updated {bili_api_path}")
            else:
                print(f"Warning: Could not find class closing brace in {bili_api_path}")
        else:
             print(f"Warning: Could not find module.exports in {bili_api_path}")
    else:
        print(f"Skipped {bili_api_path} (already updated)")

except Exception as e:
    print(f"Error updating {bili_api_path}: {e}")

# 3. Modify src/web/routes/bilibili.js
routes_path = 'src/web/routes/bilibili.js'
try:
    with open(routes_path, 'r') as f:
        content = f.read()

    new_route = '''
// 获取当前登录状态
router.get('/status', async (req, res, next) => {
  try {
    const { groupId } = req.query;
    const result = await biliApi.getCredentialStatus(groupId);

    if (result.status === 'success') {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || '获取状态失败'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to check login status:', error);
    next(error);
  }
});

'''

    if "router.get('/status'" not in content:
        target = 'module.exports = router;'
        if target in content:
            content = content.replace(target, new_route + target)
            
            with open(routes_path, 'w') as f:
                f.write(content)
            print(f"Updated {routes_path}")
        else:
             print(f"Warning: Could not find module.exports in {routes_path}")
    else:
        print(f"Skipped {routes_path} (already updated)")

except Exception as e:
    print(f"Error updating {routes_path}: {e}")
