const fs = require('fs');
const path = require('path');

// 支持的语言列表
const SUPPORTED_LOCALES = ['en', 'zh-CN'];
const DEFAULT_LOCALE = 'en';

// 缓存语言文件
let localeCache = {};

// 获取项目根目录（兼容 Lambda 等环境）
function getProjectRoot() {
  // 尝试多种方式获取项目根目录
  if (process.env.LAMBDA_TASK_ROOT) {
    // AWS Lambda
    return process.env.LAMBDA_TASK_ROOT;
  }
  if (process.env.VERCEL) {
    // Vercel
    return '/var/task';
  }
  // 本地开发环境
  return path.resolve(__dirname, '..');
}

/**
 * 加载语言文件
 * @param {string} locale - 语言代码 (en, zh-CN)
 * @returns {Object} 翻译对象
 */
function loadLocale(locale) {
  // 如果缓存中有，直接返回
  if (localeCache[locale]) {
    return localeCache[locale];
  }

  // 如果语言不支持，使用默认语言
  if (!SUPPORTED_LOCALES.includes(locale)) {
    locale = DEFAULT_LOCALE;
  }

  try {
    const projectRoot = getProjectRoot();
    const localePath = path.join(projectRoot, 'locales', `${locale}.json`);
    console.log(`[i18n] Loading locale from: ${localePath}`);
    
    const localeData = fs.readFileSync(localePath, 'utf8');
    localeCache[locale] = JSON.parse(localeData);
    return localeCache[locale];
  } catch (error) {
    console.error(`[i18n] Error loading locale ${locale}:`, error.message);
    // 如果加载失败，尝试加载默认语言
    if (locale !== DEFAULT_LOCALE) {
      return loadLocale(DEFAULT_LOCALE);
    }
    return {};
  }
}

/**
 * 翻译函数
 * @param {string} locale - 语言代码
 * @param {string} key - 翻译键（支持点号分隔，如 'common.home'）
 * @param {Object} params - 替换参数对象
 * @returns {string} 翻译后的文本
 */
function t(locale, key, params = {}) {
  const translations = loadLocale(locale);
  
  // 支持嵌套键（如 'common.home'）
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // 如果找不到翻译，返回键名
      return key;
    }
  }
  
  // 如果值是字符串，进行参数替换
  if (typeof value === 'string') {
    // 替换 {{param}} 格式的参数
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? params[paramKey] : match;
    });
  }
  
  return value;
}

/**
 * 检测语言
 * 优先级：URL参数 > Cookie > Accept-Language > 默认语言
 * @param {Object} req - Express 请求对象
 * @returns {string} 语言代码
 */
function detectLocale(req) {
  // 1. 检查 URL 路径中的语言代码（已在中间件中提取）
  // 2. 检查 Cookie
  if (req.cookies && req.cookies.locale && SUPPORTED_LOCALES.includes(req.cookies.locale)) {
    return req.cookies.locale;
  }
  
  // 3. 检查 Accept-Language 头
  const acceptLanguage = req.headers['accept-language'];
  if (acceptLanguage) {
    // 解析 Accept-Language，例如: "en-US,en;q=0.9,zh-CN;q=0.8"
    const languages = acceptLanguage.split(',').map(lang => {
      const parts = lang.trim().split(';');
      return parts[0].toLowerCase();
    });
    
    // 检查是否匹配支持的语言
    for (const lang of languages) {
      if (lang.startsWith('zh')) {
        return 'zh-CN';
      }
      if (lang.startsWith('en')) {
        return 'en';
      }
    }
  }
  
  // 4. 返回默认语言
  return DEFAULT_LOCALE;
}

/**
 * 清除语言缓存（用于开发环境热更新）
 */
function clearCache() {
  localeCache = {};
}

module.exports = {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  loadLocale,
  t,
  detectLocale,
  clearCache
};

