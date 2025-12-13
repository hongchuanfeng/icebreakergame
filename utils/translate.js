// 翻译工具：用于翻译游戏详情文本
// 加载环境变量（优先加载.env.local，如果不存在则加载.env）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const https = require('https');
const fs = require('fs');
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

// 腾讯云翻译 API 配置
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID;
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY;
const TENCENT_REGION = process.env.TENCENT_REGION || 'ap-beijing'; // 默认北京地域

// 调试：检查环境变量是否加载
if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
  console.warn('[Translate] ⚠️ 腾讯云API配置未找到！');
  console.warn('[Translate] 请确保在项目根目录创建 .env.local 文件，并设置以下变量：');
  console.warn('[Translate]   TENCENT_SECRET_ID=your_secret_id');
  console.warn('[Translate]   TENCENT_SECRET_KEY=your_secret_key');
  console.warn('[Translate] 当前工作目录:', process.cwd());
  console.warn('[Translate] 环境变量 TENCENT_SECRET_ID:', TENCENT_SECRET_ID ? '已设置（长度: ' + TENCENT_SECRET_ID.length + '）' : '未设置');
  console.warn('[Translate] 环境变量 TENCENT_SECRET_KEY:', TENCENT_SECRET_KEY ? '已设置（长度: ' + TENCENT_SECRET_KEY.length + '）' : '未设置');
} else {
  console.log('[Translate] ✓ 腾讯云API配置已加载');
  console.log('[Translate] TENCENT_SECRET_ID:', TENCENT_SECRET_ID.substring(0, 8) + '...');
  console.log('[Translate] TENCENT_REGION:', TENCENT_REGION);
}

