**中文** · [English](README.en.md)

# dsh-asr-coding

DeepSeek Harness (DSH) Web GUI 的语音输入插件。

点击输入框旁的 🎤 麦克风按钮开始说话，再点一次停止，识别文字自动填入输入框。
识别引擎与模型可在 **设置 → 语音输入** 中选择。

## 功能

- **两种识别引擎**
  - **浏览器本地识别** — 使用浏览器自带的 Web Speech API（`SpeechRecognition`，
    Chrome/Edge）。零配置、无需 API Key，边说边把中间结果写进输入框。
  - **API 识别** — 用 `MediaRecorder` 录音，支持 **OpenAI 兼容**
    `/v1/audio/transcriptions` 接口（OpenAI、Groq、自定义），以及智谱
    `/api/paas/v4/audio/transcriptions` 接口，以及阿里云百炼 Fun-ASR-Realtime WebSocket API。
- **模型可选** — `whisper-1`（OpenAI）、`whisper-large-v3`、
  `whisper-large-v3-turbo`、`distil-whisper-large-v3-en`（Groq）、
  `glm-asr-2512`（智谱）、`fun-asr-realtime-2026-02-28`（阿里云百炼），
  或自定义模型名。
- **可配置** — 服务预设（OpenAI / Groq / 智谱 / 阿里云百炼 / 自定义）、API Base URL、API Key、
  识别语言、写入方式（追加到输入框 / 替换输入框内容）。
- **实时状态条** — 输入框下方显示录音计时、识别中状态与错误信息。
- **隐私** — API Key 仅保存在页面内存中，不落盘、不打日志；非密钥配置通过
  `localStorage` 在刷新后保留。

## 安装

打包 tarball 后安装到你的 DSH web profile（与其他 `dsh-*` 插件一致）：

```bash
pnpm pack
# 把 dsh-asr-coding-*.tgz 复制到 web profile 并添加依赖，
# 例如在 ~/.dsh/profiles/web 下：pnpm add ../path/to/dsh-asr-coding-0.1.0.tgz
# 然后重启 `dsh web`。
```

插件注册了三个界面位：

- 输入框工具行的麦克风按钮（`conversation.input.left`）
- 输入框下方的状态条（`conversation.composer.dock`）
- 设置页（`settings.section` → 语音输入）

## 使用

1. 打开 **设置 → 语音输入** 选择引擎。
   - 浏览器本地识别：无需其他配置（Chrome/Edge）。
   - API 识别：选择预设（OpenAI、Groq、智谱或阿里云百炼）、模型，并粘贴 API Key。
     - 智谱预设自动使用 `https://open.bigmodel.cn/api/paas/v4` 和
       `glm-asr-2512`；录音在浏览器中转换为 16 kHz 单声道 WAV。
     - 智谱官方限制为 WAV/MP3、文件不超过 25 MB、单段音频不超过 30 秒。
       插件通过内部 JSON 路由传输音频，目前采用更严格的 6 MB 音频上限，
       并会在超过 30 秒时提示缩短录音。
     - 阿里云百炼预设使用北京地域兼容地址
       `wss://dashscope.aliyuncs.com/api-ws/v1/inference` 和模型
       `fun-asr-realtime-2026-02-28`。插件将录音转换为 16 kHz 单声道 PCM，
       由宿主通过 WebSocket 执行 `run-task` → 二进制音频 → `finish-task`。
       语言提示支持中文、英文和日语。
2. 点击输入框旁的 🎤 开始录音，说话，再点一次停止。识别文字进入输入框，回车发送。

> 浏览器本地引擎依赖 Chrome/Edge 的 Web Speech API；Firefox 请使用 API 引擎。

## 工作原理

```
┌──────────┐  点击🎤        ┌───────────────┐
│  客户端  │ ─────────────▶ │ MediaRecorder │  (api 引擎)
│ (浏览器) │                │ SpeechRecog.  │  (browser 引擎)
└──────────┘                └──────┬────────┘
      ▲                           ▼
      │ setDraft(text)      base64 音频 (JSON)
      │              POST /stt-input/transcribe
      │                           │
┌─────┴──────┐           ┌───────▼────────┐
│  输入框    │ ◀──────────│  Host (Node)   │
└────────────┘  {ok,text} │ HTTP → audio/ │
                          │ transcriptions│
                          │ 或 WebSocket  │
                          └────────────────┘
```

客户端（`lib/client.js`）录音后把 base64 JSON POST 到宿主路由
`/stt-input/transcribe`；宿主（`lib/index.js`）解码音频并以
`multipart/form-data` 上传到服务商对应端点：OpenAI 兼容服务使用
`${baseUrl}/v1/audio/transcriptions`，智谱使用
`${baseUrl}/audio/transcriptions`（完整地址为
`https://open.bigmodel.cn/api/paas/v4/audio/transcriptions`）；阿里云百炼使用固定的
WebSocket 地址，并通过 `run-task`、二进制 PCM 音频和 `finish-task` 完成识别。
宿主使用 Node ≥ 18 的全局 `fetch` / `FormData` / `Blob` 和 `ws`。

## License

MIT
