// 加载环境变量（优先加载.env.local，如果不存在则加载.env）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config(); // 如果.env.local不存在，尝试加载.env

const express = require('express');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { getCategoryIcon } = require('./utils/helpers');
const { t, detectLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } = require('./utils/i18n');
const { 
  getCategories: getSupabaseCategories, 
  getGames, 
  getGameById,
  getGamesByCategoryId,
  searchGames,
  transformDataToOldFormat,
  getGamesPlayCount
} = require('./utils/supabase');

const app = express();

// 生产环境常见：在反向代理（如 Nginx/Cloudflare）后面运行，启用 trust proxy
// 这样 req.secure 才能在 HTTPS 场景下正确为 true，用于设置安全 Cookie
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// 设置视图引擎为 EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 设置静态文件目录
app.use(express.static('public'));

// 解析 JSON 请求体和 URL 编码
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 解析 Cookie
app.use(cookieParser());

// 统一 URL 语言前缀大小写（如 /zh-cn -> /zh-CN），避免路由与检测不一致
app.use((req, res, next) => {
  const firstSeg = (req.path.split('/')[1] || '').trim();
  if (!firstSeg) return next();
  const lower = firstSeg.toLowerCase();
  if (lower === 'zh-cn' && firstSeg !== 'zh-CN') {
    const rest = req.url.slice(firstSeg.length + 1); // 保留后续路径与查询
    return res.redirect(301, '/zh-CN' + (rest || ''));
  }
  if (lower === 'en' && firstSeg !== 'en') {
    const rest = req.url.slice(firstSeg.length + 1);
    return res.redirect(301, '/en' + (rest || ''));
  }
  next();
});

