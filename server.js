const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const { getCategoryIcon } = require('./utils/helpers');
const { t, detectLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } = require('./utils/i18n');
const { translateLongText } = require('./utils/translate');

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
    
    // 移除现有的语言前缀
    let cleanPath = pathname;
    for (const loc of SUPPORTED_LOCALES) {
      if (cleanPath.startsWith(`/${loc}/`)) {
        cleanPath = cleanPath.replace(`/${loc}/`, '/');
        break;
      } else if (cleanPath === `/${loc}`) {
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
    
    res.redirect(redirectUrl);
  } else {
    res.redirect(referer.startsWith('http') ? referer : '/');
  }
});

// 读取并解析 data.json（缓存数据以提高性能）
let cachedGameData = null;
let dataCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

function getGameData() {
  const now = Date.now();
  
  // 如果缓存有效，直接返回
  if (cachedGameData && dataCacheTime && (now - dataCacheTime) < CACHE_DURATION) {
    return cachedGameData;
  }
  
  try {
    const dataPath = path.join(__dirname, 'data.json');
    const data = fs.readFileSync(dataPath, 'utf8');
    cachedGameData = JSON.parse(data);
    dataCacheTime = now;
    return cachedGameData;
  } catch (error) {
    console.error('Error reading data.json:', error);
    return [];
  }
}

// 将所有分类传给视图
function getCategories(data) {
  return [...new Set(data.map(item => item.category))].filter(Boolean);
}

// 翻译 category 数据
function translateCategories(data, locale) {
  if (!data || !Array.isArray(data)) return data;
  
  return data.map(item => {
    if (item.category) {
      // 保存原始 category
      const originalCategory = item.originalCategory || item.category;
      
      const translatedCategory = t(locale, `categories.${originalCategory}`, {});
      // 如果没有找到翻译，返回原值
      const finalCategory = translatedCategory === `categories.${originalCategory}` 
        ? originalCategory 
        : translatedCategory;
      
      return {
        ...item,
        category: finalCategory,
        originalCategory: originalCategory // 始终保存原始的英文 category
      };
    }
    return item;
  });
}

