[中文](README.md) · **English**

# dsh-asr-coding

Speech-to-text voice input for the **DeepSeek Harness (DSH)** web GUI.

Click the 🎤 mic button beside the composer, speak, click again — the transcript
is written straight into the input box. The STT engine and model are selectable
in **Settings → 语音输入 (Voice Input)**.

## Features

- **Two engines**
  - **Browser local** — uses the browser's built-in Web Speech API
    (`SpeechRecognition`, Chrome/Edge). Zero configuration, no API key,
    live interim results appear in the input box as you speak.
  - **API** — records with `MediaRecorder` and transcribes through an
    **OpenAI-compatible** `/v1/audio/transcriptions` endpoint (OpenAI, Groq,
    custom), Zhipu's `/api/paas/v4/audio/transcriptions` endpoint, or Alibaba
    Cloud Model Studio's Fun-ASR-Realtime WebSocket API.
- **Selectable model** — `whisper-1` (OpenAI), `whisper-large-v3`,
  `whisper-large-v3-turbo`, `distil-whisper-large-v3-en` (Groq),
  `glm-asr-2512` (Zhipu), `fun-asr-realtime` (Alibaba Cloud, default) /
  `fun-asr-realtime-2026-02-28` (preview), `qwen3-asr-flash-realtime`
  (Alibaba Qwen3 ASR, multilingual with emotion, using the `/api-ws/v1/realtime`
  protocol), or a custom model name.
- **Configurable** — service preset (OpenAI / Groq / Zhipu / Alibaba Cloud /
  custom), API base URL, API key, trigger style (click-toggle or
  hold-to-talk with the hotkey following along), recognition language, insert mode (append
  to / replace the existing draft), and **hotwords / prompt** (proper nouns,
  names, terms — mapped per provider: a `hotwords` JSON array for Zhipu, a
  `prompt` field for OpenAI / Groq / custom endpoints, and recognition
  context for fun-asr-realtime). Writing tips: comma- or newline-separated
  proper nouns in their correct spelling (names, products, terms) — Zhipu
  takes up to 100 words, fun-asr truncates at 400 characters; OpenAI / Groq
  work best with the terms embedded in a natural sentence matching the audio
  language.
- **Host-stored settings, shared across browsers** — every non-secret
  setting (engine, service preset, model, hotwords, language, trigger style,
  insert mode) lives in the DSH host's settings document
  (`~/.dsh/settings.yaml`, `dsh-asr-coding` namespace, read/written through
  the DSH settings service): a new browser — or another machine — talking to
  the same DSH starts already configured, and a change made in one open page
  syncs to the others. Legacy per-browser localStorage configs migrate to the
  host on first load and the local copy is then removed. API keys keep riding
  the credential service; the page never holds a key value.
- **Live status** — a pill under the composer shows recording time,
  transcribing state, and errors.
- **Managed key** — API keys are stored exactly like LLM model keys: the host
  resolves them through the DSH credential service (persisted in
  `~/.dsh/.credentials.yaml`), the page never holds the value, and they survive
  reloads and restarts. **Each provider preset owns a dedicated credential
  slot** (`DSH_ASR_OPENAI_KEY`, `DSH_ASR_GROQ_KEY`, `DSH_ASR_ZHIPU_KEY`,
  `DSH_ASR_ALIYUN_KEY`, `DSH_ASR_CUSTOM_KEY`) so
  presets never overwrite each other, falling back to the shared
  `DSH_ASR_API_KEY` (an environment variable also works).

## Install

Build the tarball and install it into your DSH web profile (same flow as other
`dsh-*` plugins):

```bash
pnpm pack
# copy dsh-asr-coding-*.tgz into the web profile and add the dependency,
# e.g. under ~/.dsh/profiles/web: pnpm add ../path/to/dsh-asr-coding-0.1.0.tgz
# then restart `dsh web`.
```

The plugin registers:

- a mic button in the composer tool row (`conversation.input.left`),
- a status pill under the composer (`conversation.composer.dock`),
- a settings page (`settings.section` → 语音输入).

## Usage