// 提示中间层按语言与 Cookie 区分缓存，避免生产缓存导致语言不一致
app.use((req, res, next) => {
  try {
    const existingVary = res.getHeader('Vary');
    const varyValue = existingVary ? String(existingVary) + ', Accept-Language, Cookie' : 'Accept-Language, Cookie';
    res.setHeader('Vary', varyValue);
  } catch (e) {}
  // SSR 页面不应被长期缓存
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// robots.txt 路由（必须在多语言中间件之前定义，用于搜索引擎爬虫）
app.get('/robots.txt', (req, res) => {
  const robotsFilePath = path.join(__dirname, 'robots.txt');
  if (fs.existsSync(robotsFilePath)) {
    res.type('text/plain');
    res.sendFile(robotsFilePath);
  } else {
    res.status(404).send('Not Found');
  }
});

// sitemap.xml 路由（必须在多语言中间件之前定义，用于搜索引擎网站地图）
app.get('/sitemap.xml', (req, res) => {
  const sitemapFilePath = path.join(__dirname, 'sitemap.xml');
  if (fs.existsSync(sitemapFilePath)) {
    res.type('application/xml');
    res.sendFile(sitemapFilePath);
  } else {
    res.status(404).send('Not Found');
  }
});

// ads.txt 路由（必须在多语言中间件之前定义，用于广告联盟验证）
app.get('/ads.txt', (req, res) => {
  const adsFilePath = path.join(__dirname, 'ads.txt');
  if (fs.existsSync(adsFilePath)) {
    res.type('text/plain');
    res.sendFile(adsFilePath);
  } else {
    res.status(404).send('Not Found');
  }
});

// 语言切换路由（必须在多语言中间件之前定义）
app.get('/set-locale/:locale', (req, res) => {
  const locale = req.params.locale;
  let referer = req.get('Referer') || '/';
  
  if (SUPPORTED_LOCALES.includes(locale)) {
    // 设置 Cookie（生产环境：在 HTTPS + 反向代理下，需开启 secure）
    const isSecure = req.secure || (req.headers['x-forwarded-proto'] === 'https');
    res.cookie('locale', locale, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      secure: !!isSecure
    });
    
    // 从 referer 中提取路径和查询参数
    let pathname = '/';
    let search = '';
    
    try {
      // 如果是完整 URL，提取路径部分
      if (referer.startsWith('http://') || referer.startsWith('https://')) {
        const url = new URL(referer);
        pathname = url.pathname;
        search = url.search;
      } else {
        // 如果是相对路径，直接使用
        const parts = referer.split('?');
        pathname = parts[0] || '/';
        search = parts[1] ? '?' + parts[1] : '';
      }
    } catch (e) {
      // 解析失败，使用默认值
      pathname = '/';
      search = '';
    }
    
    // 移除现有的语言前缀（大小写不敏感）
    let cleanPath = pathname;
    for (const loc of SUPPORTED_LOCALES) {
      const locLower = String(loc).toLowerCase();
      const lowerPath = cleanPath.toLowerCase();
      if (lowerPath.startsWith(`/${locLower}/`)) {
        cleanPath = '/' + cleanPath.substring(loc.length + 2); // 移除 '/{loc}/'
        break;
      } else if (lowerPath === `/${locLower}`) {
        cleanPath = '/';
        break;
      }
    }
    
    // 如果切换到的语言不是默认语言，添加语言前缀
    let redirectUrl;
    if (locale !== DEFAULT_LOCALE) {
      // 确保路径以 / 开头，且不是根路径
      if (cleanPath === '/') {
        redirectUrl = `/${locale}/`;
      } else {
        redirectUrl = `/${locale}${cleanPath}`;
      }
    } else {
      // 默认语言不需要前缀
      redirectUrl = cleanPath === '/' ? '/' : cleanPath;
    }
    
    // 添加查询参数
    redirectUrl += search;

    // 生成绝对 URL，避免在部分平台/代理下相对重定向异常
    const proto = (req.secure || (req.headers['x-forwarded-proto'] === 'https')) ? 'https' : 'http';
    const host = req.headers.host;
    const absoluteUrl = `${proto}://${host}${redirectUrl}`;

    // 语言切换不缓存，并使用 303 显式指示 GET 跳转
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.redirect(303, absoluteUrl);
  } else {
    const fallback = referer.startsWith('http') ? referer : '/';
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.redirect(303, fallback);
  }
});

// 从 Supabase 获取游戏数据（带缓存）
let cachedGameData = {};
let dataCacheTime = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 将语言代码转换为数据库语言代码
function getDbLanguage(locale) {
  return locale === 'zh-CN' ? 'zh-CN' : 'en_US';
}

async function getGameData(locale = 'en') {
  const dbLanguage = getDbLanguage(locale);
  const cacheKey = `data_${dbLanguage}`;
  const now = Date.now();
  
  // 如果缓存有效，直接返回
  if (cachedGameData[cacheKey] && dataCacheTime[cacheKey] && (now - dataCacheTime[cacheKey]) < CACHE_DURATION) {
    return cachedGameData[cacheKey];
  }
  
  try {
    // 从 Supabase 获取分类和游戏数据
    const categories = await getSupabaseCategories(dbLanguage);
    const games = await getGames(dbLanguage);
    
    // 转换为旧格式（兼容现有代码）
    const data = transformDataToOldFormat(categories, games, dbLanguage);
    
    cachedGameData[cacheKey] = data;
    dataCacheTime[cacheKey] = now;
    
    return data;
  } catch (error) {
    console.error(`Error fetching game data from Supabase for ${dbLanguage}:`, error);
    return [];
  }
}

// 获取分类列表
async function getCategoriesList(locale = 'en') {
  console.log('[Server Debug] getCategoriesList called, locale:', locale);
  const dbLanguage = getDbLanguage(locale);
  console.log('[Server Debug] dbLanguage:', dbLanguage);
  
  try {
    const categories = await getSupabaseCategories(dbLanguage);
    console.log('[Server Debug] Categories count:', categories.length);
    const categoryNames = categories.map(cat => cat.name);
    console.log('[Server Debug] Category names:', categoryNames.slice(0, 5));
    
    // 获取完整分类数据（包含游戏）
    const data = await getGameData(locale);
    console.log('[Server Debug] Full categories data count:', data.length);
    return data;
  } catch (error) {
    console.error(`[Server Debug] Error fetching categories for ${dbLanguage}:`, error);
    return [];
  }
}

// 翻译相关函数已移除，数据直接从 Supabase 获取对应语言版本

// 多语言中间件：检测和设置语言
app.use((req, res, next) => {
  // 从 URL 路径中提取语言代码（如果存在，兼容大小写，兼容 originalUrl）
  const urlToParse = (req.originalUrl || req.url || req.path || '/');
  const pathWithoutQuery = (urlToParse.split('?')[0] || '/');
  const first = (pathWithoutQuery.split('/').filter(p => p)[0] || '').trim();
  const pathLocaleLower = first.toLowerCase();
  let locale = null;
  
  // 优先从 URL 路径识别语言
  if (pathLocaleLower === 'zh-cn') {
    locale = 'zh-CN';
  } else if (pathLocaleLower === 'en') {
    locale = 'en';
  }
  
  // 如果没有在 URL 中，则使用检测逻辑（Cookie > Accept-Language > 默认）
  if (!locale) {
    locale = detectLocale(req);
  }
  
  // 最终兜底：如果还是没识别到，且 URL 路径明确包含 zh-CN，强制设为 zh-CN
  if (!locale && pathLocaleLower === 'zh-cn') {
    locale = 'zh-CN';
  }
  
  // 如果还是 null，使用默认语言
  if (!locale) {
    locale = DEFAULT_LOCALE;
  }

  // 调试日志（生产环境可以注释掉）
  if (pathLocaleLower === 'zh-cn' || req.cookies?.locale === 'zh-CN') {
    console.log(`[Locale Middleware] URL: ${req.originalUrl || req.url}, Path: ${req.path}, First segment: "${first}", Detected locale: ${locale}, Cookie locale: ${req.cookies?.locale || 'none'}`);
  }

  // 将语言代码存储到 req 和 res.locals
  req.locale = locale;
  res.locals.locale = locale;
  res.locals.supportedLocales = SUPPORTED_LOCALES;
  res.locals.defaultLocale = DEFAULT_LOCALE;
  try { res.setHeader('Content-Language', locale); } catch (e) {}
  
  // 设置翻译函数到 res.locals，模板中可以直接使用 t()
  res.locals.t = function(key, params = {}) {
    return t(locale, key, params);
  };
  
  // 翻译 category 名称的函数
  res.locals.translateCategory = function(categoryName) {
    if (!categoryName) return categoryName;
    const translated = t(locale, `categories.${categoryName}`, {});
    // 如果没有找到翻译（返回的是 key），则检查是否是中文，如果是中文返回原值，如果是英文且当前语言是中文则尝试翻译
    if (translated === `categories.${categoryName}`) {
      // 如果找不到翻译，英文保持原样，中文应该也能找到（因为我们已经添加了）
      return categoryName;
    }
    return translated;
  };
  
  // 生成语言化的 URL 辅助函数
  res.locals.localeUrl = function(path) {
    // 分离路径和查询参数
    const [pathPart, queryPart] = path.split('?');
    const queryString = queryPart ? '?' + queryPart : '';
    
    // 如果路径已经包含语言前缀，先移除
    let cleanPath = pathPart.startsWith('/') ? pathPart : '/' + pathPart;
    const pathParts = cleanPath.split('/').filter(p => p);
    
    // 如果第一个部分是语言代码，移除它（大小写不敏感）
    if (pathParts.length > 0) {
      const first = (pathParts[0] || '').toLowerCase();
      if (first === 'en' || first === 'zh-cn') {
        pathParts.shift();
      }
    }
    
    // 构建基础路径
    const basePath = pathParts.length > 0 ? '/' + pathParts.join('/') : '/';
    
    // 如果当前语言是默认语言，返回不带语言前缀的 URL
    if (locale === DEFAULT_LOCALE) {
      return basePath + queryString;
    }
    
    // 否则返回带语言前缀的 URL
    if (basePath === '/') {
      return `/${locale}/` + queryString;
    }
    return `/${locale}${basePath}` + queryString;
  };
  
  next();
});

// 将工具函数设为全局可用
app.use((req, res, next) => {
  res.locals.getCategoryIcon = getCategoryIcon;
  
  // 检查用户是否已登录
  const userEmail = req.cookies && req.cookies.user_email;
  res.locals.isLoggedIn = !!userEmail;
  res.locals.userEmail = userEmail || '';
  
  next();
});

// 语言化路由辅助函数：为路由添加语言前缀支持
function createLocaleRoutes(basePath, handler) {
  // 默认路由（使用检测到的语言）
  app.get(basePath, handler);
  
  // 为每个支持的语言创建带前缀的路由
  SUPPORTED_LOCALES.forEach(locale => {
    if (basePath === '/') {
      // 首页特殊处理
      app.get(`/${locale}`, handler);
      app.get(`/${locale}/`, handler);
    } else {
      app.get(`/${locale}${basePath}`, handler);
    }
  });
}

// SSR 路由：主页
createLocaleRoutes('/', async (req, res) => {
  const rawPath = (req.originalUrl || req.url || req.path || '/').split('?')[0].toLowerCase();
  let locale = req.locale || DEFAULT_LOCALE;
  if (rawPath === '/zh-cn' || rawPath.startsWith('/zh-cn/')) {
    locale = 'zh-CN';
    req.locale = 'zh-CN';
    res.locals.locale = 'zh-CN';
  } else if (rawPath === '/en' || rawPath.startsWith('/en/')) {
    locale = 'en';
    req.locale = 'en';
    res.locals.locale = 'en';
  }
  
  // 从 Supabase 获取数据（根据语言自动获取对应版本）
  const data = await getGameData(locale);
  const categories = await getCategoriesList(locale);
  
  // 获取游戏播放次数
  const playCounts = await getGamesPlayCount();
  
  res.render('index', {
    gameData: data,
    categories: categories,
    playCounts: playCounts,
    searchQuery: '',
    locale: locale,
    pageTitle: t(locale, 'home.title'),
    metaDescription: t(locale, 'home.description'),
    metaKeywords: t(locale, 'home.keywords')
  });
});

// SSR 路由：搜索页面
createLocaleRoutes('/search', async (req, res) => {
  const locale = req.locale;
  const query = req.query.q || '';
  const dbLanguage = getDbLanguage(locale);
  
  // 从 Supabase 获取数据
  const data = await getGameData(locale);
  const categories = await getCategoriesList(locale);
  
  // 获取游戏播放次数
  const playCounts = await getGamesPlayCount();
  
  let searchResults = [];
  
  if (query) {
    // 使用 Supabase 搜索
    const games = await searchGames(query, dbLanguage);
    const categoriesMap = {};
    const categoriesList = await getSupabaseCategories(dbLanguage);
    categoriesList.forEach(cat => {
      categoriesMap[cat.id] = cat.name;
    });
    
    searchResults = games.map(game => ({
      id: game.id,
      name: game.name,
      link: game.link || '',
      icon: game.icon || '',
      href: game.href || '',
      detail: game.detail || '',
      category: categoriesMap[game.category_id] || '',
      categoryId: game.category_id
    }));
  }
  
  res.render('search', {
    searchQuery: query,
    searchResults: searchResults,
    playCounts: playCounts,
    categories: categories
  });
});

// SSR 路由：游戏详情页面
createLocaleRoutes('/game', async (req, res) => {
  const locale = req.locale;
  const categoryId = req.query.categoryId;
  const gameId = req.query.gameId;
  const dbLanguage = getDbLanguage(locale);
  
  // 兼容旧版本：如果使用name参数，尝试查找对应的id
  const gameName = req.query.name;
  
  if (!gameId && !gameName) {
    return res.status(400).send(locale === 'zh-CN' ? '游戏ID不能为空' : 'Game ID cannot be empty');
  }
  
  // 从 Supabase 获取数据
  const data = await getGameData(locale);
  const categories = await getCategoriesList(locale);
  
  // 查找游戏
  let game = null;
  let originalGameCategory = '';
  let gameCategory = '';
  
  // 优先使用id查找（SEO友好）
  if (categoryId && gameId) {
    // 直接从 Supabase 获取游戏
    // 注意：对于中文版本，如果 cn_games 表没有 category_id，categoryId 参数可能无效
    const gameData = await getGameById(parseInt(gameId), parseInt(categoryId), dbLanguage);
    if (gameData) {
      // 转换游戏数据格式
      game = {
        id: gameData.id,
        name: gameData.name,
        link: gameData.link || '',
        icon: gameData.icon || '',
        href: gameData.href || '',
        detail: gameData.detail || '',
        metadata: gameData.metadata || {}
      };
      
      // 获取分类信息
      const categoryItem = data.find(cat => cat.id === parseInt(categoryId));
      if (categoryItem) {
        originalGameCategory = categoryItem.category;
        gameCategory = categoryItem.category;
      }
    }
  }
  
  // 如果通过 categoryId 和 gameId 找不到，尝试仅通过 gameId 查找（适用于中文版本没有 category_id 的情况）
  if (!game && gameId) {
    const tableName = dbLanguage === 'zh-CN' ? 'cn_games' : 'games';
    const { supabase } = require('./utils/supabase');
    if (supabase) {
      try {
        const { data: gameData, error } = await supabase
          .from(tableName)
          .select('*')
          .eq('id', parseInt(gameId))
          .single();
        
        if (!error && gameData) {
          game = {
            id: gameData.id,
            name: gameData.name,
            link: gameData.link || '',
            icon: gameData.icon || '',
            href: gameData.href || '',
            detail: gameData.detail || '',
            metadata: gameData.metadata || {}
          };
          
          // 如果游戏有 category_id，获取分类信息
          if (gameData.category_id) {
            const categoryItem = data.find(cat => cat.id === gameData.category_id);
            if (categoryItem) {
              originalGameCategory = categoryItem.category;
              gameCategory = categoryItem.category;
            }
          } else if (categoryId) {
            // 如果没有 category_id，但提供了 categoryId 参数，使用它
            const categoryItem = data.find(cat => cat.id === parseInt(categoryId));
            if (categoryItem) {
              originalGameCategory = categoryItem.category;
              gameCategory = categoryItem.category;
            }
          }
        }
      } catch (err) {
        console.error('Error fetching game by id only:', err);
      }
    }
  }
  
  // 如果通过id找不到，且提供了name参数（兼容旧链接）
  if (!game && gameName) {
    for (const categoryItem of data) {
      if (categoryItem.games && Array.isArray(categoryItem.games)) {
        const foundGame = categoryItem.games.find(g => g.name === gameName);
        if (foundGame) {
          game = foundGame;
          originalGameCategory = categoryItem.category;
          gameCategory = categoryItem.category;
          break;
        }
      }
    }
  }
  
  if (!game) {
    return res.status(404).send(locale === 'zh-CN' ? '游戏不存在' : 'Game not found');
  }
  
  // 生成游戏描述（从detail中提取前200字符）
  let gameDescription = '';
  let gameKeywords = '';
  
  if (game.detail) {
    // 提取描述：尝试提取第一段有意义的内容
    const detailLines = game.detail.split('\n').filter(line => line.trim());
    const firstParagraph = detailLines.find(line => 
      line.length > 50 && 
      !line.includes('Games»') && 
      !line.includes('Developer') &&
      !line.includes('Rating') &&
      !line.includes('Released')
    ) || detailLines[0] || game.detail.substring(0, 200);
    
    gameDescription = firstParagraph.substring(0, 160).replace(/\n/g, ' ').trim();
    if (gameDescription.length < 160 && game.detail.length > firstParagraph.length) {
      gameDescription += '...';
    }
    
    // 生成关键词
    const keywords = [game.name, gameCategory, 'ice breaker games', 'HTML5 games'];
    if (locale === 'zh-CN') {
      keywords.push('在线游戏', '免费游戏');
    }
    if (gameCategory) {
      keywords.push(gameCategory + ' games');
    }
    gameKeywords = keywords.join(', ');
  } else {
    gameDescription = t(locale, 'game.description', { gameName: game.name, categoryName: gameCategory || '' });
    gameKeywords = `${game.name}, ${gameCategory || ''}, ice breaker games, HTML5 games${locale === 'zh-CN' ? ', 在线游戏, 免费游戏' : ''}`;
  }
  
  // 如果描述为空，使用默认描述
  if (!gameDescription) {
    gameDescription = t(locale, 'game.description', { gameName: game.name, categoryName: gameCategory || '' });
  }
  
  const pageTitle = t(locale, 'game.title', { gameName: game.name });
  // 使用id生成canonical URL（SEO友好）
  const categoryIdForUrl = categoryId || (data.find(cat => cat.games && cat.games.some(g => g.id === game.id))?.id);
  const gameIdForUrl = gameId || game.id;
  const canonicalUrl = locale === DEFAULT_LOCALE 
    ? `https://www.icebreakgame.com/game?categoryId=${categoryIdForUrl}&gameId=${gameIdForUrl}`
    : `https://www.icebreakgame.com/${locale}/game?categoryId=${categoryIdForUrl}&gameId=${gameIdForUrl}`;
  
  // 翻译功能已移除，数据直接从 Supabase 获取对应语言版本
  
  // 渲染页面
  // 获取游戏评价
  let gameReviews = [];
  let averageRating = 0;
  let isFavorited = false;
  
  // 获取用户邮箱（从 cookie 中获取，因为登录状态存储在 cookie 中）
  const userEmailForFav = req.cookies && req.cookies.user_email;
  
  console.log('[Game Page] userEmailForFav:', userEmailForFav);
  console.log('[Game Page] gameIdForUrl:', gameIdForUrl);
  
  try {
    const { supabase } = require('./utils/supabase');
    if (supabase && gameIdForUrl) {
      // 获取评价
      const { data: reviews, error: reviewsError } = await supabase
        .from('game_reviews')
        .select('*')
        .eq('game_id', parseInt(gameIdForUrl))
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (!reviewsError && reviews) {
        gameReviews = reviews;
        // 计算平均评分
        if (reviews.length > 0) {
          const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
          averageRating = (totalRating / reviews.length).toFixed(1);
        }
      }
      
      // 检查当前用户是否已收藏
      if (userEmailForFav && gameIdForUrl) {
        console.log('[Game Page] Checking favorite status for:', userEmailForFav, 'gameId:', gameIdForUrl);
        const { data: favoriteData, error: favError } = await supabase
          .from('user_favorites')
          .select('id')
          .eq('user_email', userEmailForFav)
          .eq('game_id', parseInt(gameIdForUrl))
          .single();
        
        console.log('[Game Page] Favorite query result:', favoriteData, 'error:', favError);
        isFavorited = !!favoriteData;
      } else {
        console.log('[Game Page] Skipping favorite check - userEmailForFav:', userEmailForFav, 'gameIdForUrl:', gameIdForUrl);
      }
      
      // 记录游戏播放统计 - 每次加载页面都插入一条新记录
      if (gameIdForUrl) {
        const userEmail = userEmailForFav || null;
        
        console.log('[Game Play Stats] Processing - gameId:', gameIdForUrl, 'userEmail:', userEmail);
        
        // 检查是否已存在该游戏的统计记录
        const { data: existingStat } = await supabase
          .from('game_play_stats')
          .select('id, play_count')
          .eq('game_id', parseInt(gameIdForUrl))
          .single();
        
        if (existingStat) {
          // 已存在，更新 play_count + 1
          const { error: updateError } = await supabase
            .from('game_play_stats')
            .update({
              play_count: existingStat.play_count + 1,
              last_played_at: new Date().toISOString()
            })
            .eq('id', existingStat.id);
          
          if (updateError) {
            console.error('[Game Play Stats] Update error:', updateError);
          } else {
            console.log('[Game Play Stats] Updated play_count to', existingStat.play_count + 1);
          }
        } else {
          // 不存在，插入新记录
          const { data: insertData, error: insertError } = await supabase
            .from('game_play_stats')
            .insert([{
              game_id: parseInt(gameIdForUrl),
              user_email: userEmail,
              play_count: 1,
              last_played_at: new Date().toISOString()
            }]);
          
          if (insertError) {
            console.error('[Game Play Stats] Insert error:', insertError);
          } else {
            console.log('[Game Play Stats] Inserted new record');
          }
        }
      }
    } else {
      console.log('[Game Play Stats] Skipped - supabase or gameIdForUrl not available:', { 
        supabase: !!supabase, 
        gameIdForUrl: gameIdForUrl 
      });
    }
  } catch (reviewErr) {
    console.error('Error fetching game reviews:', reviewErr);
  }
  
  res.render('game', {
    game: game,
    gameName: game.name,
    gameCategory: gameCategory,
    originalGameCategory: originalGameCategory,
    categories: categories,
    pageTitle: pageTitle,
    gameDescription: gameDescription,
    gameKeywords: gameKeywords,
    canonicalUrl: canonicalUrl,
    categoryId: categoryIdForUrl,
    gameId: gameIdForUrl,
    locale: locale,
    gameReviews: gameReviews,
    averageRating: averageRating,
    isFavorited: isFavorited,
    isLoggedIn: !!userEmailForFav,
    userEmail: userEmailForFav || ''
  });
});

// SSR 路由：分类页面（分页显示，每页20个游戏）
createLocaleRoutes('/category', async (req, res) => {
  const locale = req.locale;
  const categoryId = req.query.categoryId;
  const page = parseInt(req.query.page) || 1;
  const searchQuery = (req.query.q || '').trim();
  const pageSize = 20;
  const dbLanguage = getDbLanguage(locale);
  
  console.log('[Category Page] categoryId:', categoryId);
  
  if (!categoryId) {
    return res.status(400).send(locale === 'zh-CN' ? '分类ID不能为空' : 'Category ID is required');
  }
  
  // 从 Supabase 获取数据
  const data = await getGameData(locale);
  const categories = await getCategoriesList(locale);
  
  // 获取游戏播放次数
  const allPlayCounts = await getGamesPlayCount();
  
  console.log('[Category] allPlayCounts 所有key:', Object.keys(allPlayCounts));
  
  // 根据分类ID查找分类数据
  let categoryData = data.find(item => item.id === parseInt(categoryId));
  
  if (!categoryData || !categoryData.games || categoryData.games.length === 0) {
    return res.status(404).send(locale === 'zh-CN' ? '分类不存在' : 'Category not found');
  }
  
  console.log('[Category] allPlayCounts:', JSON.stringify(allPlayCounts));
  console.log('[Category] 游戏ID和播放次数:');
  categoryData.games.forEach(game => {
    const key1 = game.id;
    const key2 = String(game.id);
    console.log(`  game.id: ${key1} (type: ${typeof key1}), keyStr: "${key2}", playCount: ${allPlayCounts[key1] ?? 'undefined'}, playCount2: ${allPlayCounts[key2] ?? 'undefined'}`);
  });
  
  // 获取翻译后的 category 名称用于显示
  const originalCategory = categoryData.category;
  const displayCategory = t(locale, `categories.${originalCategory}`, {}) !== `categories.${originalCategory}`
    ? t(locale, `categories.${originalCategory}`, {})
    : originalCategory;
  
  // 过滤游戏（支持搜索）
  let filteredGames = categoryData.games;
  if (searchQuery) {
    filteredGames = categoryData.games.filter(game => 
      game.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (game.detail && game.detail.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }
  
  // 计算分页
  const totalGames = filteredGames.length;
  const totalPages = Math.ceil(totalGames / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedGames = filteredGames.slice(startIndex, endIndex);
  
  // 生成分类描述和关键词
  const categoryDescription = t(locale, 'category.description', { categoryName: displayCategory, totalGames: totalGames });
  const categoryKeywords = `${displayCategory}, ${displayCategory} games, ice breaker games, HTML5 games${locale === 'zh-CN' ? ', 在线游戏, 免费游戏' : ''}`;
  
  res.render('category', {
    category: displayCategory,
    originalCategory: originalCategory, // 保存原始 category 用于 URL
    categoryId: categoryData.id, // 添加分类ID用于SEO友好的URL
    games: paginatedGames,
    playCounts: allPlayCounts,
    categories: categories,
    searchQuery: searchQuery,
    currentPage: currentPage,
    totalPages: totalPages,
    totalGames: totalGames,
    pageSize: pageSize,
    categoryDescription: categoryDescription,
    categoryKeywords: categoryKeywords
  });
});

// SSR 路由：关于我们页面
createLocaleRoutes('/about', (req, res) => {
  const locale = req.locale;
  res.render('about', {
    pageTitle: t(locale, 'about.title'),
    metaDescription: t(locale, 'about.description'),
    metaKeywords: 'ice breaker games, 关于我们, 传道游戏, 软件开发, AI技术, 数字化解决方案',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/about' : `https://www.icebreakgame.com/${locale}/about`,
    currentPage: 'about',
    locale: locale,
    supportedLocales: SUPPORTED_LOCALES
  });
});

// SSR 路由：联系我们页面
createLocaleRoutes('/contact', (req, res) => {
  const locale = req.locale;
  res.render('contact', {
    pageTitle: t(locale, 'contact.title'),
    metaDescription: t(locale, 'contact.subtitle'),
    metaKeywords: 'ice breaker games, 联系我们, 联系方式, 官方邮箱, 深圳龙华',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/contact' : `https://www.icebreakgame.com/${locale}/contact`,
    currentPage: 'contact',
    locale: locale,
    supportedLocales: SUPPORTED_LOCALES
  });
});

// SSR 路由：登录页面（邮箱 + 密码）
createLocaleRoutes('/login', (req, res) => {
  const locale = req.locale;
  const resetSuccess = req.query.reset === 'success';
  res.render('login', {
    pageTitle: t(locale, 'auth.loginTitle'),
    metaDescription: t(locale, 'auth.loginDescription'),
    metaKeywords: 'login, 登录, Ice Breaker Games',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
    currentPage: 'login',
    locale: locale,
    supportedLocales: SUPPORTED_LOCALES,
    errorMessage: '',
    successMessage: resetSuccess ? (locale === 'zh-CN' ? '密码修改成功，请使用新密码登录' : 'Password reset successfully. Please login with your new password.') : '',
    formData: {}
  });
});

// SSR 路由：注册页面
createLocaleRoutes('/register', (req, res) => {
  const locale = req.locale;
  res.render('register', {
    pageTitle: t(locale, 'auth.registerTitle'),
    metaDescription: t(locale, 'auth.registerDescription'),
    metaKeywords: 'register, 注册, Ice Breaker Games',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
    currentPage: 'register',
    locale: locale,
    supportedLocales: SUPPORTED_LOCALES,
    errorMessage: '',
    successMessage: '',
    formData: {}
  });
});

// SSR 路由：用户个人页面
createLocaleRoutes('/profile', async (req, res) => {
  const locale = req.locale;
  const userEmail = req.cookies && req.cookies.user_email;

  if (!userEmail) {
    // 未登录，重定向到登录页
    const redirectPath = locale === DEFAULT_LOCALE ? '/login' : `/${locale}/login`;
    return res.redirect(303, redirectPath);
  }

  try {
    const { supabase } = require('./utils/supabase');
    const data = await getGameData(locale);
    const categories = await getCategoriesList(locale);

    // 获取用户收藏的游戏
    const { data: favorites, error: favError } = await supabase
      .from('user_favorites')
      .select('game_id, created_at')
      .eq('user_email', userEmail);

    let favoriteGames = [];
    if (!favError && favorites && favorites.length > 0) {
      const gameIds = favorites.map(f => f.game_id);
      
      // 从所有游戏中筛选出收藏的游戏
      data.forEach(category => {
        category.games.forEach(game => {
          if (gameIds.includes(game.id)) {
            const favInfo = favorites.find(f => f.game_id === game.id);
            favoriteGames.push({
              ...game,
              favoritedAt: favInfo ? favInfo.created_at : null
            });
          }
        });
      });
    }

    // 获取用户统计信息
    const { data: playStats } = await supabase
      .from('game_play_stats')
      .select('game_id, play_count')
      .eq('user_email', userEmail);

    const totalPlayCount = playStats ? playStats.reduce((sum, stat) => sum + stat.play_count, 0) : 0;

    res.render('profile', {
      pageTitle: t(locale, 'profile.title'),
      metaDescription: t(locale, 'profile.description'),
      metaKeywords: 'profile, my games, favorites, 个人中心, 我的收藏',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/profile' : `https://www.icebreakgame.com/${locale}/profile`,
      currentPage: 'profile',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      userEmail: userEmail,
      favoriteGames: favoriteGames,
      totalPlayCount: totalPlayCount,
      categories: categories
    });
  } catch (err) {
    console.error('[Profile] Error:', err);
    res.redirect(303, locale === DEFAULT_LOCALE ? '/' : `/${locale}/`);
  }
});

// SSR 路由：忘记密码页面
createLocaleRoutes('/forgot-password', (req, res) => {
  const locale = req.locale;
  res.render('forgot-password', {
    pageTitle: t(locale, 'auth.forgotTitle'),
    metaDescription: t(locale, 'auth.forgotDescription'),
    metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
    currentPage: 'forgot-password',
    locale: locale,
    supportedLocales: SUPPORTED_LOCALES,
    errorMessage: '',
    successMessage: '',
    formData: {}
  });
});

// SSR 路由：隐私政策页面
createLocaleRoutes('/privacy', (req, res) => {
  const locale = req.locale;
  res.render('privacy', {
    pageTitle: t(locale, 'privacy.title'),
    metaDescription: t(locale, 'privacy.subtitle'),
    metaKeywords: 'ice breaker games, 隐私政策, 个人信息保护, 数据安全, 隐私权',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/privacy' : `https://www.icebreakgame.com/${locale}/privacy`,
    currentPage: 'privacy'
  });
});

// SSR 路由：服务条款页面
createLocaleRoutes('/terms', (req, res) => {
  const locale = req.locale;
  res.render('terms', {
    pageTitle: t(locale, 'terms.title'),
    metaDescription: t(locale, 'terms.subtitle'),
    metaKeywords: 'ice breaker games, 服务条款, 使用条款, 法律协议, 用户协议',
    canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/terms' : `https://www.icebreakgame.com/${locale}/terms`,
    currentPage: 'terms'
  });
});

// API 路由：获取所有数据
app.get('/api/games', async (req, res) => {
  const locale = req.query.locale || 'en';
  const data = await getGameData(locale);
  res.json(data);
});

// 兼容现有 UI：提供 crazy.json 接口
app.get('/crazy.json', async (req, res) => {
  const locale = req.query.locale || 'en';
  const data = await getGameData(locale);
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
});

// 兼容现有 UI：提供 pokigame.json 接口
app.get('/pokigame.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json([]);
});

// API 路由：获取 Poki 游戏数据
app.get('/api/pokigames', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json([]);
});

// API 路由：获取所有分类
app.get('/api/categories', async (req, res) => {
  const locale = req.query.locale || 'en';
  const categories = await getCategoriesList(locale);
  res.json(categories);
});

// API 路由：根据分类获取游戏
app.get('/api/games/:category', async (req, res) => {
  const locale = req.query.locale || 'en';
  const category = decodeURIComponent(req.params.category);
  const data = await getGameData(locale);
  const filtered = data.filter(item => item.category === category);
  res.json(filtered);
});

// API 路由：搜索游戏
app.get('/api/search', async (req, res) => {
  const query = req.query.q || '';
  const locale = req.query.locale || 'en';
  const dbLanguage = getDbLanguage(locale);
  
  if (!query) {
    return res.json([]);
  }
  
  // 使用 Supabase 搜索
  const games = await searchGames(query, dbLanguage);
  const categoriesList = await getSupabaseCategories(dbLanguage);
  const categoriesMap = {};
  categoriesList.forEach(cat => {
    categoriesMap[cat.id] = cat.name;
  });
  
  const results = games.map(game => ({
    id: game.id,
    name: game.name,
    link: game.link || '',
    icon: game.icon || '',
    href: game.href || '',
    detail: game.detail || '',
    category: categoriesMap[game.category_id] || '',
    categoryId: game.category_id
  }));
  
  res.json(results);
});

// API 路由：提交联系表单
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  
  // 验证必填字段
  if (!name || !email || !message) {
    return res.status(400).json({ 
      success: false, 
      message: '请填写所有必填字段' 
    });
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      success: false, 
      message: '请输入有效的邮箱地址' 
    });
  }
  
  try {
    const { supabase } = require('./utils/supabase');
    
    if (!supabase) {
      console.error('[Contact API] Supabase client not initialized');
      return res.status(500).json({ 
        success: false, 
        message: '服务暂时不可用，请稍后重试' 
      });
    }
    
    // 保存到 Supabase
    const { data, error } = await supabase
      .from('contact_messages')
      .insert([
        {
          name: name.trim(),
          email: email.trim(),
          topic: subject || 'general',
          message: message.trim()
        }
      ]);
    
    if (error) {
      console.error('[Contact API] Error saving message:', error);
      return res.status(500).json({ 
        success: false, 
        message: '保存消息失败，请稍后重试' 
      });
    }
    
    console.log('[Contact API] Message saved successfully:', { name, email, subject });
    
    res.json({ 
      success: true, 
      message: '消息已发送成功！我们会尽快回复您。' 
    });
  } catch (error) {
    console.error('[Contact API] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: '发送失败，请稍后重试' 
    });
  }
});