// 多语言中间件：检测和设置语言
app.use((req, res, next) => {
  // 从 URL 路径中提取语言代码（如果存在）
  const pathLocale = req.path.split('/')[1];
  let locale = pathLocale && SUPPORTED_LOCALES.includes(pathLocale) ? pathLocale : null;
  
  // 如果没有在 URL 中，则使用检测逻辑
  if (!locale) {
    locale = detectLocale(req);
  }
  
  // 将语言代码存储到 req 和 res.locals
  req.locale = locale;
  res.locals.locale = locale;
  res.locals.supportedLocales = SUPPORTED_LOCALES;
  res.locals.defaultLocale = DEFAULT_LOCALE;
  
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
    
    // 如果第一个部分是语言代码，移除它
    if (pathParts.length > 0 && SUPPORTED_LOCALES.includes(pathParts[0])) {
      pathParts.shift();
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
createLocaleRoutes('/', (req, res) => {
  const data = getGameData();
  const locale = req.locale;
  
  // 翻译 categories 用于显示
  const translatedData = translateCategories(data, locale);
  const categories = getCategories(translatedData);
  
  res.render('index', {
    gameData: translatedData,
    categories: categories,
    searchQuery: '',
    pageTitle: t(locale, 'home.title'),
    metaDescription: t(locale, 'home.description'),
    metaKeywords: t(locale, 'home.keywords')
  });
});

// SSR 路由：搜索页面
createLocaleRoutes('/search', (req, res) => {
  const locale = req.locale;
  const query = req.query.q || '';
  const data = getGameData();
  const translatedData = translateCategories(data, locale);
  const categories = getCategories(translatedData);
  
  let searchResults = [];
  
  if (query) {
    data.forEach(categoryItem => {
      if (categoryItem.games && Array.isArray(categoryItem.games)) {
        const translatedCategory = t(locale, `categories.${categoryItem.category}`, {}) !== `categories.${categoryItem.category}`
          ? t(locale, `categories.${categoryItem.category}`, {})
          : categoryItem.category;
        categoryItem.games.forEach(game => {
          if (game.name.toLowerCase().includes(query.toLowerCase()) || 
              (game.detail && game.detail.toLowerCase().includes(query.toLowerCase()))) {
            searchResults.push({
              ...game,
              category: translatedCategory,
              originalCategory: categoryItem.category
            });
          }
        });
      }
    });
  }
  
  res.render('search', {
    searchQuery: query,
    searchResults: searchResults,
    categories: categories
  });
});

// SSR 路由：游戏详情页面
createLocaleRoutes('/game', async (req, res) => {
  const locale = req.locale;
  const gameName = req.query.name;
  if (!gameName) {
    return res.status(400).send(locale === 'zh-CN' ? '游戏名称不能为空' : 'Game name cannot be empty');
  }
  
  const data = getGameData();
  const categories = getCategories(translateCategories(data, locale));
  
  // 查找游戏
  let game = null;
  let originalGameCategory = req.query.category || '';
  let gameCategory = '';
  
  for (const categoryItem of data) {
    if (categoryItem.games && Array.isArray(categoryItem.games)) {
      const foundGame = categoryItem.games.find(g => g.name === gameName);
      if (foundGame) {
        game = foundGame;
        originalGameCategory = categoryItem.category;
        // 翻译 category 用于显示
        const translated = t(locale, `categories.${categoryItem.category}`, {});
        gameCategory = translated !== `categories.${categoryItem.category}` ? translated : categoryItem.category;
        break;
      }
    }
  }
  
  // 如果通过 category 参数查找不到，尝试匹配翻译后的 category
  if (!game && originalGameCategory) {
    for (const categoryItem of data) {
      const translated = t(locale, `categories.${categoryItem.category}`, {});
      if (translated === originalGameCategory || categoryItem.category === originalGameCategory) {
        if (categoryItem.games && Array.isArray(categoryItem.games)) {
          const foundGame = categoryItem.games.find(g => g.name === gameName);
          if (foundGame) {
            game = foundGame;
            originalGameCategory = categoryItem.category;
            gameCategory = translated !== `categories.${categoryItem.category}` ? translated : categoryItem.category;
            break;
          }
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
  const canonicalUrl = locale === DEFAULT_LOCALE 
    ? `https://www.icebreakgame.com/game?name=${encodeURIComponent(game.name)}`
    : `https://www.icebreakgame.com/${locale}/game?name=${encodeURIComponent(game.name)}`;
  
  // 翻译游戏详情（如果是中文语言环境且 detail 是英文）
  // 注意：可以通过环境变量 ENABLE_TRANSLATION=false 来禁用翻译功能
  const enableTranslation = process.env.ENABLE_TRANSLATION !== 'false';
  let finalGame = game;
  
  if (enableTranslation && locale === 'zh-CN' && game.detail) {
    console.log(`[Translation] Starting translation for game: ${game.name}, detail length: ${game.detail.length}`);
    try {
      // 异步翻译 detail，设置超时时间为15秒
      const translatedDetail = await Promise.race([
        translateLongText(game.detail, locale),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Translation timeout')), 15000)
        )
      ]);
      
      console.log(`[Translation] Translation completed for game: ${game.name}`);
      console.log(`[Translation] Original length: ${game.detail.length}, Translated length: ${translatedDetail ? translatedDetail.length : 0}`);
      
      if (translatedDetail && translatedDetail !== game.detail && translatedDetail.length > 0) {
        finalGame = { ...game, detail: translatedDetail };
        console.log(`[Translation] Using translated text for game: ${game.name}`);
        
        // 如果 gameDescription 也是从 detail 提取的，重新生成
        const detailLines = translatedDetail.split('\n').filter(line => line.trim());
        const firstParagraph = detailLines.find(line => 
          line.length > 50 && 
          !line.includes('Games»') && 
          !line.includes('Developer') &&
          !line.includes('Rating') &&
          !line.includes('Released')
        ) || detailLines[0] || translatedDetail.substring(0, 200);
        
        gameDescription = firstParagraph.substring(0, 160).replace(/\n/g, ' ').trim();
        if (gameDescription.length < 160 && translatedDetail.length > firstParagraph.length) {
          gameDescription += '...';
        }
      } else {
        console.log(`[Translation] Translation result is same as original or empty, using original`);
      }
    } catch (err) {
      console.error(`[Translation] Error for game: ${game.name} - ${err.message}`);
      console.error(`[Translation] Stack: ${err.stack}`);
      console.log('[Translation] Using original text instead');
      // 翻译失败时使用原文，不抛出错误
    }
  } else {
    if (!enableTranslation) {
      console.log(`[Translation] Translation disabled by ENABLE_TRANSLATION=false`);
    } else if (locale !== 'zh-CN') {
      console.log(`[Translation] Translation skipped, locale is ${locale}, not zh-CN`);
    } else if (!game.detail) {
      console.log(`[Translation] Translation skipped, game.detail is empty`);
    }
  }
  
  // 渲染页面（无论是翻译后的还是原文）
  res.render('game', {
    game: finalGame,
    gameName: finalGame.name,
    gameCategory: gameCategory,
    originalGameCategory: originalGameCategory,
    categories: categories,
    pageTitle: pageTitle,
    gameDescription: gameDescription,
    gameKeywords: gameKeywords,
    canonicalUrl: canonicalUrl
  });
});

// SSR 路由：分类页面（分页显示，每页20个游戏）
createLocaleRoutes('/category/:category', (req, res) => {
  const locale = req.locale;
  const categoryParam = decodeURIComponent(req.params.category);
  const page = parseInt(req.query.page) || 1;
  const searchQuery = (req.query.q || '').trim();
  const pageSize = 20;
  
  const data = getGameData();
  // 首先尝试用参数直接查找（可能是英文或中文）
  let categoryData = data.find(item => item.category === categoryParam);
  
  // 如果找不到，尝试反向查找：可能是中文 category，需要找到对应的英文
  if (!categoryData) {
    // 遍历所有 category，看翻译后的名称是否匹配
    for (const item of data) {
      const translated = t(locale, `categories.${item.category}`, {});
      if (translated !== `categories.${item.category}` && translated === categoryParam) {
        categoryData = item;
        break;
      }
    }
  }
  
  // 如果还是找不到，尝试从英文翻译过来匹配
  if (!categoryData) {
    // 遍历翻译映射，找到对应的英文 category
    const dataTranslated = translateCategories(data, locale);
    const foundItem = dataTranslated.find(item => item.category === categoryParam);
    if (foundItem) {
      categoryData = data.find(item => item.originalCategory === foundItem.originalCategory || item.category === foundItem.originalCategory);
    }
  }
  
  const categories = getCategories(translateCategories(data, locale));
  
  if (!categoryData || !categoryData.games || categoryData.games.length === 0) {
    return res.status(404).send(locale === 'zh-CN' ? '分类不存在' : 'Category not found');
  }
  
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
    games: paginatedGames,
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
    currentPage: 'about'
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
    currentPage: 'contact'
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
app.get('/api/games', (req, res) => {
  const data = getGameData();
  res.json(data);
});

// 兼容现有 UI：提供 crazy.json 接口
app.get('/crazy.json', (req, res) => {
  const data = getGameData();
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
app.get('/api/categories', (req, res) => {
  const data = getGameData();
  const categories = getCategories(data);
  res.json(categories);
});

// API 路由：根据分类获取游戏
app.get('/api/games/:category', (req, res) => {
  const data = getGameData();
  const category = decodeURIComponent(req.params.category);
  const filtered = data.filter(item => item.category === category);
  res.json(filtered);
});

// API 路由：搜索游戏
app.get('/api/search', (req, res) => {
  const query = req.query.q || '';
  const data = getGameData();
  
  if (!query) {
    return res.json([]);
  }
  
  const results = [];
  data.forEach(categoryItem => {
    if (categoryItem.games && Array.isArray(categoryItem.games)) {
      categoryItem.games.forEach(game => {
        if (game.name.toLowerCase().includes(query.toLowerCase()) || 
            (game.detail && game.detail.toLowerCase().includes(query.toLowerCase()))) {
          results.push({
            ...game,
            category: categoryItem.category
          });
        }
      });
    }
  });
  
  res.json(results);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📄 SSR 页面:`);
  console.log(`  - GET / - 主页（服务端渲染）`);
  console.log(`  - GET /search?q=关键词 - 搜索页面（服务端渲染）`);
  console.log(`  - GET /category/:category - 分类页面（服务端渲染）`);
  console.log(`  - GET /game?name=游戏名 - 游戏详情页面（服务端渲染）`);
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