1. Open **Settings → 语音输入** and pick an engine.
   - Browser local: nothing else needed (Chrome/Edge).
   - API: choose a preset (OpenAI, Groq, Zhipu, or Alibaba Cloud), pick the model, and paste
     your API key. The Zhipu preset uses `https://open.bigmodel.cn/api/paas/v4`
     with `glm-asr-2512` and converts recordings to 16 kHz mono WAV in-browser.
     Zhipu accepts WAV/MP3 files up to 25 MB and clips up to 30 seconds. Because
     this plugin transports audio through an internal JSON route, it currently
     applies a stricter 6 MB audio limit and rejects clips over 30 seconds.
     The Alibaba Cloud preset offers three realtime models: `fun-asr-realtime`
     (default, multilingual), `fun-asr-realtime-2026-02-28` (preview, zh/en/ja),
     and `qwen3-asr-flash-realtime` (multilingual incl. Cantonese, with emotion,
     using the `session.update` → `input_audio_buffer.append` → `session.finish`
     protocol on `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`). Fun-ASR
     models use the `/api-ws/v1/inference` `run-task` → binary audio →
     `finish-task` protocol; recordings are converted to 16 kHz mono PCM either way.
   - **Live text while speaking**: with Alibaba Cloud or Zhipu selected, the
     input box updates as you speak. Alibaba Cloud pushes interim results over
     the `/stt-input/stream` real-time channel (true streaming); Zhipu's
     GLM-ASR-2512 is a one-shot transcription API, so the plugin sends an
     incremental segment roughly every 5 seconds and appends the result
     (segmented pseudo-streaming; the first text appears after ~5 seconds).
2. Click the mic button or use the hotkey and speak: the browser engine and the
   Alibaba Cloud engine show text as you talk; the Zhipu engine appends a
   recognized segment roughly every 5 seconds. Stop, then press Enter to send.

   **Trigger styles** (selectable in settings):

   - **Click toggle** (default) — click to start, click again to stop; the
     Ctrl+Backslash hotkey (Cmd+Backslash on macOS) toggles the same way.
   - **Hold to talk** — press and hold the mic button or the Ctrl+Backslash
     key to record, release to stop (walkie-talkie style; releasing outside
     the button still stops correctly thanks to pointer capture).

> The browser engine needs Chrome or Edge (Web Speech API). In Firefox, switch
> to the API engine in Settings.

## How it works

```
        Trigger: click the mic | Ctrl+Backslash hotkey | hold-to-talk (settings)

+--------------------------------------------------------------+
|                   Browser  (lib/client.js)                   |
|                                                              |
|   browser engine     realtime engine (Alibaba)    batch      |
|   SpeechRecognition  AudioWorklet capture        engine     |
|   local, built-in    16 kHz mono PCM16            MediaRec.  |
+-------+-------------------+----------------------+----------+
        | local text        | WebSocket            | base64 JSON
        |                   | /stt-input/stream    | POST /stt-input/transcribe
        |                   v                      v
        |          +------------------------------------+
        |          |      Host (Node)  (lib/index.js)   |
        |          |  API key per preset via            |
        |          |  the DSH credential service        |
        |          |  heartbeat - auto-reconnect -      |
        |          |  pinned endpoints - validation     |
        |          +---------+--------------+---------+
        |                    | WebSocket    | HTTPS multipart
        |                    v              v
        |          DashScope realtime   OpenAI / Groq / Zhipu
        |          fun-asr / qwen3      /audio/transcriptions
        |                    |
        +------+-------------+
               v      sentence / done events stream back live
      +-----------------+
      |    input box    | setDraft() updates as you speak
      +-----------------+
```

The two host routes each own one path:

- **`/stt-input/stream` (WebSocket, realtime)** - the browser streams PCM
  frames while capturing; the host relays them to DashScope realtime ASR
  and pushes interim sentences back, so the draft updates as you speak.
  Stopping frees the mic instantly while the final transcript settles in
  the background.
- **`/stt-input/transcribe` (HTTP, batch)** - the whole clip is uploaded as
  base64; the host validates the audio, maps hotwords per provider (a
  `hotwords` array for Zhipu, a `prompt` field for OpenAI-style APIs) and
  submits `multipart/form-data`. Zhipu is called in ~5-second segments.

Both routes resolve their API key through the DSH credential service at
request time (one dedicated slot per preset - see "Managed key"); the page
never holds the value. The host uses Node >= 18 global `fetch` /
`FormData` / `Blob` plus `ws`.

## License

MIT
