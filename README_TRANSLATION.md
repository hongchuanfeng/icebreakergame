# 游戏详情翻译功能说明

## 功能概述

游戏详情页面的 `detail` 字段会根据用户的语言环境自动翻译：
- **中文环境（zh-CN）**：自动将英文 detail 翻译成中文
- **英文环境（en）**：显示原始英文 detail

## 使用方式

### 启用翻译（默认）

```bash
node server.js
# 或
npm start
```

### 禁用翻译

如果网络环境无法访问 Google Translate API，可以通过环境变量禁用：

```bash
# Windows PowerShell
$env:ENABLE_TRANSLATION="false"
node server.js

# Windows CMD
set ENABLE_TRANSLATION=false
node server.js

# Linux/Mac
ENABLE_TRANSLATION=false node server.js
```

## 翻译机制

1. **翻译 API**：使用 Google Translate 免费接口
2. **缓存机制**：
   - 内存缓存：提高响应速度
   - 文件缓存：`cache/translations.json`（进程重启后仍可用）
3. **长文本处理**：自动分段翻译（>4000 字符）
4. **错误处理**：翻译失败时自动回退到原文

## 调试日志

翻译功能会输出详细的调试日志，格式如下：

```
[Translation] Starting translation for game: bloxdhop-io, detail length: 1234
[TranslateLongText] Starting translation, text length: 1234, targetLang: zh-CN
[Translate] Requesting translation: Games».Io»Adventure...
[Translate] Response status: 200
[Translate] Received 567 bytes of data
[Translate] Translated: 游戏».Io»冒险...
[Translation] Translation completed for game: bloxdhop-io
[Translation] Using translated text for game: bloxdhop-io
```

## 常见问题

### 1. 翻译不生效

**可能原因：**
- 网络无法访问 Google Translate API
- 翻译超时（15秒）
- 环境变量 `ENABLE_TRANSLATION=false`

**解决方法：**
- 检查服务器日志中的 `[Translation]` 和 `[Translate]` 日志
- 确认网络连接正常
- 检查环境变量设置

### 2. 翻译速度慢

**原因：**
- 首次翻译需要调用 API，可能较慢
- 长文本需要分段翻译

**解决方法：**
- 翻译结果会自动缓存，后续访问会很快
- 可以预先翻译常用游戏的 detail

### 3. 翻译质量不佳

**说明：**
- 使用免费的 Google Translate API，翻译质量取决于 API
- 可以手动编辑 `cache/translations.json` 来优化特定翻译

## 文件说明

- `utils/translate.js` - 翻译工具模块
- `cache/translations.json` - 翻译缓存文件（自动生成）
- `server.js` - 服务器路由，集成翻译功能

