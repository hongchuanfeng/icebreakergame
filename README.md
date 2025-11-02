# Ice Breaker Games

一个基于 Node.js 和 Express 的服务端渲染（SSR）破冰游戏展示网站。

## 功能特性

- 🎮 游戏分类导航
- 🔍 游戏搜索功能（支持 SSR 和 API）
- 📱 响应式设计（支持 PC 和移动端）
- 🎨 现代化 UI 设计
- 🔎 **SEO 优化**：服务端渲染，搜索引擎友好
- ⚡ **性能优化**：数据缓存机制，减少 IO 操作
- 📊 实时游戏详情展示

## 技术栈

- **后端**: Node.js + Express + EJS 模板引擎
- **渲染方式**: 服务端渲染（SSR）
- **前端**: HTML5 + CSS3 + JavaScript（渐进增强）
- **数据**: JSON 格式

## 安装步骤

1. 安装依赖：
```bash
npm install
```

2. 启动服务器：
```bash
npm start
```

或者使用开发模式（自动重启）：
```bash
npm run dev
```

3. 访问网站：
打开浏览器访问 `http://localhost:3000`

## 项目发布/部署

### 生产环境部署

#### 1. 安装依赖

```bash
npm install --production
```

#### 2. 环境变量配置（可选）

创建 `.env` 文件或直接设置环境变量：

```bash
# Windows PowerShell
$env:ENABLE_TRANSLATION="true"
$env:TRANSLATION_API="baidu"
$env:BAIDU_CLIENT_ID="your_client_id"      # 可选，已有默认值
$env:BAIDU_CLIENT_SECRET="your_client_secret"  # 可选，已有默认值
$env:PORT="3000"                           # 可选，默认 3000

# Windows CMD
set ENABLE_TRANSLATION=true
set TRANSLATION_API=baidu
set PORT=3000

# Linux/Mac
export ENABLE_TRANSLATION=true
export TRANSLATION_API=baidu
export PORT=3000
```

**环境变量说明：**
- `ENABLE_TRANSLATION`: 是否启用游戏详情翻译（`true`/`false`，默认 `true`）
- `TRANSLATION_API`: 翻译 API 选择（`baidu`/`google`/`mymemory`/`auto`，默认 `baidu`）
- `BAIDU_CLIENT_ID`: 百度翻译 Client ID（已有默认值，可选）
- `BAIDU_CLIENT_SECRET`: 百度翻译 Client Secret（已有默认值，可选）
- `PORT`: 服务器端口（默认 `3000`）

#### 3. 启动服务器

**方式一：直接启动（推荐用于简单部署）**

```bash
npm start
```

或使用 Node.js 直接启动：

```bash
node server.js
```

**方式二：使用 PM2 进程管理（推荐用于生产环境）**

安装 PM2：

```bash
npm install -g pm2
```

启动应用：

```bash
pm2 start server.js --name "ice-breaker-games"
```

查看状态：

```bash
pm2 status
pm2 logs ice-breaker-games
```

PM2 常用命令：

```bash
# 停止应用
pm2 stop ice-breaker-games

# 重启应用
pm2 restart ice-breaker-games

# 删除应用
pm2 delete ice-breaker-games

# 开机自启动
pm2 startup
pm2 save
```

**方式三：使用 systemd（Linux）**

创建服务文件 `/etc/systemd/system/ice-breaker-games.service`：

```ini
[Unit]
Description=Ice Breaker Games Node.js App
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/node_game_web
ExecStart=/usr/bin/node /path/to/node_game_web/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable ice-breaker-games
sudo systemctl start ice-breaker-games
sudo systemctl status ice-breaker-games
```

#### 4. 配置反向代理（Nginx）

示例 Nginx 配置：

```nginx
server {
    listen 80;
    server_name www.icebreakgame.com icebreakgame.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置 HTTPS（使用 Let's Encrypt）：

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d www.icebreakgame.com -d icebreakgame.com
```

#### 5. 验证部署

访问以下 URL 验证：

- 主页：`http://your-domain/`
- 中文主页：`http://your-domain/zh-CN/`
- 英文主页：`http://your-domain/en/`
- 游戏详情：`http://your-domain/game?name=游戏名`
- 分类页面：`http://your-domain/category/分类名`

### 文件结构说明

