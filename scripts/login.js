import BiliLogin from '../src/utils/biliLogin.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Bilibili 扫码登录工具               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  const login = new BiliLogin();

  try {
    // 询问是否自动保存到配置文件
    const saveToConfig = await question('是否自动保存 Cookie 到配置文件？(Y/n): ');
    const shouldSave = !saveToConfig || saveToConfig.toLowerCase() === 'y';

    console.log('');
    
    // 执行登录
    const cookie = await login.login(shouldSave);

    if (!shouldSave) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('获取到的 Cookie (请手动复制到 config.js):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(cookie);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    console.log('登录成功！现在可以启动机器人了。');
    
  } catch (error) {
    console.error('\n❌ 登录失败:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n已取消登录');
  process.exit(0);
});

main();