// 翻译工具：用于翻译游戏详情文本
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 翻译缓存（内存缓存）
const translationCache = new Map();
const CACHE_FILE = path.join(__dirname, '..', 'cache', 'translations.json');

// 加载缓存文件（如果存在）
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheData = fs.readFileSync(CACHE_FILE, 'utf8');
      const cache = JSON.parse(cacheData);
      Object.entries(cache).forEach(([key, value]) => {
        translationCache.set(key, value);
      });
      console.log(`Loaded ${translationCache.size} translations from cache`);
    }
  } catch (error) {
    console.error('Error loading translation cache:', error.message);
  }
}

// 保存缓存到文件
function saveCache() {
  try {
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheObj = {};
    translationCache.forEach((value, key) => {
      cacheObj[key] = value;
    });
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving translation cache:', error.message);
  }
}

// 初始化时加载缓存
loadCache();

// 生成缓存键
function getCacheKey(text, targetLang) {
  const hash = crypto.createHash('md5').update(text.substring(0, 500)).digest('hex');
  return `${hash}_${targetLang}`;
}

// 翻译 API 配置（可以通过环境变量配置）
const TRANSLATION_API = process.env.TRANSLATION_API || 'baidu'; // 'google', 'baidu', 'youdao', 'auto'
const BAIDU_CLIENT_ID = process.env.BAIDU_CLIENT_ID || 'vUi8ehLSHu6FwdGZxpACv7bo';
const BAIDU_CLIENT_SECRET = process.env.BAIDU_CLIENT_SECRET || 'TlLaapNfsJ6gyNnb6USPDsPznRcKVYJk';

// 百度 Access Token 缓存
let baiduAccessToken = null;
let baiduTokenExpireTime = 0;

