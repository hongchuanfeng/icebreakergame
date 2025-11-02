# 多语言功能实现原理说明

## 一、整体架构设计

### 1.1 核心思路
本项目采用 **URL 路径前缀 + Cookie + 浏览器语言检测** 的混合多语言方案，实现服务端渲染（SSR）的多语言支持。

### 1.2 支持的语言
- **英文（en）**：默认语言，URL 不带前缀
- **中文（zh-CN）**：中文版本，URL 前缀为 `/zh-CN/`

## 二、实现原理详解

### 2.1 文件结构
```
项目根目录/
├── locales/                    # 语言文件目录
│   ├── en.json                 # 英文翻译文件
│   └── zh-CN.json              # 中文翻译文件
├── utils/
│   └── i18n.js                 # 多语言工具模块
└── server.js                   # Express 服务器（已集成多语言中间件）
```

### 2.2 语言检测优先级

语言检测采用以下优先级顺序：

1. **URL 路径前缀**（最高优先级）
   - 访问 `/zh-CN/about` → 使用中文
   - 访问 `/en/about` → 使用英文
   - 访问 `/about` → 进入下一级检测

2. **Cookie 值**
   - 检查浏览器 Cookie 中的 `locale` 值
   - 如果存在且有效，使用该语言

3. **浏览器 Accept-Language 头**
   - 解析 HTTP 请求头中的 `Accept-Language`
   - 自动匹配支持的语言（如 `zh-CN`、`zh` → 中文，`en` → 英文）

4. **默认语言**
   - 如果以上都未匹配，使用默认语言（英文 `en`）

### 2.3 核心实现模块

#### 2.3.1 语言工具模块 (`utils/i18n.js`)

**功能：**
- 加载和管理语言文件
- 提供翻译函数 `t(locale, key, params)`
- 实现语言检测逻辑
- 支持语言文件缓存机制

**关键函数：**

```javascript
// 加载语言文件（带缓存）
loadLocale(locale)

// 翻译函数（支持嵌套键和参数替换）
t(locale, key, params)
// 示例：t('zh-CN', 'common.home') → "首页"
// 示例：t('en', 'category.gamesFound', {count: 20}) → "Total 20 games"

// 语言检测（多级检测）
detectLocale(req)
```

#### 2.3.2 中间件设计

在 `server.js` 中实现多语言中间件：

```javascript
app.use((req, res, next) => {
  // 1. 从 URL 提取语言代码
  const pathLocale = req.path.split('/')[1];
  
  // 2. 如果 URL 中没有，使用检测逻辑
  let locale = pathLocale && SUPPORTED_LOCALES.includes(pathLocale) 
    ? pathLocale 
    : detectLocale(req);
  
  // 3. 存储到 req 和 res.locals
  req.locale = locale;
  res.locals.locale = locale;
  
  // 4. 提供模板可用的翻译函数
  res.locals.t = function(key, params) {
    return t(locale, key, params);
  };
  
  // 5. 提供语言化 URL 生成函数
  res.locals.localeUrl = function(path) {
    // 生成带语言前缀的 URL
  };
  
  next();
});
```

### 2.4 路由设计

#### 2.4.1 语言化路由辅助函数

```javascript
function createLocaleRoutes(basePath, handler) {
  // 默认路由（使用检测到的语言）
  app.get(basePath, handler);
  
  // 为每个支持的语言创建带前缀的路由
  SUPPORTED_LOCALES.forEach(locale => {
    app.get(`/${locale}${basePath}`, handler);
  });
}
```

**示例：**
- `createLocaleRoutes('/', handler)` 会创建：
  - `GET /` → 使用检测到的语言
  - `GET /en` → 英文版本
  - `GET /zh-CN` → 中文版本

#### 2.4.2 语言切换路由

```javascript
app.get('/set-locale/:locale', (req, res) => {
  // 1. 验证语言代码
  // 2. 设置 Cookie（有效期 1 年）
  // 3. 从 Referer 获取当前页面 URL
  // 4. 替换或添加语言前缀
  // 5. 重定向到新 URL
});
```