部署时需要包含以下文件/目录：

```
node_game_web/
├── server.js              # 主服务器文件（必需）
├── package.json            # 项目配置（必需）
├── package-lock.json       # 依赖锁定（推荐）
├── data.json              # 游戏数据（必需）
├── utils/                 # 工具函数（必需）
│   ├── helpers.js
│   ├── i18n.js
│   └── translate.js
├── locales/               # 语言文件（必需）
│   ├── en.json
│   └── zh-CN.json
├── views/                 # 模板文件（必需）
│   ├── *.ejs
│   └── partials/
└── cache/                 # 翻译缓存（自动创建）
    └── translations.json  # 翻译缓存文件
```

**注意事项：**
- `node_modules/` 目录会在 `npm install` 后自动生成，无需上传
- `cache/` 目录会自动创建，建议添加到 `.gitignore`
- 确保服务器有写入 `cache/` 目录的权限

### 性能优化建议

1. **使用反向代理缓存**：配置 Nginx 缓存静态内容
2. **启用 Gzip 压缩**：在 Nginx 配置中启用 gzip
3. **使用 CDN**：将静态资源托管到 CDN
4. **数据库迁移**：如果数据量大，考虑迁移到数据库（MongoDB/PostgreSQL）

## 项目结构

```
node_game_web/
├── data.json              # 游戏数据文件
├── server.js              # Express 服务器（SSR）
├── package.json           # 项目配置
├── utils/                 # 工具函数
│   └── helpers.js         # 工具函数（分类图标等）
├── views/                  # EJS 模板文件
│   ├── index.ejs          # 主页模板
│   ├── search.ejs        # 搜索页面模板
│   ├── category.ejs       # 分类页面模板
│   └── partials/         # 模板片段
│       ├── header.ejs    # 头部模板
│       ├── footer.ejs    # 底部模板
│       ├── styles.ejs    # 样式模板
│       └── css.ejs       # CSS 内容
└── public/                # 静态文件目录（可选）
    ├── css/               # 静态 CSS（如需要）
    └── js/                # 静态 JS（渐进增强）
└── README.md              # 项目说明
```

## 路由和接口

### SSR 页面（服务端渲染，SEO 友好）
- `GET /` - 主页（服务端渲染所有游戏分类）
- `GET /search?q=关键词` - 搜索页面（服务端渲染搜索结果）
- `GET /category/:category` - 分类页面（显示指定分类的所有游戏）

### API 接口（供 AJAX 或其他用途）
- `GET /api/games` - 获取所有游戏数据（JSON）
- `GET /api/categories` - 获取所有分类（JSON）
- `GET /api/games/:category` - 根据分类获取游戏（JSON）
- `GET /api/search?q=关键词` - 搜索游戏（JSON）
- `GET /crazy.json` - 兼容接口（返回所有游戏数据）
- `GET /pokigame.json` - 兼容接口（返回空数组）

## 功能说明

### SSR 特性
1. **服务端渲染**: 所有页面在服务端渲染完成，直接返回完整 HTML
2. **SEO 优化**: 搜索引擎可以直接抓取完整的 HTML 内容，无需执行 JavaScript
3. **数据缓存**: 实现了 5 分钟的数据缓存机制，提高响应速度
4. **渐进增强**: 基础的交互功能在服务端完成，JavaScript 用于增强用户体验

### 页面功能
1. **顶部导航栏**: Logo 和搜索框（支持表单提交和服务端处理）
2. **左侧导航栏**: 显示所有游戏分类，点击跳转到对应分类区块
3. **主内容区**: 显示游戏卡片网格，每个分类显示最多 12 个游戏
4. **搜索功能**: 支持服务端搜索和客户端 AJAX 搜索（渐进增强）
5. **响应式设计**: 完美适配 PC、平板和手机端
6. **底部版权信息**: 网站版权声明

### 性能优化
- 数据缓存：减少文件读取次数
- 服务端渲染：减少客户端 JavaScript 执行时间
- 静态资源优化：使用 CDN 和缓存策略

## 浏览器支持

- Chrome（推荐）
- Firefox
- Safari
- Edge

## 开发

如需开发，可以使用 nodemon 实现自动重启：

```bash
npm install -g nodemon
npm run dev
```

## 许可证

ISC