// API 路由：邮箱登录（使用 Supabase Auth）
app.post('/login', async (req, res) => {
  const locale = req.locale || DEFAULT_LOCALE;
  const { email, password } = req.body;

  // 基本校验
  if (!email || !password) {
    return res.status(400).render('login', {
      pageTitle: t(locale, 'auth.loginTitle'),
      metaDescription: t(locale, 'auth.loginDescription'),
      metaKeywords: 'login, 登录, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
      currentPage: 'login',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorRequired'),
      successMessage: '',
      formData: { email }
    });
  }

  try {
    const { supabase } = require('./utils/supabase');
    const bcrypt = require('bcrypt');

    if (!supabase) {
      console.error('[Auth] Supabase client not initialized');
      return res.status(500).render('login', {
        pageTitle: t(locale, 'auth.loginTitle'),
        metaDescription: t(locale, 'auth.loginDescription'),
        metaKeywords: 'login, 登录, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
        currentPage: 'login',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorServer'),
        successMessage: '',
        formData: { email }
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, password_hash')
      .eq('email', email.trim().toLowerCase())
      .single();

    console.log('[Auth] Login attempt:', { email: email.trim() });

    if (userError || !user) {
      console.error('[Auth] User not found:', email.trim());
      return res.status(401).render('login', {
        pageTitle: t(locale, 'auth.loginTitle'),
        metaDescription: t(locale, 'auth.loginDescription'),
        metaKeywords: 'login, 登录, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
        currentPage: 'login',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorInvalid'),
        successMessage: '',
        formData: { email }
      });
    }

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      console.error('[Auth] Invalid password for:', email.trim());
      return res.status(401).render('login', {
        pageTitle: t(locale, 'auth.loginTitle'),
        metaDescription: t(locale, 'auth.loginDescription'),
        metaKeywords: 'login, 登录, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
        currentPage: 'login',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorInvalid'),
        successMessage: '',
        formData: { email }
      });
    }

    // 简单保存登录邮箱到 Cookie，方便前端显示“已登录”
    const isSecure = req.secure || (req.headers['x-forwarded-proto'] === 'https');
    res.cookie('user_email', user.email, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      secure: !!isSecure
    });

    console.log('[Auth] Login success for:', user.email);

    // 登录成功后重定向到首页（带语言前缀）
    const redirectPath = locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
    return res.redirect(303, redirectPath);
  } catch (err) {
    console.error('[Auth] Unexpected error:', err);
    return res.status(500).render('login', {
      pageTitle: t(locale, 'auth.loginTitle'),
      metaDescription: t(locale, 'auth.loginDescription'),
      metaKeywords: 'login, 登录, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/login' : `https://www.icebreakgame.com/${locale}/login`,
      currentPage: 'login',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorServer'),
      successMessage: '',
      formData: { email }
    });
  }
});

// 退出登录
app.get('/logout', (req, res) => {
  // 清除用户邮箱 cookie
  res.clearCookie('user_email', { path: '/' });
  
  // 重定向到首页
  const locale = req.locale || DEFAULT_LOCALE;
  const redirectPath = locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
  res.redirect(303, redirectPath);
});

// API 路由：注册（使用自定义用户表）
app.post('/register', async (req, res) => {
  const locale = req.locale || DEFAULT_LOCALE;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).render('register', {
      pageTitle: t(locale, 'auth.registerTitle'),
      metaDescription: t(locale, 'auth.registerDescription'),
      metaKeywords: 'register, 注册, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
      currentPage: 'register',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorRequired'),
      successMessage: '',
      formData: { email }
    });
  }

  if (password.length < 6) {
    return res.status(400).render('register', {
      pageTitle: t(locale, 'auth.registerTitle'),
      metaDescription: t(locale, 'auth.registerDescription'),
      metaKeywords: 'register, 注册, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
      currentPage: 'register',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorPasswordShort'),
      successMessage: '',
      formData: { email }
    });
  }

  try {
    const { supabase } = require('./utils/supabase');
    const bcrypt = require('bcrypt');

    if (!supabase) {
      console.error('[Auth] Supabase client not initialized');
      return res.status(500).render('register', {
        pageTitle: t(locale, 'auth.registerTitle'),
        metaDescription: t(locale, 'auth.registerDescription'),
        metaKeywords: 'register, 注册, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
        currentPage: 'register',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorServer'),
        successMessage: '',
        formData: { email }
      });
    }

    console.log('[Auth] Register attempt:', { email: email.trim() });

    // 检查邮箱是否已存在
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (existingUser) {
      console.error('[Auth] Email already exists:', email.trim());
      return res.status(400).render('register', {
        pageTitle: t(locale, 'auth.registerTitle'),
        metaDescription: t(locale, 'auth.registerDescription'),
        metaKeywords: 'register, 注册, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
        currentPage: 'register',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorEmailExists'),
        successMessage: '',
        formData: { email }
      });
    }

    // 密码哈希
    const passwordHash = await bcrypt.hash(password, 10);

    // 插入新用户
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{
        email: email.trim().toLowerCase(),
        password_hash: passwordHash
      }])
      .select()
      .single();

    if (insertError) {
      console.error('[Auth] Insert user error:', insertError);
      return res.status(500).render('register', {
        pageTitle: t(locale, 'auth.registerTitle'),
        metaDescription: t(locale, 'auth.registerDescription'),
        metaKeywords: 'register, 注册, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
        currentPage: 'register',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorServer'),
        successMessage: '',
        formData: { email }
      });
    }

    console.log('[Auth] User registered successfully:', email.trim());

    // 自动登录
    const isSecure = req.secure || (req.headers['x-forwarded-proto'] === 'https');
    res.cookie('user_email', newUser.email, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      secure: !!isSecure
    });

    console.log('[Auth] Auto login success for:', newUser.email);
    const redirectPath = locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
    return res.redirect(303, redirectPath);
  } catch (err) {
    console.error('[Auth] Unexpected register error:', err);
    return res.status(500).render('register', {
      pageTitle: t(locale, 'auth.registerTitle'),
      metaDescription: t(locale, 'auth.registerDescription'),
      metaKeywords: 'register, 注册, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/register' : `https://www.icebreakgame.com/${locale}/register`,
      currentPage: 'register',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorServer'),
      successMessage: '',
      formData: { email }
    });
  }
});

