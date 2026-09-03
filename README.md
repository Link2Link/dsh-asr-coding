**中文** · [English](README.en.md)

# dsh-asr-coding

DeepSeek Harness (DSH) Web GUI 的语音输入插件。

点击输入框旁的 🎤 麦克风按钮开始说话，再点一次停止，识别文字自动填入输入框；
也可用全局快捷键 Ctrl+\ 切换录音，或在设置中改为「长按说话、松开结束」。
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
  `glm-asr-2512`（智谱）、`fun-asr-realtime`（阿里云百炼，默认）/
  `fun-asr-realtime-2026-02-28`（预览版）、`qwen3-asr-flash-realtime`
  （阿里云 Qwen3 ASR，多语种+情感识别，走 `/api-ws/v1/realtime` 协议），
  或自定义模型名。
- **可配置** — 服务预设（OpenAI / Groq / 智谱 / 阿里云百炼 / 自定义）、
  API Base URL、API Key（每个预设独立凭据位，互不覆盖，未设置时回退共享密钥）、
  触发方式（单击切换 / 长按说话松开结束，快捷键同步适配）、
  识别语言、写入方式（追加到输入框 / 替换输入框内容）、以及
  **热词 / 提示词**（专有名词、人名、术语，按服务商自动适配：智谱作为
  `hotwords` 数组，OpenAI / Groq / 自定义作为 `prompt` 字段，
  fun-asr-realtime 作为 `input.context` 识别上下文）。写法建议：逗号或
  换行分隔的专有名词正确写法（人名、产品名、术语），智谱上限 100 个词、
  fun-asr 截断 400 字；OpenAI / Groq 用自然句子嵌术语效果更佳，且句子
  语言需与语音语言一致。
- **实时状态条** — 输入框下方显示录音计时、识别中状态与错误信息。
- **稳定可靠** — 实时通道意外断开自动重连（最多 2 次）；Fun-ASR 开启
  心跳保活，长时间不发话连接不断；浏览器引擎静音数秒被掐断时自动
  无感重启；停止录音后图标立即恢复，最终文本后台静默定稿。
- **无时长限制** — Fun-ASR 实时系列官方规格为音频时长无限制，可连续
  长时间口述（已实测 150 秒连续推流零中断）。
- **密钥托管** — API Key 与 LLM 模型密钥同一方式保存：宿主通过 DSH 凭据服务
  存取（落盘于 `~/.dsh/.credentials.yaml`），页面不再持有密钥值，刷新与重启后
  依然生效。**每个服务预设一个独立凭据位**（`DSH_ASR_OPENAI_KEY`、
  `DSH_ASR_GROQ_KEY`、`DSH_ASR_ZHIPU_KEY`、`DSH_ASR_ALIYUN_KEY`、
  `DSH_ASR_CUSTOM_KEY`），切换预设互不覆盖；
  未设置时回退共享的 `DSH_ASR_API_KEY`（也可用环境变量注入）。

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
       阿里云可在三个实时模型间选择：`fun-asr-realtime`（默认，多语种）、
       `fun-asr-realtime-2026-02-28`（预览版，中/英/日）、`qwen3-asr-flash-realtime`
       （多语种+粤语+情感识别，使用 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
       的 `session.update` → `input_audio_buffer.append` → `session.finish`
       协议）。Fun-ASR 系列走 `/api-ws/v1/inference` 的 `run-task` → 二进制
       音频 → `finish-task` 协议；录音均转换为 16 kHz 单声道 PCM。
     - **实时出字**：选择阿里云或智谱时，说话过程中输入框会同步更新——
       阿里云通过 `/stt-input/stream` 实时通道推送中间识别结果（真正的边说边出）；
       智谱因其 GLM-ASR-2512 为一次性整段转写接口，插件每约 5 秒发送一段
       增量录音并追加识别结果（分段伪实时，首段文字约 5 秒后出现）。
2. 点击输入框旁的 🎤 或按快捷键开始录音：浏览器本地引擎与阿里云引擎边说边出字，
   智谱引擎约每 5 秒追加一段识别结果；停止后回车发送。

   **触发方式**（设置页可选）：

   - **单击切换**（默认）— 单击开始，再次单击停止；快捷键 `Ctrl+\`
     （macOS 上 `Cmd+\`）按下切换，行为一致。
   - **长按说话** — 按住麦克风或按住 `Ctrl+\` 录音，松开即停止收尾
     （对讲机风格；鼠标拖出按钮松开也会正确停止）。

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