// 腾讯云翻译 API（使用TC3-HMAC-SHA256签名）
async function translateWithTencent(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    return text;
  }

  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    throw new Error('Tencent API credentials not configured. Please set TENCENT_SECRET_ID and TENCENT_SECRET_KEY in .env.local');
  }

  try {
    // 确定源语言和目标语言代码
    // 腾讯云语言代码：zh-中文, en-英文
    const sourceLang = targetLang === 'zh-CN' ? 'en' : 'zh';
    const targetLangCode = targetLang === 'zh-CN' ? 'zh' : 'en';

    // 腾讯云API接口：文本翻译
    const service = 'tmt';
    const version = '2018-03-21';
    const action = 'TextTranslate';
    const endpoint = 'tmt.tencentcloudapi.com';
    const host = endpoint;

    // 构建请求参数
    // 腾讯云TC3签名要求：使用UTC时间，date格式为YYYYMMDD（8位数字字符串）
    // 严格按照腾讯云官方文档：使用UTC方法计算日期
    const timestamp = Math.floor(Date.now() / 1000);
    
    // 使用UTC方法计算日期（这是腾讯云官方推荐的方法）
    // 确保使用UTC时间，避免时区问题
    const utcDate = new Date(timestamp * 1000);
    const year = utcDate.getUTCFullYear();
    const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utcDate.getUTCDate()).padStart(2, '0');
    
    // 根据文档示例，Authorization头中的Date格式是YYYY-MM-DD（带横线）
    // 格式：2018-05-30
    // 注意：credentialScope在计算签名和Authorization头中必须完全一致
    const date = `${year}-${month}-${day}`; // 格式：YYYY-MM-DD
    
    // 验证日期格式（必须是YYYY-MM-DD格式）
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.length !== 10) {
      const isoString = utcDate.toISOString();
      throw new Error(`Invalid date format: "${date}" (type: ${typeof date}, length: ${date ? date.length : 0}), expected YYYY-MM-DD format. UTC ISO: ${isoString}, Year: ${year}, Month: ${month}, Day: ${day}`);
    }
    
    // 调试日志
    const isoString = utcDate.toISOString();
    console.log(`[Tencent Translate] UTC Date: "${date}" (type: ${typeof date}, length: ${date.length}), Timestamp: ${timestamp}, UTC ISO: ${isoString}`);
    console.log(`[Tencent Translate] Date components - Year: ${year}, Month: ${month}, Day: ${day}`);
    
    // 腾讯云API单次请求限制为2000字符
    // 注意：translateLongText应该已经分段处理，这里不应该收到超过2000字符的文本
    const maxLength = 2000;
    if (text.length > maxLength) {
      console.warn(`[Tencent Translate] ⚠️ WARNING: Text length (${text.length}) exceeds API limit (${maxLength})`);
      console.warn(`[Tencent Translate] This should not happen if translateLongText is working correctly`);
      console.warn(`[Tencent Translate] Text will be truncated to ${maxLength} characters`);
      // 仍然截断，但记录警告
    }
    const textToTranslate = text.length > maxLength ? text.substring(0, maxLength) : text;
    
    const requestPayload = {
      SourceText: textToTranslate,
      Source: sourceLang,
      Target: targetLangCode,
      ProjectId: 0
    };

    const payload = JSON.stringify(requestPayload);

    // TC3-HMAC-SHA256 签名算法
    const algorithm = 'TC3-HMAC-SHA256';
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    // 注意：Content-Type中不能有空格，应该是 application/json;charset=utf-8
    const canonicalHeaders = `content-type:application/json;charset=utf-8\nhost:${host}\n`;
    const signedHeaders = 'content-type;host';
    const hashedRequestPayload = crypto.createHash('sha256').update(payload).digest('hex');

    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

    // 构建credentialScope（用于计算签名和Authorization头）
    // 根据文档示例，credentialScope格式：YYYY-MM-DD/service/tc3_request（带横线）
    // 重要：credentialScope在计算签名和Authorization头中必须完全一致
    if (typeof date !== 'string') {
      throw new Error(`Date must be a string, got: ${typeof date}, value: ${date}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Date must be YYYY-MM-DD format, got: "${date}"`);
    }
    
    // credentialScope用于计算签名和Authorization头，使用YYYY-MM-DD格式（带横线）
    const credentialScope = date + '/' + service + '/tc3_request';
    
    // 验证credentialScope格式
    if (!credentialScope.match(/^\d{4}-\d{2}-\d{2}\/[^\/]+\/tc3_request$/)) {
      throw new Error(`Invalid credentialScope format: "${credentialScope}", expected: YYYY-MM-DD/service/tc3_request`);
    }
    
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
    
    // 调试日志：验证credentialScope格式
    console.log(`[Tencent Translate] ==========================================`);
    console.log(`[Tencent Translate] Date (YYYY-MM-DD): "${date}" (type: ${typeof date}, length: ${date.length})`);
    console.log(`[Tencent Translate] CredentialScope: "${credentialScope}"`);
    console.log(`[Tencent Translate] CredentialScope parts - date: "${date}", service: "${service}"`);

    // 计算签名（严格按照腾讯云TC3签名算法）
    // 注意：kDate的密钥是 'TC3' + SecretKey，然后对date字符串（YYYY-MM-DD格式）进行HMAC
    // 重要：date必须是字符串格式的YYYY-MM-DD（带横线）
    const kDate = crypto.createHmac('sha256', Buffer.from('TC3' + TENCENT_SECRET_KEY, 'utf8')).update(Buffer.from(date, 'utf8')).digest();
    const kService = crypto.createHmac('sha256', kDate).update(Buffer.from(service, 'utf8')).digest();
    const kSigning = crypto.createHmac('sha256', kService).update(Buffer.from('tc3_request', 'utf8')).digest();
    const signature = crypto.createHmac('sha256', kSigning).update(Buffer.from(stringToSign, 'utf8')).digest('hex');

    // 构建Authorization头（确保格式正确）
    // 根据文档示例，格式：TC3-HMAC-SHA256 Credential=SecretId/YYYY-MM-DD/service/tc3_request, SignedHeaders=..., Signature=...
    // 重要：credentialScope在计算签名和Authorization头中必须完全一致（都使用YYYY-MM-DD格式）
    const credentialPart = TENCENT_SECRET_ID + '/' + credentialScope;
    const authorization = algorithm + ' Credential=' + credentialPart + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    
    // 调试日志：输出关键签名信息
    console.log(`[Tencent Translate] Credential part: "${TENCENT_SECRET_ID}/${credentialScope}"`);
    console.log(`[Tencent Translate] Full Authorization header: ${authorization}`);
    console.log(`[Tencent Translate] ==========================================`);

    // 构建请求选项
    // 根据腾讯云文档，X-TC-Region 是可选的，但某些接口可能需要
    const headers = {
      'Content-Type': 'application/json;charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp), // 确保是字符串
      'X-TC-Version': version,
      'Authorization': authorization
    };
    
    // 如果设置了地域，添加 X-TC-Region 头
    if (TENCENT_REGION) {
      headers['X-TC-Region'] = TENCENT_REGION;
    }
    
    const options = {
      hostname: host,
      port: 443,
      path: '/',
      method: 'POST',
      headers: headers,
      timeout: 10000
    };
    
    // 调试日志：输出所有请求头（隐藏敏感信息）
    console.log(`[Tencent Translate] Request headers:`);
    console.log(`[Tencent Translate]   Content-Type: ${headers['Content-Type']}`);
    console.log(`[Tencent Translate]   Host: ${headers['Host']}`);
    console.log(`[Tencent Translate]   X-TC-Action: ${headers['X-TC-Action']}`);
    console.log(`[Tencent Translate]   X-TC-Timestamp: ${headers['X-TC-Timestamp']}`);
    console.log(`[Tencent Translate]   X-TC-Version: ${headers['X-TC-Version']}`);
    if (headers['X-TC-Region']) {
      console.log(`[Tencent Translate]   X-TC-Region: ${headers['X-TC-Region']}`);
    }
    console.log(`[Tencent Translate]   Authorization: ${authorization.substring(0, 100)}...`);

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.Response && result.Response.TargetText) {
              console.log(`[Tencent Translate] Success`);
              resolve(result.Response.TargetText);
            } else if (result.Response && result.Response.Error) {
              const errorCode = result.Response.Error.Code;
              const errorMessage = result.Response.Error.Message;
              
              // 特殊处理：服务未开通错误
              if (errorCode === 'FailedOperation.UserNotRegistered') {
                console.error(`[Tencent Translate] ⚠️ 腾讯云机器翻译服务未开通`);
                console.error(`[Tencent Translate] 请在腾讯云控制台开通机器翻译服务：`);
                console.error(`[Tencent Translate] https://console.cloud.tencent.com/tmt`);
                console.error(`[Tencent Translate] 错误详情: ${errorCode} - ${errorMessage}`);
                // 返回一个特殊的错误对象，让调用者知道这是服务未开通
                reject(new Error(`SERVICE_NOT_OPENED: ${errorMessage}`));
              } else {
                reject(new Error(`Tencent API error: ${errorCode} - ${errorMessage}`));
              }
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
        reject(new Error('Tencent Translate timeout'));
      });

      req.write(payload);
      req.end();
    });
  } catch (error) {
    throw error;
  }
}

