# 大肥鱼语聊

<img src="assets/icon-180.png" width="96" height="96" alt="大肥鱼语聊图标" align="right" />

用 DeepSeek 的语音能力做出的一只「会说话的小鱼」：选一个声音，按住麦克风说话，它听懂后想一想，再把回答直接说给你听。

- 语音输入：DeepSeek 语音识别（`POST /v1/tools/asr`）
- 语音输出：DeepSeek 语音合成（`POST /v1/tools/tts`），音色 `stella`（海星，女声）/ `tide`（暗潮，男声）
- 对话与看图：`deepseek-flash`（支持图片理解）

界面参考了 DeepSeek 官方 chat-demo 的语音交互：
第一步选声音，第二步进入语音聊天面板，中间是随声音跳动的圆形图标。

## 界面

**浮层入口**：右下角的圆形小鱼按钮。按住可以拖到页面任意位置，松手后位置会记在本地，
下次打开还在原地；拖到屏幕边缘会被挡住，不会跑出可视区域。单击（或按回车）才是打开面板。

**第一步 · 选择一种语音**
- 两张音色卡片：Stella（海星 · 女声）、Tide（暗潮 · 男声）
- 每张卡片可以「试听」，选择会记在浏览器本地
- 「开始聊天」进入语音面板

**第二步 · 语音聊天**
- 右上角齿轮：切换音色（标注女声/男声）、选择麦克风音源、连续对话开关、清空对话、重新选择语音
- 中间：随真实音量起伏的圆形图标（听你说话时变红、思考时转圈、说话时跟随合成语音起伏）
- 底部三个按钮：语音开关（点击开始说话，再点结束并发送）、图片、关闭
- 图片按钮：选一张图后即可「看着这张图问它」，问题可以继续说，也可以直接打字
- 回答按句合成、边生成边播放，所以第一句话几乎立刻就能听到

没有麦克风权限时会自动出现输入框，可以直接打字聊天。

**麦克风音源**：齿轮 → 「麦克风」里可以选系统默认或任意一个输入设备（比如内置麦克风、耳机、iPhone 的连续互通麦克风）。
选择会记住；插拔设备时列表自动更新，也可以点「重新检测」。设备名字要等第一次录音授权后才会显示。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半身：`/dafeiyu/tts`、`/dafeiyu/asr`、`/dafeiyu/chat`（SSE）、`/dafeiyu/status`、`/dafeiyu/key` |
| `client.js` | Client 半身：注册到 `shell.overlay` 的浮层界面、录音、播放与动效 |
| `cordis.patch.yml` | 向 profile 插入 `dafeiyu-voice-chat` 这一行 |
| `locale/*.json` | 插件管理器里显示的名称与说明 |
| `icon.svg` | 插件图标（插件清单里显示的那一格） |
| `assets/fish.svg` | 页面内右下角按钮与面板标题用的头像（同一张图，见下方来源） |

## 实现要点

- **密钥不进浏览器**：页面只请求本机 Host，Host 通过 `credentials` 服务按次解析 `DEEPSEEK_API_KEY`，再转发给 DeepSeek。
- **录音格式**：Web Audio 采集 PCM，前端重采样为 16 kHz 16-bit 单声道 WAV，符合 ASR 的格式要求。
- **低延迟朗读**：把流式回答按句切分（中文标点/换行），每句立即请求合成，播放队列边下边播。
- **动效取真实音量**：播放侧与麦克风侧各接一个 `AnalyserNode`，用 RMS 驱动圆形图标的缩放与光晕。
- **路由准入**：五个 `/dafeiyu/*` 路由都先调用 `ctx.connection.requestRejection`，和 Harness 自带插件用的是同一道 Host/Origin + 已认证页面会话检查，避免任意网页跨站调用本机接口。
- **图片**：发送前在浏览器里压到最长边 1024px 的 JPEG，再以 base64 交给视觉模型。

## 前置条件：一个 DeepSeek API Key

语音识别、语音合成、看图都是 **DeepSeek 平台接口**，靠 DeepSeek 的 Key 鉴权，
和你在 Harness「设置 → 模型」里选的聊天模型**没有关系**：

- 插件里的对话固定用 `deepseek-flash`（它带视觉能力），不读取 Harness 的模型选择；
- 所以哪怕 Harness 里选的是别的厂商模型（比如小米），只要 `DEEPSEEK_API_KEY` 在，语音照样能用；
- 反过来，没有这个 Key，ASR / TTS 一次也调不通。

打开面板时第一件事就是向 Host 查这个 Key：

| 情况 | 表现 |
| --- | --- |
| 有 Key | 直接进入语音选择 |
| 没有 Key | 先出现「先填一个 DeepSeek API Key」，填完立即生效 |
| 用着用着失效（401） | 自动跳回填 Key 页面 |

填写后会先用 `GET /models` 验一次，通过才写入 `DEEPSEEK_API_KEY`——和「设置 → 模型」里
保存的是同一个凭据，两边互通，改一处就够。
设置面板里也能看到当前 Key 的掩码（`sk-…449f`）并一键更换。

## 安装

从 npm 安装（推荐，装的是预构建包，不需要本地构建）：

```sh
dsh plugin --profile web add dsh-dafeiyu-voice-chat
```

还没有 npm 包时，也可以直接从仓库安装：

```sh
dsh plugin --profile web add github:dennisyang1986/dsh-dafeiyu-voice-chat
```

装完刷新页面即可载入客户端模块；如果「设置 → 插件」里标了要重启，就重启一次 `dsh web`。
客户端包（`client.js`）已经随包发布，装的时候不需要编译。

本地开发时可以把工作目录 link 进 profile，改 `client.js` 会通过 HMR 自动热更新：

```sh
dsh plugin --profile web add link:/path/to/dsh-dafeiyu-voice-chat
```

## 前提版本

- DeepSeek Harness 0.2.x（开发和验证基于 `0.2.2-rc.1`，其它 0.2.x 版本没有逐一测试）
- Node.js 24+（Harness 自身的要求）

## 许可证

代码以 [MIT](LICENSE) 发布。图标素材来自
[EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive) 的同人表情包，
原仓库未声明许可证；再分发或商用前请自行确认素材授权。

## 图标来源

图标取自表情包仓库 [EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive/blob/main/memes/120302wg44ju245iDQ38xu-480.webp)。
原图是 480×480 的 WebP 插画，这里没有做自动描边（描边会毁掉手绘插画的层次），
而是把原图内嵌进一个 SVG 包装里，同一份内容放在两个位置：
根目录的 `icon.svg` 供插件清单读取（`package.json` 的 `icon` 与 `./icon` 导出），
`assets/fish.svg` 供页面内的按钮读取（`./assets/*` 导出，浏览器只能通过 `/plugins/<包名>/assets/...` 取图）。

两份是有意重复的：Node 会把包的 `exports` 表缓存在进程里，单个路径改动要等宿主重启才生效，
两个路径同时存在可以保证换图标时立刻生效、重启后也一致。

`assets/icon-180.png` 和 `assets/icon-512.png` 是从同一张原图导出的位图：前者给插件市场当卡片图标，
后者给 README 和商店页备用。

## 说明

- 所有 `/dafeiyu/*` 路由在入口先过 `ctx.connection.requestRejection(req)`：Host/Origin 不匹配返回 403，没有已认证的页面会话返回 401。只有从 DSH 页面里发出的请求能打到这几个接口，浏览器里打开的其它网页会被挡掉。
- 路由只监听本机回环地址（`127.0.0.1`），DeepSeek 的 Key 始终留在 Host 侧。
- 语音合成按字符计费，语音识别按音频时长计费，请留意用量。
