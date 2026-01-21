import sys

def modify_app_js():
    file_path = 'src/web/public/js/app.js'
    
    with open(file_path, 'r') as f:
        lines = f.readlines()
    
    new_lines = []
    
    # 1. Add updateBilibiliStatus method
    # Find showBilibiliLoginModal definition to insert before it
    inserted_method = False
    for i, line in enumerate(lines):
        if 'showBilibiliLoginModal(groupId) {' in line and not inserted_method:
            method_code = [
                '  async updateBilibiliStatus(groupId) {\n',
                '    try {\n',
                '      const response = await api.getBilibiliStatus(groupId);\n',
                '      if (!response.success) return;\n',
                '\n',
                '      const data = response.data;\n',
                '      const statusEl = document.getElementById(\'biliLoginStatus\');\n',
                '      const uidEl = document.getElementById(\'biliAccountUid\');\n',
                '      const btnEl = document.getElementById(\'groupBiliLoginBtn\');\n',
                '\n',
                '      if (!statusEl || !uidEl || !btnEl) return;\n',
                '\n',
                '      if (data.logged_in) {\n',
                '        statusEl.textContent = \'已登录\';\n',
                '        statusEl.style.color = \'#4caf50\';\n',
                '        statusEl.style.fontWeight = \'bold\';\n',
                '\n',
                '        uidEl.textContent = `UID: ${data.uid} | ${data.name}`;\n',
                '        uidEl.classList.remove(\'hidden\');\n',
                '\n',
                '        btnEl.textContent = \'切换账号\';\n',
                '      } else {\n',
                '        statusEl.textContent = \'未登录\';\n',
                '        statusEl.style.color = \'\';\n',
                '        statusEl.style.fontWeight = \'\';\n',
                '\n',
                '        uidEl.classList.add(\'hidden\');\n',
                '        btnEl.textContent = \'登录/重新登录\';\n',
                '      }\n',
                '    } catch (error) {\n',
                '      console.error(\'Failed to update Bilibili status:\', error);\n',
                '    }\n',
                '  }\n',
                '\n'
            ]
            new_lines.extend(method_code)
            inserted_method = True
        new_lines.append(line)
        
    # 2. Call updateBilibiliStatus in renderGroupPanel
    # Look for "this.loadSubscriptions(groupId, 'users');"
    final_lines = []
    updated_render = False
    for line in new_lines:
        final_lines.append(line)
        if "this.loadSubscriptions(groupId, 'users');" in line and not updated_render:
             final_lines.append("    this.updateBilibiliStatus(groupId);\n")
             updated_render = True
             
    # 3. Call updateBilibiliStatus in startLoginPolling
    # Look for "this.hideBilibiliLoginModal();"
    # The requirement says "after a successful login".
    # In startLoginPolling, inside "if (status.code === 0) {" block.
    # There is "showToast('登录成功！', 'success');" and "this.hideBilibiliLoginModal();"
    # Then it does loadGroups and selectGroup.
    # Since selectGroup calls renderGroupPanel which calls updateBilibiliStatus, it might be redundant, 
    # but the instructions asked for it. 
    # Let's put it after hideBilibiliLoginModal()
    
    really_final_lines = []
    updated_polling = False
    for line in final_lines:
        really_final_lines.append(line)
        if "this.hideBilibiliLoginModal();" in line and not updated_polling:
             # We need to make sure we are inside startLoginPolling.
             # But hideBilibiliLoginModal is unique enough here usually.
             really_final_lines.append("            this.updateBilibiliStatus(this.currentLoginGroupId);\n")
             updated_polling = True

    with open(file_path, 'w') as f:
        f.writelines(really_final_lines)

if __name__ == '__main__':
    modify_app_js()
