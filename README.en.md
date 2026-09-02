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
  `glm-asr-2512` (Zhipu), `fun-asr-realtime-2026-02-28` (Alibaba Cloud),
  or a custom model name.
- **Configurable** — service preset (OpenAI / Groq / Zhipu / Alibaba Cloud / custom), API base URL,
  API key, recognition language, and insert mode (append to / replace the
  existing draft).
- **Live status** — a pill under the composer shows recording time,
  transcribing state, and errors.
- **Privacy** — the API key is kept in page memory only and is never persisted
  or logged; the non-secret config survives reloads via `localStorage`.

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
     The Alibaba Cloud preset uses the Beijing-compatible endpoint
     `wss://dashscope.aliyuncs.com/api-ws/v1/inference` with
     `fun-asr-realtime-2026-02-28`. The host streams 16 kHz mono PCM using the
     `run-task` → binary audio → `finish-task` protocol. Language hints support
     Chinese, English, and Japanese.
2. Click the 🎤 mic button in the composer to start, speak, and click again to
   stop. The transcript lands in the input box; press Enter to send.

> The browser engine needs Chrome or Edge (Web Speech API). In Firefox, switch
> to the API engine in Settings.

## How it works

```
┌──────────┐  click 🎤        ┌───────────────┐
│  Client  │ ───────────────▶ │ MediaRecorder │  (api engine)
│ (browser)│                  │ SpeechRecog.  │  (browser engine)
└──────────┘                  └──────┬────────┘
      ▲                              ▼
      │ setDraft(text)         base64 audio (JSON)
      │                 POST /stt-input/transcribe
      │                              │
┌─────┴──────┐              ┌───────▼────────┐
│ input box  │ ◀────────────│  Host (Node)   │
└────────────┘   {ok,text}  │ HTTP → audio/  │
                            │ transcriptions  │
                            │ or WebSocket    │
                            └─────────────────┘
```

The client (`lib/client.js`) captures audio and posts base64 JSON to the host
route `/stt-input/transcribe`. The host (`lib/index.js`) decodes the audio and
uploads it as `multipart/form-data` to the provider endpoint. OpenAI-compatible
services use `${baseUrl}/v1/audio/transcriptions`; Zhipu uses
`${baseUrl}/audio/transcriptions`, resolving to
`https://open.bigmodel.cn/api/paas/v4/audio/transcriptions`. Alibaba Cloud uses
the fixed WebSocket endpoint and the `run-task` / binary PCM / `finish-task`
protocol. The host uses Node ≥ 18 global `fetch` / `FormData` / `Blob` plus `ws`.

## License

MIT