// Google 翻译 API（免费版本，不需要 API key）
async function translateWithGoogle(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // 确定源语言和目标语言代码
  const sourceLang = targetLang === 'zh-CN' ? 'en' : 'zh';
  const targetLangCode = targetLang === 'zh-CN' ? 'zh' : 'en';

  try {
    // 使用 Google Translate 的免费接口
    const textToTranslate = text.substring(0, 5000); // 限制长度
    const encodedText = encodeURIComponent(textToTranslate);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLangCode}&dt=t&q=${encodedText}`;

    console.log(`[Google Translate] Requesting translation...`);

    const translated = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Google Translate timeout'));
      }, 8000); // 8秒超时

      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const result = JSON.parse(data);
            if (result && result[0] && result[0][0]) {
              let translatedText = '';
              result[0].forEach(item => {
                if (item[0]) {
                  translatedText += item[0];
                }
              });
              console.log(`[Google Translate] Success`);
              resolve(translatedText || text);
            } else {
              reject(new Error('Invalid response format'));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.setTimeout(8000, () => {
        req.destroy();
        clearTimeout(timeout);
        reject(new Error('Request timeout'));
      });
    });

    return translated;
  } catch (error) {
    throw error; // 向上抛出错误，让调用者处理
  }
}

// 获取百度 Access Token
async function getBaiduAccessToken() {
  // 检查缓存的 token 是否仍然有效（提前5分钟刷新）
  const now = Date.now();
  if (baiduAccessToken && baiduTokenExpireTime > now + 5 * 60 * 1000) {
    return baiduAccessToken;
  }

  if (!BAIDU_CLIENT_ID || !BAIDU_CLIENT_SECRET) {
    throw new Error('Baidu API credentials not configured');
  }

  const querystring = require('querystring');
  const params = {
    grant_type: 'client_credentials',
    client_id: BAIDU_CLIENT_ID,
    client_secret: BAIDU_CLIENT_SECRET
  };

  const postData = querystring.stringify(params);
  const url = `https://aip.baidubce.com/oauth/2.0/token?${postData}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.access_token) {
            baiduAccessToken = result.access_token;
            // Access token 默认有效期 30 天，我们设置为 25 天以确保安全
            baiduTokenExpireTime = now + 25 * 24 * 60 * 60 * 1000;
            console.log('[Baidu] Access token obtained successfully');
            resolve(baiduAccessToken);
          } else {
            reject(new Error(result.error_description || 'Failed to get access token'));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 百度翻译 API（使用通用版 API，需要 Access Token）
async function translateWithBaidu(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  try {
    // 获取 Access Token
    const accessToken = await getBaiduAccessToken();
    
    // 确定目标语言代码
    const targetLangCode = targetLang === 'zh-CN' ? 'zh' : 'en';
    const fromLang = targetLang === 'zh-CN' ? 'en' : 'zh';
    
    // 百度翻译 API 请求体
    const requestBody = {
      q: text,
      from: fromLang,
      to: targetLangCode
    };

    const postData = JSON.stringify(requestBody);
    const options = {
      hostname: 'aip.baidubce.com',
      port: 443,
      path: `/rpc/2.0/mt/texttrans/v1?access_token=${accessToken}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.result && result.result.trans_result && result.result.trans_result.length > 0) {
              // 合并所有翻译结果
              const translatedText = result.result.trans_result.map(item => item.dst).join('');
              console.log(`[Baidu Translate] Success, translated ${result.result.trans_result.length} segments`);
              resolve(translatedText);
            } else if (result.error_code) {
              // 如果是 token 过期或无效，清除缓存并重试
              if (result.error_code === 100 || result.error_code === 110 || result.error_code === 111) {
                baiduAccessToken = null;
                baiduTokenExpireTime = 0;
                console.warn('[Baidu] Token expired or invalid, will retry with new token');
                // 递归重试一次
                translateWithBaidu(text, targetLang).then(resolve).catch(reject);
                return;
              }
              reject(new Error(result.error_msg || `Baidu API error: ${result.error_code}`));
            } else {
              reject(new Error('Invalid response format'));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Baidu Translate timeout'));
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    throw error;
  }
}

// 使用免费的翻译服务（my memory translate，不需要 API key）
async function translateWithMyMemory(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  const sourceLang = targetLang === 'zh-CN' ? 'en' : 'zh';
  const targetLangCode = targetLang === 'zh-CN' ? 'zh' : 'en';
  
  // MyMemory 免费翻译 API（限制 100 词）
  const textToTranslate = text.substring(0, 500); // 限制长度避免超过限制
  const encodedText = encodeURIComponent(textToTranslate);
  const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${sourceLang}|${targetLangCode}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MyMemory timeout'));
    }, 8000);

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const result = JSON.parse(data);
          if (result.responseData && result.responseData.translatedText) {
            console.log(`[MyMemory Translate] Success`);
            resolve(result.responseData.translatedText);
          } else {
            reject(new Error('Invalid response'));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    }).setTimeout(8000, () => {
      reject(new Error('Request timeout'));
    });
  });
}

// 统一的翻译函数（支持多个 API 降级）
async function translateText(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // 生成缓存键
  const cacheKey = getCacheKey(text, targetLang);
  if (translationCache.has(cacheKey)) {
    console.log(`[Translate] Using cached translation`);
    return translationCache.get(cacheKey);
  }

  // 根据配置选择翻译 API
  const apiList = [];
  
  if (TRANSLATION_API === 'google') {
    apiList.push({ name: 'Google', fn: translateWithGoogle });
  } else if (TRANSLATION_API === 'baidu') {
    apiList.push({ name: 'Baidu', fn: translateWithBaidu });
  } else if (TRANSLATION_API === 'mymemory') {
    apiList.push({ name: 'MyMemory', fn: translateWithMyMemory });
  } else {
    // 自动模式：优先使用百度翻译（如果配置了），否则尝试其他 API
    if (BAIDU_CLIENT_ID && BAIDU_CLIENT_SECRET) {
      apiList.push({ name: 'Baidu', fn: translateWithBaidu });
    }
    apiList.push(
      { name: 'Google', fn: translateWithGoogle },
      { name: 'MyMemory', fn: translateWithMyMemory }
    );
  }

  let lastError = null;
  
  for (const api of apiList) {
    try {
      console.log(`[Translate] Trying ${api.name} API...`);
      const translated = await api.fn(text, targetLang);
      
      // 缓存翻译结果
      if (translationCache.size < 5000) {
        translationCache.set(cacheKey, translated);
        if (translationCache.size % 100 === 0) {
          saveCache();
        }
      }
      
      return translated;
    } catch (error) {
      console.warn(`[Translate] ${api.name} API failed: ${error.message}`);
      lastError = error;
      continue; // 尝试下一个 API
    }
  }

  // 所有 API 都失败
  console.error(`[Translate] All translation APIs failed. Last error: ${lastError?.message}`);
  return text; // 返回原文
}

// 翻译大段文本（分段翻译以避免长度限制）
async function translateLongText(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  console.log(`[TranslateLongText] Starting translation, text length: ${text.length}, targetLang: ${targetLang}`);

  // 检查完整文本的缓存
  const fullCacheKey = getCacheKey(text, targetLang);
  if (translationCache.has(fullCacheKey)) {
    console.log(`[TranslateLongText] Found cached translation`);
    return translationCache.get(fullCacheKey);
  }

  // 如果文本较短（小于 4000 字符），直接翻译
  if (text.length < 4000) {
    console.log(`[TranslateLongText] Text is short (${text.length} chars), translating directly`);
    return await translateText(text, targetLang);
  }

  console.log(`[TranslateLongText] Text is long (${text.length} chars), splitting into paragraphs`);

  // 对于长文本，按段落分割翻译
  const paragraphs = text.split('\n');
  const translatedParagraphs = [];
  const batchSize = 3; // 每次并行翻译3段

  for (let i = 0; i < paragraphs.length; i += batchSize) {
    const batch = paragraphs.slice(i, i + batchSize);
    const promises = batch.map(async (paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) {
        return '';
      }

      // 如果段落太长，进一步分割
      if (trimmed.length > 3500) {
        const sentences = trimmed.split(/[.!?]\s+/);
        const sentenceTranslations = [];
        for (const sentence of sentences) {
          if (sentence.trim().length > 0) {
            const translated = await translateText(sentence, targetLang);
            sentenceTranslations.push(translated);
            // 添加小延迟以避免请求过快
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        return sentenceTranslations.join(' ');
      } else {
        return await translateText(trimmed, targetLang);
      }
    });

    const batchResults = await Promise.all(promises);
    translatedParagraphs.push(...batchResults);
    
    // 添加延迟以避免请求过快
    if (i + batchSize < paragraphs.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  const result = translatedParagraphs.join('\n');
  
  console.log(`[TranslateLongText] Translation completed, result length: ${result.length}`);
  
  // 缓存完整结果
  if (translationCache.size < 5000) {
    translationCache.set(fullCacheKey, result);
  }

  return result;
}

// 保存缓存（在进程退出时）
process.on('SIGINT', () => {
  saveCache();
  process.exit();
});

process.on('SIGTERM', () => {
  saveCache();
  process.exit();
});

module.exports = {
  translateText,
  translateLongText,
  saveCache
};

