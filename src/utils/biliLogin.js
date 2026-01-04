import axios from 'axios';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

export default class BiliLogin {
  constructor() {
    this.qrcodeKey = null;
    this.pollTimer = null;
  }

  // 获取二维码
  async getQRCode() {
    try {
      const response = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.data.code !== 0) {
        throw new Error('获取二维码失败: ' + response.data.message);
      }

      const { url, qrcode_key } = response.data.data;
      this.qrcodeKey = qrcode_key;

      return { url, qrcodeKey: qrcode_key };
    } catch (error) {
      console.error('获取二维码失败:', error.message);
      throw error;
    }
  }

  // 在终端显示二维码
  showQRCode(url) {
    console.log('\n========================================');
    console.log('请使用 Bilibili APP 扫描下方二维码登录:');
    console.log('========================================\n');
    
    qrcode.generate(url, { small: true }, (qrcode) => {
      console.log(qrcode);
    });
    
    console.log('\n或在浏览器中打开以下链接扫码:');
    console.log(url);
    console.log('\n========================================\n');
  }

  // 轮询检查扫码状态
  async pollScanStatus() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 60; // 最多轮询 60 次（3分钟）

      this.pollTimer = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
          clearInterval(this.pollTimer);
          reject(new Error('二维码已过期，请重新获取'));
          return;
        }

        try {
          const response = await axios.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', {
            params: {
              qrcode_key: this.qrcodeKey
            },
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          const { code, message } = response.data.data;

          switch (code) {
            case 86101:
              // 未扫码
              console.log('等待扫码...');
              break;

            case 86090:
              // 已扫码未确认
              console.log('✓ 已扫码，请在手机上确认登录');
              break;

            case 0:
              // 登录成功
              clearInterval(this.pollTimer);
              console.log('✓ 登录成功！');
              
              // 从响应头中获取 Cookie
              const cookies = this.extractCookies(response);
              resolve(cookies);
              break;

            case 86038:
              // 二维码已过期
              clearInterval(this.pollTimer);
              reject(new Error('二维码已过期'));
              break;

            default:
              console.log(`未知状态: ${code} - ${message}`);
          }
        } catch (error) {
          console.error('轮询失败:', error.message);
        }
      }, 3000); // 每3秒检查一次
    });
  }

  // 从响应中提取 Cookie
  extractCookies(response) {
    const setCookieHeaders = response.headers['set-cookie'] || [];
    const cookieObj = {};

    setCookieHeaders.forEach(cookie => {
      const [pair] = cookie.split(';');
      const [key, value] = pair.split('=');
      cookieObj[key.trim()] = value;
    });

    // 构建 Cookie 字符串
    const cookieString = Object.entries(cookieObj)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    return cookieString;
  }

  // 保存 Cookie 到配置文件
  async saveCookieToConfig(cookie) {
    try {
      const configPath = path.join(process.cwd(), 'src', 'config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');

      // 替换 cookie 值
      const cookieRegex = /cookie:\s*['"].*?['"]/;
      if (cookieRegex.test(configContent)) {
        configContent = configContent.replace(
          cookieRegex,
          `cookie: '${cookie}'`
        );
      } else {
        // 如果没有找到，在 bilibili 配置块中添加
        configContent = configContent.replace(
          /bilibili:\s*{/,
          `bilibili: {\n    cookie: '${cookie}',`
        );
      }

      fs.writeFileSync(configPath, configContent, 'utf8');
      console.log('\n✓ Cookie 已保存到配置文件');
      
      return true;
    } catch (error) {
      console.error('保存 Cookie 失败:', error.message);
      console.log('\n请手动将以下 Cookie 复制到 config.js 中:');
      console.log('\n' + cookie + '\n');
      return false;
    }
  }

  // 验证 Cookie 是否有效
  async validateCookie(cookie) {
    try {
      const response = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.data.code === 0 && response.data.data.isLogin) {
        const { uname, mid } = response.data.data;
        console.log(`\n✓ Cookie 验证成功！`);
        console.log(`用户名: ${uname}`);
        console.log(`UID: ${mid}\n`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Cookie 验证失败:', error.message);
      return false;
    }
  }

  // 完整的登录流程
  async login(saveToConfig = true) {
    try {
      console.log('\n开始 Bilibili 扫码登录流程...\n');

      // 1. 获取二维码
      const { url } = await this.getQRCode();
      
      // 2. 显示二维码
      this.showQRCode(url);

      // 3. 轮询扫码状态
      const cookie = await this.pollScanStatus();

      // 4. 验证 Cookie
      const isValid = await this.validateCookie(cookie);
      if (!isValid) {
        throw new Error('获取到的 Cookie 无效');
      }

      // 5. 保存到配置文件
      if (saveToConfig) {
        await this.saveCookieToConfig(cookie);
      }

      return cookie;
    } catch (error) {
      console.error('\n登录失败:', error.message);
      throw error;
    } finally {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    }
  }

  // 取消登录
  cancel() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      console.log('\n已取消登录');
    }
  }
}

// 如果直接运行此文件，执行登录流程
if (import.meta.url === `file://${process.argv[1]}`) {
  const login = new BiliLogin();
  
  login.login(true)
    .then(() => {
      console.log('\n登录流程完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n登录失败:', error.message);
      process.exit(1);
    });

  // 处理 Ctrl+C
  process.on('SIGINT', () => {
    login.cancel();
    process.exit(0);
  });
}