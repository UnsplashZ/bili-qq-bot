export default class URLParser {
  // B站URL正则表达式
  patterns = {
    video: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[\w]+|av\d+)/i,
    dynamic: /(?:https?:\/\/)?(?:t|m)\.bilibili\.com\/(\d+)/i,
    article: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/read\/cv(\d+)/i,
    bangumi: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/bangumi\/play\/(ss\d+|ep\d+)/i,
    live: /(?:https?:\/\/)?live\.bilibili\.com\/(\d+)/i,
    // 短链接
    shortLink: /(?:https?:\/\/)?b23\.tv\/([\w]+)/i
  };

  // 提取B站URL
  extractBiliUrl(text) {
    // 尝试匹配各种类型的链接
    for (const [type, pattern] of Object.entries(this.patterns)) {
      const match = text.match(pattern);
      if (match) {
        return {
          type: type === 'live' ? 'video' : type, // live暂时当video处理
          id: match[1],
          url: match[0]
        };
      }
    }

    // 检查是否是短链接
    const shortMatch = text.match(this.patterns.shortLink);
    if (shortMatch) {
      // 短链接需要展开,这里先返回null,实际使用时需要请求短链接获取真实地址
      return {
        type: 'short',
        id: shortMatch[1],
        url: shortMatch[0]
      };
    }

    return null;
  }

  // 从小程序JSON中提取URL
  extractBiliUrlFromMiniApp(jsonData) {
    try {
      // QQ小程序格式
      const url = jsonData.meta?.detail_1?.qqdocurl || 
                  jsonData.meta?.news?.jumpUrl ||
                  jsonData.prompt;

      if (url && url.includes('bilibili.com')) {
        return this.extractBiliUrl(url);
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // 解析BV号到AV号(如果需要)
  bv2av(bvid) {
    // BV号转AV号的算法
    const XOR_CODE = 23442827791579n;
    const MASK_CODE = 2251799813685247n;
    const BASE = 58n;
    
    const table = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
    
    bvid = bvid.substring(2);
    let tmp = 0n;
    
    for (let i = 0; i < 6; i++) {
      tmp = tmp * BASE + BigInt(table.indexOf(bvid[i]));
    }
    
    return Number((tmp & MASK_CODE) ^ XOR_CODE);
  }

  // 检测文本中是否包含B站内容
  hasBiliContent(text) {
    for (const pattern of Object.values(this.patterns)) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  // 清理URL(移除追踪参数等)
  cleanUrl(url) {
    try {
      const urlObj = new URL(url);
      // 移除常见的追踪参数
      urlObj.searchParams.delete('spm_id_from');
      urlObj.searchParams.delete('from_source');
      urlObj.searchParams.delete('from');
      urlObj.searchParams.delete('share_source');
      urlObj.searchParams.delete('share_medium');
      urlObj.searchParams.delete('bbid');
      urlObj.searchParams.delete('ts');
      
      return urlObj.toString();
    } catch (e) {
      return url;
    }
  }
}