// API 路由：忘记密码（直接修改密码）
app.post('/forgot-password', async (req, res) => {
  const locale = req.locale || DEFAULT_LOCALE;
  const { email, password, confirmPassword } = req.body;

  // 验证必填字段
  if (!email || !password || !confirmPassword) {
    return res.status(400).render('forgot-password', {
      pageTitle: t(locale, 'auth.forgotTitle'),
      metaDescription: t(locale, 'auth.forgotDescription'),
      metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
      currentPage: 'forgot-password',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorRequired'),
      successMessage: '',
      formData: { email }
    });
  }

  // 验证密码匹配
  if (password !== confirmPassword) {
    return res.status(400).render('forgot-password', {
      pageTitle: t(locale, 'auth.forgotTitle'),
      metaDescription: t(locale, 'auth.forgotDescription'),
      metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
      currentPage: 'forgot-password',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: locale === 'zh-CN' ? '两次输入的密码不一致' : 'Passwords do not match',
      successMessage: '',
      formData: { email }
    });
  }

  // 验证密码长度
  if (password.length < 6) {
    return res.status(400).render('forgot-password', {
      pageTitle: t(locale, 'auth.forgotTitle'),
      metaDescription: t(locale, 'auth.forgotDescription'),
      metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
      currentPage: 'forgot-password',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: locale === 'zh-CN' ? '密码长度至少6位' : 'Password must be at least 6 characters',
      successMessage: '',
      formData: { email }
    });
  }

  try {
    const { supabase } = require('./utils/supabase');

    if (!supabase) {
      console.error('[Auth] Supabase client not initialized');
      return res.status(500).render('forgot-password', {
        pageTitle: t(locale, 'auth.forgotTitle'),
        metaDescription: t(locale, 'auth.forgotDescription'),
        metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
        currentPage: 'forgot-password',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorServer'),
        successMessage: '',
        formData: { email }
      });
    }

    // 检查用户是否存在
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (checkError || !existingUser) {
      console.error('[Auth] User not found for password reset:', email);
      return res.status(400).render('forgot-password', {
        pageTitle: t(locale, 'auth.forgotTitle'),
        metaDescription: t(locale, 'auth.forgotDescription'),
        metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
        currentPage: 'forgot-password',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: locale === 'zh-CN' ? '该邮箱未注册' : 'This email is not registered',
        successMessage: '',
        formData: { email }
      });
    }

    // 使用 bcrypt 加密密码
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    // 更新密码
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: hashedPassword, updated_at: new Date().toISOString() })
      .eq('email', email.trim().toLowerCase());

    if (updateError) {
      console.error('[Auth] Password reset error:', updateError);
      return res.status(500).render('forgot-password', {
        pageTitle: t(locale, 'auth.forgotTitle'),
        metaDescription: t(locale, 'auth.forgotDescription'),
        metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
        canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
        currentPage: 'forgot-password',
        locale: locale,
        supportedLocales: SUPPORTED_LOCALES,
        errorMessage: t(locale, 'auth.errorServer'),
        successMessage: '',
        formData: { email }
      });
    }

    console.log('[Auth] Password reset success for:', email);

    // 跳转到登录页并显示成功消息
    const loginUrl = locale === DEFAULT_LOCALE ? '/login' : `/${locale}/login`;
    return res.redirect(303, `${loginUrl}?reset=success`);
  } catch (err) {
    console.error('[Auth] Unexpected forgot-password error:', err);
    return res.status(500).render('forgot-password', {
      pageTitle: t(locale, 'auth.forgotTitle'),
      metaDescription: t(locale, 'auth.forgotDescription'),
      metaKeywords: 'forgot password, 重置密码, Ice Breaker Games',
      canonicalUrl: locale === DEFAULT_LOCALE ? 'https://www.icebreakgame.com/forgot-password' : `https://www.icebreakgame.com/${locale}/forgot-password`,
      currentPage: 'forgot-password',
      locale: locale,
      supportedLocales: SUPPORTED_LOCALES,
      errorMessage: t(locale, 'auth.errorServer'),
      successMessage: '',
      formData: { email }
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📄 SSR 页面:`);
  console.log(`  - GET / - 主页（服务端渲染）`);
  console.log(`  - GET /search?q=关键词 - 搜索页面（服务端渲染）`);
  console.log(`  - GET /category/:category - 分类页面（服务端渲染）`);
  console.log(`  - GET /game?categoryId=分类ID&gameId=游戏ID - 游戏详情页面（服务端渲染）`);
  console.log(`  - GET /about - 关于我们页面（服务端渲染）`);
  console.log(`  - GET /contact - 联系我们页面（服务端渲染）`);
  console.log(`  - GET /privacy - 隐私政策页面（服务端渲染）`);
  console.log(`  - GET /terms - 服务条款页面（服务端渲染）`);
  console.log(`📡 API 接口:`);
  console.log(`  - GET /api/games - 获取所有游戏数据`);
  console.log(`  - GET /api/categories - 获取所有分类`);
  console.log(`  - GET /api/search?q=关键词 - 搜索游戏`);
  console.log(`  - GET /crazy.json - 兼容接口`);
  console.log(`📋 其他:`);
  console.log(`  - GET /robots.txt - 搜索引擎爬虫规则文件`);
  console.log(`  - GET /sitemap.xml - 网站地图文件（SEO）`);
  console.log(`  - GET /ads.txt - 广告联盟验证文件`);
});

// API 路由：获取游戏评价
app.get('/api/game-reviews', async (req, res) => {
  const gameId = req.query.gameId;
  
  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required' });
  }
  
  try {
    const { supabase } = require('./utils/supabase');
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    const { data: reviews, error } = await supabase
      .from('game_reviews')
      .select('*')
      .eq('game_id', parseInt(gameId))
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) {
      console.error('Error fetching reviews:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // 计算平均评分
    let averageRating = 0;
    if (reviews && reviews.length > 0) {
      const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
      averageRating = (totalRating / reviews.length).toFixed(1);
    }
    
    res.json({ reviews: reviews || [], averageRating });
  } catch (err) {
    console.error('Error in /api/game-reviews:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 路由：提交游戏评价
app.post('/api/game-reviews', async (req, res) => {
  const { gameId, rating, comment, userEmail } = req.body;
  
  if (!gameId || !rating) {
    return res.status(400).json({ error: 'Game ID and rating are required' });
  }
  
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  
  if (!userEmail) {
    return res.status(401).json({ error: 'Please login to submit a review' });
  }
  
  try {
    const { supabase } = require('./utils/supabase');
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    const { data, error } = await supabase
      .from('game_reviews')
      .insert([
        {
          game_id: parseInt(gameId),
          rating: parseInt(rating),
          comment: comment || '',
          user_email: userEmail,
          created_at: new Date().toISOString()
        }
      ]);
    
    if (error) {
      console.error('Error submitting review:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (err) {
    console.error('Error in /api/game-reviews (POST):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 路由：获取用户收藏列表
app.get('/api/favorites', async (req, res) => {
  if (!req.session || !req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: 'Please login first' });
  }
  
  const userEmail = req.session.user.email;
  
  try {
    const { supabase } = require('./utils/supabase');
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    const { data: favorites, error } = await supabase
      .from('user_favorites')
      .select('*, games(name, icon, link, href)')
      .eq('user_email', userEmail)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching favorites:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ favorites: favorites || [] });
  } catch (err) {
    console.error('Error in /api/favorites:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 路由：添加收藏
app.post('/api/favorites', async (req, res) => {
  console.log('[API Favorite POST] Request received');
  console.log('[API Favorite POST] Cookies:', req.cookies);
  console.log('[API Favorite POST] user_email cookie:', req.cookies?.user_email);
  
  const userEmail = req.cookies?.user_email;
  if (!userEmail) {
    console.log('[API Favorite POST] Not logged in - no user_email cookie');
    return res.status(401).json({ error: 'Please login first' });
  }
  
  const { gameId } = req.body;
  
  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required' });
  }

  try {
    const { supabase } = require('./utils/supabase');
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    console.log('[API Favorite POST] Adding favorite for:', userEmail, 'gameId:', gameId);
    
    // 检查是否已收藏
    const { data: existing } = await supabase
      .from('user_favorites')
      .select('id')
      .eq('user_email', userEmail)
      .eq('game_id', parseInt(gameId))
      .single();
    
    if (existing) {
      console.log('[API Favorite POST] Already favorited');
      return res.json({ success: true, message: 'Already favorited', isFavorited: true });
    }
    
    const { data, error } = await supabase
      .from('user_favorites')
      .insert([
        {
          user_email: userEmail,
          game_id: parseInt(gameId),
          created_at: new Date().toISOString()
        }
      ]);
    
    if (error) {
      console.error('[API Favorite POST] Error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    console.log('[API Favorite POST] Success');
    res.json({ success: true, message: 'Added to favorites', isFavorited: true });
  } catch (err) {
    console.error('[API Favorite POST] Catch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 路由：删除收藏
app.delete('/api/favorites', async (req, res) => {
  console.log('[API Favorite DELETE] Request received');
  console.log('[API Favorite DELETE] user_email cookie:', req.cookies?.user_email);
  
  const userEmail = req.cookies?.user_email;
  if (!userEmail) {
    console.log('[API Favorite DELETE] Not logged in - no user_email cookie');
    return res.status(401).json({ error: 'Please login first' });
  }
  
  const { gameId } = req.body;
  
  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required' });
  }

  try {
    const { supabase } = require('./utils/supabase');
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    console.log('[API Favorite DELETE] Removing favorite for:', userEmail, 'gameId:', gameId);
    
    const { error } = await supabase
      .from('user_favorites')
      .delete()
      .eq('user_email', userEmail)
      .eq('game_id', parseInt(gameId));
    
    if (error) {
      console.error('[API Favorite DELETE] Error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    console.log('[API Favorite DELETE] Success');
    res.json({ success: true, message: 'Removed from favorites', isFavorited: false });
  } catch (err) {
    console.error('[API Favorite DELETE] Catch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
