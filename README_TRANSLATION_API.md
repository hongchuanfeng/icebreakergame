# 翻译 API 配置说明

## 支持的翻译 API

本项目支持多个翻译 API，可以自动降级使用：

1. **百度翻译 API**（推荐，国内可用）
2. **Google Translate**（免费，需要能访问）
3. **MyMemory Translate**（免费，不需要 API key，但有限制）

## 配置方式

### 方式一：自动模式（默认）

自动尝试多个 API，按优先级降级：

```bash
node server.js
```

### 方式二：指定翻译 API

通过环境变量 `TRANSLATION_API` 指定：

```bash
# Windows PowerShell
$env:TRANSLATION_API="baidu"
node server.js

# Windows CMD
set TRANSLATION_API=baidu
node server.js

# Linux/Mac
TRANSLATION_API=baidu node server.js
```

可选值：
- `auto` - 自动模式（默认）
- `google` - 仅使用 Google Translate
- `baidu` - 仅使用百度翻译
- `mymemory` - 仅使用 MyMemory

## 百度翻译 API 配置（推荐）

百度翻译 API 在国内稳定可用，推荐使用。**已默认配置，可直接使用！**

### 默认配置

项目已内置默认的 API Key 和 Secret Key，无需额外配置即可使用：
- Client ID: `vUi8ehLSHu6FwdGZxpACv7bo`
- Client Secret: `TlLaapNfsJ6gyNnb6USPDsPznRcKVYJk`

### 自定义配置（可选）

如果需要使用自己的 API Key，可以通过环境变量配置：

```bash
# Windows PowerShell
$env:BAIDU_CLIENT_ID="your_client_id"
$env:BAIDU_CLIENT_SECRET="your_client_secret"

# Windows CMD
set BAIDU_CLIENT_ID=your_client_id
set BAIDU_CLIENT_SECRET=your_client_secret

# Linux/Mac
export BAIDU_CLIENT_ID=your_client_id
export BAIDU_CLIENT_SECRET=your_client_secret
```

### 工作原理

1. 系统自动获取 Access Token（有效期 30 天）
2. Token 会自动缓存，避免频繁请求
3. Token 过期前 5 分钟自动刷新
4. 使用 OAuth 2.0 标准协议

## API 对比

| API | 是否需要 API Key | 国内可用 | 单次限制 | 推荐度 |
|-----|----------------|---------|---------|--------|
| 百度翻译 | ✅ 是 | ✅ 是 | 2000字符 | ⭐⭐⭐⭐⭐ |
| Google Translate | ❌ 否 | ❌ 否 | 5000字符 | ⭐⭐⭐ |
| MyMemory | ❌ 否 | ✅ 是 | 500字符 | ⭐⭐ |

## 使用建议

### 国内服务器（推荐）

```bash
# 配置百度翻译 API
export BAIDU_APP_ID=your_app_id
export BAIDU_APP_KEY=your_app_key
export TRANSLATION_API=baidu
node server.js
```

### 国外服务器

```bash
# 使用 Google Translate（默认）
node server.js
```

### 免费方案（无 API key）

```bash
# 使用 MyMemory（有限制，但免费）
export TRANSLATION_API=mymemory
node server.js
```

## 故障排除

### 1. 所有 API 都超时

**可能原因：**
- 网络连接问题
- 防火墙阻止

**解决方法：**
- 检查网络连接
- 配置百度翻译 API（更稳定）
- 使用代理服务器

### 2. 百度翻译 API 返回错误

**检查：**
- APP_ID 和 APP_KEY 是否正确
- API 是否已激活
- 是否超出免费额度

### 3. 翻译质量不佳

**建议：**
- 优先使用百度翻译（对中英翻译质量更好）
- 检查原文质量
- 考虑手动优化翻译结果

## 缓存机制

所有翻译结果都会自动缓存：
- **内存缓存**：快速响应
- **文件缓存**：`cache/translations.json`
- **持久化**：进程重启后仍可用

缓存可以显著提高翻译速度，避免重复调用 API。

