# ChatGPT Usage Bar
![Version](https://img.shields.io/badge/version-5.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-orange)
![License](https://img.shields.io/badge/license-MIT-green)

[English](README.md) | [简体中文](README.zh-CN.md)

[通过 Greasy Fork 安装](https://greasyfork.org/en/scripts/600084-chatgpt-usage-bar)

一个轻量级的 Tampermonkey 用户脚本，用于在 ChatGPT 左侧栏底部的个人账户区域中直接显示剩余 Usage。

项目设计目标是保持界面紧凑、自动适配 ChatGPT 当前主题，并尽量避免不必要的 Usage API 轮询。

## 功能

- 显示**剩余额度**，而不是已使用百分比
- 支持显示多个 Usage 时间窗口，例如 `5h` 和 `7d`
- 在个人账户区域中显示紧凑的进度条
- 自动跟随 ChatGPT 的浅色 / 深色主题
- ChatGPT 完成一次回答后自动刷新 Usage
- 页面重新回到前台时，如果缓存数据超过 5 分钟，会自动刷新
- 鼠标悬停个人账户区域 2 秒可手动刷新
- Hover 时显示 2 秒圆形进度提示
- 手动刷新后显示浅色的 60 秒 cooldown 圆环
- 不使用固定时间间隔轮询 Usage API
- ChatGPT 作为 SPA 重建侧边栏后可自动重新挂载组件

## 预览

```text
┌──────────────────────────────────────────────┐
│  AZ   User Name          5h  ███████░   72%  │
│       Plus               7d  █████████  94%  │
└──────────────────────────────────────────────┘
```

圆形刷新提示只会在以下情况出现：

1. Hover 2 秒等待手动刷新时
2. 手动刷新后的 60 秒 cooldown 期间

Cooldown 结束后，圆环会完全消失。

## 安装

### 要求

- Tampermonkey 或其他兼容的 userscript 管理器
- 支持 userscript 的桌面浏览器
- 已登录 ChatGPT 网页版

### 通过 Greasy Fork 安装（推荐）

1. 安装 Tampermonkey 或其他兼容的用户脚本管理器。
2. 打开 [Greasy Fork 上的 ChatGPT Usage Bar 页面](https://greasyfork.org/en/scripts/600084-chatgpt-usage-bar)。
3. 点击 **Install this script（安装此脚本）**，在脚本管理器中确认安装。
4. 刷新 [ChatGPT](https://chatgpt.com/)。

正常情况下，Usage Bar 会显示在左侧栏底部的个人账户区域中。

### 从 GitHub 手动安装

1. 安装 Tampermonkey。
2. 新建一个 userscript。
3. 删除默认模板。
4. 将 [chatgpt-usage-bar.user.js](chatgpt-usage-bar.user.js) 的完整内容粘贴进去。
5. 保存脚本。
6. 刷新 `https://chatgpt.com/`。

正常情况下，Usage Bar 会显示在左侧栏底部的个人账户区域中。

## 刷新逻辑

ChatGPT Usage Bar 不会持续轮询 Usage API。

只有在以下条件满足时才会请求 Usage：

| 触发条件 | 行为 |
| --- | --- |
| 页面首次加载 | 请求一次 |
| ChatGPT 完成一次回答 | 延迟一小段时间后请求一次 |
| 页面恢复到前台 | 仅当上一次成功数据已经超过 5 分钟时请求 |
| Hover 个人账户区域 2 秒 | 手动请求一次 |
| Hover cooldown | 60 秒内阻止重复手动刷新 |

当前版本通过检测：

```text
button[aria-label="Stop"]
```

判断 ChatGPT 是否正在生成内容。

当 Stop 按钮消失，并且在 completion delay 内没有重新出现时，会认为本轮回答已经完成。

## Hover 手动刷新

手动刷新流程：

```text
鼠标悬停个人账户区域
        ↓
2 秒圆形进度
        ↓
刷新 Usage
        ↓
60 秒浅色 cooldown 圆环
        ↓
圆环消失
```

如果在 2 秒完成前移开鼠标，本次刷新会被取消。

## 主题适配

组件不会维护独立的固定配色，而是尽量继承 ChatGPT 当前主题。

例如：

```css
color: inherit;
background: currentColor;
stroke: currentColor;
```

因此可以自动适配浅色和深色主题。

## 配置

主要行为参数集中在脚本顶部：

```javascript
const CONFIG = Object.freeze({
    debug: false,

    hoverHoldMs: 2_000,
    hoverCooldownMs: 60_000,

    resumeThresholdMs: 5 * 60_000,
    generationEndDelayMs: 2_000,
    completionMinAgeMs: 15_000,

    generationCheckMs: 750,
    mountRetryMs: 500,
    requestTimeoutMs: 10_000
});
```

例如：

```javascript
// Hover 3 秒后才触发手动刷新
hoverHoldMs: 3_000,

// 手动刷新 cooldown 改为 2 分钟
hoverCooldownMs: 120_000,

// 页面恢复时，仅在数据超过 10 分钟后刷新
resumeThresholdMs: 10 * 60_000,
```

## 代码结构

仓库文件：

| 文件 | 用途 |
| --- | --- |
| [chatgpt-usage-bar.user.js](chatgpt-usage-bar.user.js) | 用户脚本源码 |
| [README.md](README.md) | 英文说明 |
| [README.zh-CN.md](README.zh-CN.md) | 简体中文说明 |
| [LICENSE.txt](LICENSE.txt) | MIT 许可证 |

为了便于直接在 Tampermonkey 中修改，项目保持单文件 userscript 结构。

代码内部按职责划分：

```text
1.  Configuration
2.  Runtime State
3.  Debug
4.  Utilities
5.  Authentication
6.  Usage API
7.  Usage Data
8.  ChatGPT DOM
9.  UI Style
10. UI Create / Mount
11. Usage Render
12. Refresh Policy
13. Refresh Ring
14. Generation Watch
15. Page Resume
16. SPA DOM Watch
17. Init
```

不需要构建工具，也不依赖外部 JavaScript 库。

## 安全与隐私

ChatGPT Usage Bar 的设计目标之一是尽量减少认证数据暴露。

- 网络请求只发送到 ChatGPT 同源接口
- Access Token 和 Account ID 只存在于函数局部作用域
- 不将认证数据写入 `localStorage`
- 不将认证数据写入 `sessionStorage`
- 不将认证数据写入 IndexedDB
- 不将认证数据插入页面 DOM
- 默认关闭调试日志
- 不在界面中显示原始认证错误信息
- 不包含第三方统计、分析或遥测代码
- 不加载外部 JavaScript 依赖

脚本只会使用浏览器中现有的 ChatGPT 登录状态来请求 Usage 信息。

## 内部 API

当前版本依赖 ChatGPT 内部接口，例如：

```text
/api/auth/session
/backend-api/wham/usage
```

这些接口并不是稳定的公开 API。

ChatGPT 后续更新可能修改或移除这些接口。

## DOM 依赖

当前版本还依赖 ChatGPT 网页中的部分 DOM 结构，例如：

```text
button[aria-label="Open profile menu"]
button[aria-label="Stop"]
```

如果 ChatGPT 后续修改 DOM 结构、ARIA label 或相关页面逻辑，脚本可能需要更新。

相关 selector 和 API path 已集中放置，方便后续维护。

## 已知限制

- ChatGPT 内部 API 可能随时变化
- ChatGPT 前端 DOM 结构可能随更新变化
- 一次回答结束后，Usage 数据可能不会立即同步更新
- 脚本只展示当前 Usage API 返回的时间窗口
- 当前项目主要面向 ChatGPT 网页版

## 开发

项目不需要构建流程。

直接编辑 userscript，保存到 Tampermonkey 后刷新 ChatGPT 即可。

如需调试，可以将：

```javascript
debug: false
```

改为：

```javascript
debug: true
```

提交修改时建议遵循以下原则：

- 不在日志、截图或 Issue 中包含 Token、Account ID 等认证数据
- 避免无意义地提高 API 请求频率
- 优先使用语义明确的 selector，而不是自动生成的 CSS class
- 配置项集中维护
- 保持浅色 / 深色主题兼容
- 除非有明确收益，否则不要引入外部依赖

## 免责声明

ChatGPT Usage Bar 是一个非官方社区项目。

本项目与 OpenAI 无隶属、合作、背书或官方维护关系。

ChatGPT 前端结构和内部接口可能随时发生变化。

## 许可证

本项目使用 MIT License。

详细内容请查看 [LICENSE.txt](LICENSE.txt)。