**使用示例：**
- 访问 `/set-locale/zh-CN` → 设置中文 Cookie，重定向到当前页面的中文版本

## 三、模板使用

### 3.1 翻译函数使用

在 EJS 模板中使用 `t()` 函数：

```ejs
<!-- 基本用法 -->
<%= t('common.home') %>

<!-- 带参数 -->
<%= t('category.gamesFound', {count: totalGames}) %>

<!-- 嵌套键 -->
<%= t('contact.subjects.general') %>
```

### 3.2 URL 生成

使用 `localeUrl()` 函数生成语言化的 URL：

```ejs
<a href="<%= localeUrl('/about') %>">关于我们</a>
<!-- 当前语言为 zh-CN 时生成: /zh-CN/about -->
<!-- 当前语言为 en 时生成: /about -->
```

### 3.3 语言切换器

在模板中添加语言切换链接：

```ejs
<% supportedLocales.forEach(loc => { %>
  <a href="/set-locale/<%= loc %>"><%= loc %></a>
<% }); %>
```

## 四、URL 结构示例

### 4.1 英文版本（默认）
- 首页：`/` 或 `/en` 或 `/en/`
- 关于：`/about` 或 `/en/about`
- 分类：`/category/Action` 或 `/en/category/Action`
- 游戏：`/game?name=GameName` 或 `/en/game?name=GameName`

### 4.2 中文版本
- 首页：`/zh-CN` 或 `/zh-CN/`
- 关于：`/zh-CN/about`
- 分类：`/zh-CN/category/Action`
- 游戏：`/zh-CN/game?name=GameName`

## 五、数据流程

```
用户请求 → 多语言中间件 → 检测语言 → 设置 res.locals → 
路由处理 → 加载数据 → 使用翻译函数 → 渲染模板 → 返回 HTML
```

## 六、优势特点

1. **SEO 友好**
   - 每种语言有独立的 URL
   - 搜索引擎可以正确索引不同语言版本

2. **用户体验好**
   - 支持 Cookie 记住用户选择
   - 自动检测浏览器语言
   - 语言切换无需刷新页面（通过重定向保持上下文）

3. **性能优化**
   - 语言文件缓存机制
   - 服务端渲染，无需客户端 JS 处理

4. **易于扩展**
   - 添加新语言只需：
     1. 创建新的语言文件（如 `fr.json`）
     2. 添加到 `SUPPORTED_LOCALES`
     3. 路由自动支持

## 七、开发建议

1. **语言文件管理**
   - 保持键的结构一致性
   - 使用嵌套结构组织翻译（如 `common.*`、`page.*`）
   - 支持参数占位符 `{{param}}`

2. **测试多语言**
   - 测试不同 URL 前缀
   - 测试 Cookie 持久化
   - 测试浏览器语言自动检测

3. **性能考虑**
   - 语言文件会被缓存，修改后需要重启服务或清除缓存
   - 开发环境可以禁用缓存以便热更新

## 八、实现细节补充

### 8.1 参数替换机制

翻译文本支持参数替换，使用 `{{param}}` 格式：

```json
{
  "category": {
    "gamesFound": "共 {{count}} 款游戏"
  }
}
```

使用：
```javascript
t('zh-CN', 'category.gamesFound', {count: 20})
// 结果: "共 20 款游戏"
```

### 8.2 嵌套键访问

支持通过点号分隔访问嵌套的翻译键：

```json
{
  "common": {
    "nav": {
      "home": "首页"
    }
  }
}
```

访问：`t('zh-CN', 'common.nav.home')`

### 8.3 Cookie 管理

- Cookie 名称：`locale`
- 有效期：1 年
- 作用域：整个域名
- HTTP-only：false（允许客户端 JS 读取）

## 九、总结

本多语言实现方案采用了成熟的 **服务端渲染 + URL 前缀 + Cookie 持久化** 的架构，既保证了 SEO 效果，又提供了良好的用户体验。通过中间件和工具函数的封装，使多语言功能与业务逻辑解耦，易于维护和扩展。