// 统一的翻译函数（仅使用腾讯云翻译）
async function translateText(text, targetLang = 'zh-CN') {
  if (!text || text.trim().length === 0) {
    console.log(`[Translate] Empty text, returning as-is`);
    return text;
  }

  console.log(`[Translate] ==========================================`);
  console.log(`[Translate] Input text length: ${text.length}`);
  console.log(`[Translate] Target language: ${targetLang}`);
  console.log(`[Translate] Text preview (first 100 chars): ${text.substring(0, 100)}`);

  // 检查腾讯云API配置
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    console.error(`[Translate] ✗ Tencent API credentials not configured`);
    console.error(`[Translate] Please set TENCENT_SECRET_ID and TENCENT_SECRET_KEY in .env.local`);
    console.log(`[Translate] ==========================================`);
    return text; // 返回原文
  }

  // 生成缓存键
  const cacheKey = getCacheKey(text, targetLang);
  if (translationCache.has(cacheKey)) {
    console.log(`[Translate] ✓ Using cached translation (cache key: ${cacheKey})`);
    const cached = translationCache.get(cacheKey);
    console.log(`[Translate] Cached result length: ${cached ? cached.length : 0}`);
    console.log(`[Translate] ==========================================`);
    return cached;
  }
  console.log(`[Translate] No cache found, will call Tencent translation API`);

  // 使用腾讯云翻译
  const startTime = Date.now();
  try {
    console.log(`[Translate] Calling Tencent Translate API...`);
    const translated = await translateWithTencent(text, targetLang);
    const duration = Date.now() - startTime;
    
    console.log(`[Translate] ✓ Tencent API succeeded in ${duration}ms`);
    console.log(`[Translate] Translated text length: ${translated ? translated.length : 0}`);
    console.log(`[Translate] Translated preview (first 100 chars): ${translated ? translated.substring(0, 100) : 'null'}`);
    
    // 缓存翻译结果
    if (translationCache.size < 5000) {
      translationCache.set(cacheKey, translated);
      if (translationCache.size % 100 === 0) {
        saveCache();
      }
      console.log(`[Translate] Result cached (cache size: ${translationCache.size})`);
    }
    
    console.log(`[Translate] ==========================================`);
    return translated;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Translate] ✗ Tencent API failed after ${duration}ms: ${error.message}`);
    
    // 特殊处理：服务未开通错误
    if (error.message && error.message.startsWith('SERVICE_NOT_OPENED:')) {
      console.error(`[Translate] ⚠️ 腾讯云机器翻译服务未开通，返回原文`);
      console.error(`[Translate] 请在腾讯云控制台开通服务：https://console.cloud.tencent.com/tmt`);
    } else {
      if (error.stack) {
        console.error(`[Translate] Error stack: ${error.stack}`);
      }
    }
    
    console.error(`[Translate] Returning original text`);
    console.log(`[Translate] ==========================================`);
    return text; // 返回原文
  }
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

  // 腾讯云API单次请求限制为2000字符，如果文本较短（小于2000字符），直接翻译
  if (text.length < 2000) {
    console.log(`[TranslateLongText] Text is short (${text.length} chars), translating directly`);
    return await translateText(text, targetLang);
  }

  console.log(`[TranslateLongText] Text is long (${text.length} chars), splitting into paragraphs`);

  // 对于长文本，按段落分割翻译
  const paragraphs = text.split('\n');
  const translatedParagraphs = [];
  const batchSize = 2; // 每次并行翻译2段（减少并发以避免API限流）

  for (let i = 0; i < paragraphs.length; i += batchSize) {
    const batch = paragraphs.slice(i, i + batchSize);
    const promises = batch.map(async (paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) {
        return '';
      }

      // 如果段落太长（超过1800字符），进一步分割成更小的块
      // 腾讯云API限制为2000字符，我们使用1800作为安全阈值
      if (trimmed.length > 1800) {
        console.log(`[TranslateLongText] Paragraph too long (${trimmed.length} chars), splitting into chunks`);
        
        // 按句子分割，但如果句子也很长，按固定长度分割
        const chunks = [];
        let currentChunk = '';
        const sentences = trimmed.split(/([.!?]\s+)/);
        
        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i];
          const testChunk = currentChunk + sentence;
          
          // 如果加上这个句子后超过1800字符，保存当前块并开始新块
          if (testChunk.length > 1800 && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
          } else {
            currentChunk = testChunk;
          }
        }
        
        // 添加最后一个块
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
        }
        
        // 如果按句子分割后仍然有块超过1800字符，按固定长度强制分割
        const finalChunks = [];
        for (const chunk of chunks) {
          if (chunk.length > 1800) {
            // 按固定长度分割（每块1500字符，留出安全余量）
            for (let i = 0; i < chunk.length; i += 1500) {
              finalChunks.push(chunk.substring(i, i + 1500));
            }
          } else {
            finalChunks.push(chunk);
          }
        }
        
        console.log(`[TranslateLongText] Split into ${finalChunks.length} chunks`);
        const chunkTranslations = [];
        for (let i = 0; i < finalChunks.length; i++) {
          const chunk = finalChunks[i];
          if (chunk.trim().length > 0) {
            console.log(`[TranslateLongText] Translating chunk ${i + 1}/${finalChunks.length} (${chunk.length} chars)`);
            const translated = await translateText(chunk, targetLang);
            chunkTranslations.push(translated);
            // 添加延迟以避免请求过快
            if (i < finalChunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        }
        return chunkTranslations.join('');
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

