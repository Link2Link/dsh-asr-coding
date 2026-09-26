/* dsh-asr-coding — client bundle (web platform).
 *
 * Speech-to-text voice input for the DSH web GUI:
 *   - a 🎤 mic button in the composer tool row (conversation.input.left),
 *   - a status pill under the composer (conversation.composer.dock),
 *   - a settings page (settings.section → Voice Input) to pick the engine/model.
 *
 * Engines:
 *   - browser : Web Speech API (SpeechRecognition, Chrome/Edge), zero-config,
 *               live interim results written straight into the input box;
 *   - api     : MediaRecorder captures audio, POSTs base64 JSON to the host
 *               route /stt-input/transcribe (lib/index.js), which uploads it
 *               to an OpenAI-compatible /v1/audio/transcriptions endpoint
 *               (OpenAI / Groq / custom) with a selectable model.
 *
 * Interface strings follow the active DSH locale through the `locale` service:
 * a zh/en dictionary namespace is registered and every user-facing string is
 * resolved through `t(key)`. This keeps the plugin bilingual and in step with
 * the host's language preference instead of hard-coding a single language.
 *
 * The API key is stored through the DSH credential service (the same
 * ~/.dsh/.credentials.yaml store LLM model keys use) and never enters page
 * memory; the non-secret config lives in the HOST settings document
 * (~/.dsh/settings.yaml, `dsh-asr-coding` namespace) through the settings
 * scope service, so every browser using this DSH host shares one
 * configuration. localStorage remains only as a one-time migration source
 * and as a fallback for hosts without the settings service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-asr-coding',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var CSS =
      '.stt-mic-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--color-border,#3a3f47);background:transparent;color:var(--color-text,#e8e8e8);cursor:pointer;padding:0;transition:background .15s ease,box-shadow .15s ease;flex:none;}' +
      '.stt-mic-btn:hover{background:rgba(255,255,255,.07);}' +
      '.stt-mic-btn.stt-recording{background:rgba(239,68,68,.16);border-color:#ef4444;color:#f87171;animation:stt-pulse 1.2s ease-in-out infinite;}' +
      '.stt-mic-btn.stt-transcribing{opacity:.7;cursor:default;}' +
      '.stt-spin{animation:stt-rotate 1s linear infinite;}' +
      '.stt-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.4;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.05);color:var(--color-text-dim,#9aa0a6);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.stt-status.stt-recording{color:#f87171;}' +
      '.stt-status.stt-error{color:#f87171;background:rgba(239,68,68,.12);}' +
      '.stt-status.stt-ok{color:#4ade80;background:rgba(34,197,94,.1);}' +
      '.stt-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none;animation:stt-blink 1s ease-in-out infinite;}' +
      '.stt-settings{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;color:var(--color-text,#e8e8e8);font-size:13px;line-height:1.5;}' +
      '.stt-head{display:flex;flex-direction:column;gap:4px;}' +
      '.stt-title{font-size:16px;font-weight:600;}' +
      '.stt-desc{color:var(--color-text-dim,#9aa0a6);font-size:12px;}' +
      '.stt-field{display:flex;flex-direction:column;gap:5px;}' +
      '.stt-label{font-size:12px;color:var(--color-text-dim,#9aa0a6);}' +
      '.stt-field input,.stt-field select,.stt-field textarea{background:var(--color-bg,#15181d);border:1px solid var(--color-border,#2c313a);border-radius:7px;color:var(--color-text,#e8e8e8);padding:7px 9px;font-size:13px;}' +
      '.stt-field textarea{resize:vertical;min-height:64px;font-family:inherit;line-height:1.5;}' +
      '.stt-field textarea:focus{outline:none;border-color:var(--color-accent,#7ea2ff);}' +
      '.stt-field input:focus,.stt-field select:focus{outline:none;border-color:var(--color-accent,#7ea2ff);}' +
      '.stt-row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}' +
      '.stt-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--color-text,#e8e8e8);}' +
      '.stt-note{font-size:11px;color:var(--color-text-dim,#9aa0a6);line-height:1.7;border-top:1px solid var(--color-border,#2c313a);padding-top:10px;}' +
      '@keyframes stt-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.35);}50%{box-shadow:0 0 0 5px rgba(239,68,68,0);}}' +
      '@keyframes stt-blink{50%{opacity:.3;}}' +
      '.stt-key-editor{display:flex;flex-direction:column;gap:6px;}' +
      '.stt-key-editor input{flex:1;min-width:140px;background:var(--color-bg,#15181d);border:1px solid var(--color-border,#2c313a);border-radius:7px;color:var(--color-text,#e8e8e8);padding:7px 9px;font-size:13px;}' +
      '.stt-key-editor input:focus{outline:none;border-color:var(--color-accent,#7ea2ff);}' +
      '.stt-key-status{font-size:12px;color:var(--color-text-dim,#9aa0a6);}' +
      '.stt-key-status.stt-key-ok{color:#4ade80;}' +
      '.stt-key-status.stt-key-err{color:#f87171;}' +
      '.stt-btn{border-radius:7px;border:1px solid var(--color-border,#2c313a);background:transparent;color:var(--color-text,#e8e8e8);padding:7px 12px;font-size:12px;cursor:pointer;flex:none;}' +
      '.stt-btn:hover:not(:disabled){background:rgba(255,255,255,.07);}' +
      '.stt-btn:disabled{opacity:.5;cursor:default;}' +
      '@keyframes stt-rotate{to{transform:rotate(360deg);}}';

    // ---------- i18n ----------
    // Simplified Chinese dictionary (the key-set source of truth).
    var zh = {
      'nav': '语音输入',
      'title': '语音输入（STT）',
      'desc': '点击输入框旁的 🎤 按钮开始录音，再点一次停止并把识别文字填入输入框。',
      'engine.label': '识别引擎',
      'engine.browser': '浏览器本地识别（Chrome/Edge，无需密钥）',
      'engine.api': 'API 识别（OpenAI / Groq / 智谱 / 阿里云百炼）',
      'provider.label': '服务预设',
      'provider.openai': 'OpenAI（api.openai.com）',
      'provider.groq': 'Groq（api.groq.com，whisper-large-v3 免费）',
      'provider.zhipu': '智谱开放平台（GLM-ASR-2512）',
      'provider.aliyun': '阿里云百炼（Fun-ASR-Realtime）',
      'provider.custom': '自定义接口',
      'baseUrl.label': 'API Base URL',
      'model.label': '识别模型',
      'model.whisper1': 'whisper-1（OpenAI）',
      'model.whisperLargeV3': 'whisper-large-v3（Groq）',
      'model.whisperLargeV3Turbo': 'whisper-large-v3-turbo（Groq）',
      'model.distilEn': 'distil-whisper-large-v3-en（Groq，仅英文）',
      'model.glmAsr2512': 'glm-asr-2512（智谱）',
      'model.funAsrRealtime': 'fun-asr-realtime-2026-02-28（阿里云百炼·预览版）',
      'model.funAsrStable': 'fun-asr-realtime（阿里云百炼·默认）',
      'model.qwen3AsrFlash': 'qwen3-asr-flash-realtime（多语种·情感识别）',
      'model.custom': '自定义模型…',
      'customModel.label': '自定义模型名称',
      'customModel.placeholder': '例如 whisper-large-v3-turbo',
      'hotwords.label': '热词 / 提示词',
      'hotwords.placeholder': '专有名词、人名、术语，用逗号或换行分隔，例如：Kubernetes, GLM-ASR, 智谱',
      'hotwords.hint': '提升专有名词识别率：智谱作为热词表，OpenAI / Groq / 自定义作为提示词，fun-asr-realtime 作为识别上下文。',
      'apiKey.label': 'API Key',
      'key.configured': '已配置（来源：{source}）',
      'key.missing': '未配置 — 请输入并保存 API Key',
      'key.envShadow': '环境变量 DSH_ASR_API_KEY 正在生效，页面保存不生效',
      'key.sharedSource': '共享密钥生效中（来源：{source}）',
      'key.save': '保存',
      'key.clear': '清除',
      'language.label': '识别语言',
      'language.auto': '自动检测',
      'language.zh': '中文',
      'language.en': '英文',
      'language.ja': '日语',
      'language.yue': '粤语',
      'language.ko': '韩语',
      'language.fr': '法语',
      'language.de': '德语',
      'language.es': '西班牙语',
      'language.ru': '俄语',
      'language.pt': '葡萄牙语',
      'language.it': '意大利语',
      'language.vi': '越南语',
      'language.th': '泰语',
      'language.id': '印尼语',
      'language.hi': '印地语',
      'language.ar': '阿拉伯语',
      'language.tr': '土耳其语',
      'language.uk': '乌克兰语',
      'trigger.label': '触发方式',
      'trigger.click': '单击开始 / 再单击停止',
      'trigger.hold': '长按说话 / 松开结束',
      'insert.label': '识别结果写入方式',
      'insert.append': '追加到输入框',
      'insert.replace': '替换输入框内容',
      'note': '浏览器本地识别使用系统自带的语音识别（Chrome / Edge），即时显示中间结果、无需配置密钥；API 识别支持 OpenAI、Groq、智谱 GLM-ASR-2512、阿里云百炼 Fun-ASR-Realtime 和自定义 OpenAI 兼容接口。智谱与阿里云录音会转换为 16 kHz 单声道 WAV；智谱单段最长 30 秒。这些设置保存在 DSH 宿主本地（~/.dsh/settings.yaml），换浏览器或换电脑访问同一 DSH 时无需重新配置；API Key 通过 DSH 凭据服务保存在 ~/.dsh/.credentials.yaml（与 LLM 模型密钥同一存储），页面不再持有密钥值，刷新后依然生效。',
      'mic.recording': '正在录音，点击停止并识别',
      'mic.transcribing': '正在识别语音…',
      'mic.idle': '语音输入（点击或按 Ctrl+\\ 开始录音）',
      'mic.hold': '语音输入（长按说话，松开结束；或按住 Ctrl+\\）',
      'pill.recording': '正在录音 {secs}s — 点击麦克风停止并识别',
      'pill.requesting': '正在请求麦克风权限…',
      'pill.transcribing': '正在识别语音…',
      'pill.recognized': '已识别',
      'err.browserUnsupported': '当前浏览器不支持本地语音识别，请使用 Chrome / Edge，或在 设置→语音输入 切换到 API 识别',
      'err.localError': '本地识别出错：{err}',
      'err.startFailed': '无法启动本地识别：{err}',
      'err.micUnsupported': '当前浏览器不支持麦克风录音',
      'err.micAccess': '无法访问麦克风：{err}',
      'err.noAudio': '未录制到音频，请重试',
      'err.noSpeech': '未识别到语音，请重试',
      'err.tooLong': '录音过长，请分段识别',
      'err.zhipuTooLong': '智谱 GLM-ASR-2512 单段音频最长 30 秒，请缩短录音',
      'err.audioConvert': '无法将录音转换为服务商要求的 WAV 格式：{err}',
      'err.streamConnect': '无法连接实时识别通道，请检查网络后重试',
      'err.streamClosed': '实时识别通道意外关闭',
      'err.recognition': '识别出错：{err}',
      'err.stopFailed': '停止识别失败',
      'err.missingAudio': '缺少音频数据',
      'err.missingKey': '未配置 API Key（请在 设置 → 语音输入 中保存）',
      'err.decodeFailed': '音频数据解码失败',
      'err.unsupportedAudio': '当前服务不支持这种音频格式：{detail}',
      'err.invalidAudio': '音频文件无效：{detail}',
      'err.audioTooLarge': '音频数据过大，请缩短录音',
      'err.invalidEndpoint': '自定义 API 地址无效，必须使用不带认证信息和自定义端口的 HTTPS 地址',
      'err.forbidden': '请求来源校验失败，请从当前 DSH 页面重试',
      'err.timeout': '请求超时',
      'err.requestFailed': '请求失败：{detail}',
      'err.apiError': '{detail}',
      'err.failed': '识别失败，请检查 API Key 与网络'
    };
    // English dictionary, key-matched against zh.
    var en = {
      'nav': 'Voice Input',
      'title': 'Voice Input (STT)',
      'desc': 'Click the 🎤 button next to the input box to start recording; click it again to stop and fill the recognized text into the input box.',
      'engine.label': 'Recognition engine',
      'engine.browser': 'Browser local recognition (Chrome/Edge, no API key)',
      'engine.api': 'API recognition (OpenAI / Groq / Zhipu / Alibaba Cloud)',
      'provider.label': 'Provider preset',
      'provider.openai': 'OpenAI (api.openai.com)',
      'provider.groq': 'Groq (api.groq.com, free whisper-large-v3)',
      'provider.zhipu': 'Zhipu Open Platform (GLM-ASR-2512)',
      'provider.aliyun': 'Alibaba Cloud Model Studio (Fun-ASR-Realtime)',
      'provider.custom': 'Custom endpoint',
      'baseUrl.label': 'API Base URL',
      'model.label': 'Recognition model',
      'model.whisper1': 'whisper-1 (OpenAI)',
      'model.whisperLargeV3': 'whisper-large-v3 (Groq)',
      'model.whisperLargeV3Turbo': 'whisper-large-v3-turbo (Groq)',
      'model.distilEn': 'distil-whisper-large-v3-en (Groq, English only)',
      'model.glmAsr2512': 'glm-asr-2512 (Zhipu)',
      'model.funAsrRealtime': 'fun-asr-realtime-2026-02-28 (Alibaba Cloud preview)',
      'model.funAsrStable': 'fun-asr-realtime (Alibaba Cloud, default)',
      'model.qwen3AsrFlash': 'qwen3-asr-flash-realtime (multilingual, emotion)',
      'model.custom': 'Custom model…',
      'customModel.label': 'Custom model name',
      'customModel.placeholder': 'e.g. whisper-large-v3-turbo',
      'hotwords.label': 'Hotwords / prompt',
      'hotwords.placeholder': 'Proper nouns, names, and terms, separated by commas or newlines, e.g. Kubernetes, GLM-ASR, Zhipu',
      'hotwords.hint': 'Improves recognition of proper nouns: sent as a hotword list to Zhipu, a prompt to OpenAI / Groq / custom endpoints, and recognition context to fun-asr-realtime.',
      'apiKey.label': 'API Key',
      'key.configured': 'Configured (source: {source})',
      'key.missing': 'Not configured — enter and save an API key',
      'key.envShadow': 'The DSH_ASR_API_KEY environment variable is active; page saves are ignored',
      'key.sharedSource': 'shared key in effect (source: {source})',
      'key.save': 'Save',
      'key.clear': 'Clear',
      'language.label': 'Recognition language',
      'language.auto': 'Auto-detect',
      'language.zh': 'Chinese',
      'language.en': 'English',
      'language.ja': 'Japanese',
      'language.yue': 'Cantonese',
      'language.ko': 'Korean',
      'language.fr': 'French',
      'language.de': 'German',
      'language.es': 'Spanish',
      'language.ru': 'Russian',
      'language.pt': 'Portuguese',
      'language.it': 'Italian',
      'language.vi': 'Vietnamese',
      'language.th': 'Thai',
      'language.id': 'Indonesian',
      'language.hi': 'Hindi',
      'language.ar': 'Arabic',
      'language.tr': 'Turkish',
      'language.uk': 'Ukrainian',
      'trigger.label': 'Trigger style',
      'trigger.click': 'Click to start, click again to stop',
      'trigger.hold': 'Hold to talk, release to stop',
      'insert.label': 'How to insert the recognized text',
      'insert.append': 'Append to the input box',
      'insert.replace': 'Replace the input box content',
      'note': 'Browser local recognition uses the system\'s built-in speech recognition (Chrome/Edge). API recognition supports OpenAI, Groq, Zhipu GLM-ASR-2512, Alibaba Cloud Fun-ASR-Realtime, and custom OpenAI-compatible endpoints. Zhipu and Alibaba Cloud recordings are converted to 16 kHz mono WAV; Zhipu clips are limited to 30 seconds. These settings are stored on the DSH host (~/.dsh/settings.yaml), so a new browser talking to the same DSH starts already configured; the API key is stored through the DSH credential service in ~/.dsh/.credentials.yaml (the same store as LLM model keys) — the page never holds the value and it survives reloads.',
      'mic.recording': 'Recording — click to stop and transcribe',
      'mic.transcribing': 'Transcribing…',
      'mic.idle': 'Voice input (click or press Ctrl+\\ to start recording)',
      'mic.hold': 'Voice input (hold to talk, release to stop; or hold Ctrl+\\)',
      'pill.recording': 'Recording {secs}s — click the mic to stop and transcribe',
      'pill.requesting': 'Requesting microphone access…',
      'pill.transcribing': 'Transcribing…',
      'pill.recognized': 'Recognized',
      'err.browserUnsupported': 'Local speech recognition is not supported in this browser. Please use Chrome/Edge, or switch to API recognition in Settings → Voice Input.',
      'err.localError': 'Local recognition error: {err}',
      'err.startFailed': 'Could not start local recognition: {err}',
      'err.micUnsupported': 'This browser does not support microphone recording',
      'err.micAccess': 'Unable to access microphone: {err}',
      'err.noAudio': 'No audio recorded, please try again',
      'err.noSpeech': 'No speech was recognized; please try again',
      'err.tooLong': 'Recording too long, please split it into shorter segments',
      'err.zhipuTooLong': 'Zhipu GLM-ASR-2512 accepts audio clips up to 30 seconds; please shorten the recording',
      'err.audioConvert': 'Could not convert the recording to the WAV format required by the provider: {err}',
      'err.streamConnect': 'Could not open the live transcription channel; check your network and retry',
      'err.streamClosed': 'The live transcription channel closed unexpectedly',
      'err.recognition': 'Recognition error: {err}',
      'err.stopFailed': 'Failed to stop recognition',
      'err.missingAudio': 'Missing audio data',
      'err.missingKey': 'No API key configured (save it under Settings → Voice Input)',
      'err.decodeFailed': 'Failed to decode audio data',
      'err.unsupportedAudio': 'The selected service does not support this audio format: {detail}',
      'err.invalidAudio': 'Invalid audio file: {detail}',
      'err.audioTooLarge': 'The audio payload is too large; please shorten the recording',
      'err.invalidEndpoint': 'The custom API URL must be HTTPS without embedded credentials or a custom port',
      'err.forbidden': 'Request origin validation failed; retry from the current DSH page',
      'err.timeout': 'Request timed out',
      'err.requestFailed': 'Request failed: {detail}',
      'err.apiError': '{detail}',
      'err.failed': 'Recognition failed, please check your API Key and network'
    };

    // Locale namespace owning this plugin's texts.
    var NS = 'dsh-asr-coding';
    var API_KEY_REF = 'DSH_ASR_API_KEY';
    var KEY_REF_BY_PROVIDER = {
      openai: 'DSH_ASR_OPENAI_KEY',
      groq: 'DSH_ASR_GROQ_KEY',
      zhipu: 'DSH_ASR_ZHIPU_KEY',
      aliyun: 'DSH_ASR_ALIYUN_KEY',
      custom: 'DSH_ASR_CUSTOM_KEY'
    };

    // ---------- config (persist non-secret parts, never the API key) ----------
    // Primary store: the HOST settings document (`dsh-asr-coding` namespace
    // in ~/.dsh/settings.yaml) through the settingsScope service — shared by
    // every browser, so a new browser starts already configured. localStorage
    // is only read once to migrate legacy saves (then removed) and written
    // only when the host exposes no settings scope.
    var CONFIG_KEY = 'dsh-asr-coding:config';
    var SETTINGS_NS = 'dsh-asr-coding';
    var DEFAULT_CONFIG = {
      engine: 'browser',
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'whisper-1',
      customModel: '',
      hotwords: '',
      language: 'auto',
      insertMode: 'append',
      triggerMode: 'click'
    };

    function coerceConfig(saved) {
      var cfg = {};
      for (var k in DEFAULT_CONFIG) cfg[k] = DEFAULT_CONFIG[k];
      if (saved && typeof saved === 'object') {
        for (var k2 in saved) {
          if (k2 !== 'apiKey' && k2 in cfg) cfg[k2] = saved[k2];
        }
      }
      return cfg;
    }

    function readLocalConfig() {
      try {
        var raw = window.localStorage.getItem(CONFIG_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') return coerceConfig(saved);
        }
      } catch (e) {}
      return null;
    }

    function writeLocalConfig(cfg) {
      try {
        var copy = {};
        for (var k in cfg) {
          if (k !== 'apiKey') copy[k] = cfg[k];
        }
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(copy));
      } catch (e) {}
    }

    function clearLocalConfig() {
      try { window.localStorage.removeItem(CONFIG_KEY); } catch (e) {}
    }

    // ---------- shared store ----------
    var store = {
      // Paint instantly from localStorage when present (legacy browsers);
      // the host snapshot replaces this as soon as the settings scope is
      // ready, and migration removes the local copy afterwards.
      config: (function () { var local = readLocalConfig(); return local || coerceConfig(null); })(),
      status: { kind: 'idle' },
      listeners: new Set(),
      timer: undefined,
      apiClient: null,
      keyStatus: { loaded: false, configured: false, source: '', writable: true, error: '' },
      // Host settings scope (settingsScope service), null until bound or
      // when the host serves no settings namespace.
      settingsScope: null,
      // 'host' once the scope serves the namespace, 'local' when falling
      // back to localStorage, 'pending' before the first snapshot.
      persistMode: 'pending',
      pendingPatch: null, // accumulated writes awaiting the debounce flush
      persistTimer: undefined,
      persistInFlight: false,
      t: null // bound translate function, set once the locale service is available
    };

    function notify() {
      var fns = Array.from(store.listeners);
      for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} }
    }

    function setConfig(patch) {
      for (var k in patch) store.config[k] = patch[k];
      if (store.persistMode !== 'local') scheduleHostPersist(patch);
      else writeLocalConfig(store.config);
      notify();
    }

    // ---------- host settings persistence ----------
    // Writes debounce into one batch (text fields fire per keystroke), then
    // queue on the scope's serialized write chain with revision fencing.
    function scheduleHostPersist(patch) {
      if (!store.settingsScope) return;
      if (!store.pendingPatch) store.pendingPatch = {};
      for (var k in patch) store.pendingPatch[k] = store.config[k];
      if (store.persistTimer) clearTimeout(store.persistTimer);
      store.persistTimer = setTimeout(flushHostPersist, 500);
      if (typeof store.persistTimer.unref === 'function') store.persistTimer.unref();
    }

    function flushHostPersist() {
      if (store.persistTimer) { clearTimeout(store.persistTimer); store.persistTimer = undefined; }
      var patch = store.pendingPatch;
      store.pendingPatch = null;
      var scope = store.settingsScope;
      if (!patch || !scope || typeof scope.set !== 'function') return;
      store.persistInFlight = true;
      var writes = [];
      for (var k in patch) {
        (function (field, value) {
          writes.push(Promise.resolve().then(function () { return scope.set(field, value); }));
        })(k, patch[k]);
      }
      Promise.all(writes).then(function () {
        store.persistInFlight = false;
      }).catch(function (e) {
        store.persistInFlight = false;
        try { console.warn('[dsh-asr-coding] host settings write failed:', e && e.message ? e.message : e); } catch (e2) {}
        // The scope already re-read host state after a failed write; the
        // values stay live in this session's memory and the next change
        // retries the durable write.
      });
    }

    function applyRemoteConfig(value) {
      var next = coerceConfig(value);
      var changed = false;
      for (var k in next) {
        if (store.config[k] !== next[k]) { store.config[k] = next[k]; changed = true; }
      }
      if (changed) notify();
    }

    // Bind the host settings scope and follow its snapshots. One-time
    // migration: when the host document has no user layer yet but this
    // browser still carries a legacy localStorage config, push it up and drop
    // the local copy so the host becomes the single source of truth.
    function initSettingsScope(ctx) {
      var forms = null;
      try {
        forms = (typeof ctx.get === 'function') ? ctx.get('configForms') : null;
      } catch (e) { forms = null; }
      if (!forms || typeof forms.get !== 'function') return;
      var scope;
      try { scope = forms.get(SETTINGS_NS); }
      catch (e) { return; }
      store.settingsScope = scope;

      var migrated = false;
      var applySnapshot = function () {
        var snap = (typeof scope.getSnapshot === 'function') ? scope.getSnapshot() : null;
        if (!snap || snap.status !== 'ready') {
          if (snap && snap.status === 'unavailable') {
            // Host serves no settings namespace (older host, or a non-loopback
            // connection where settings RPCs are disabled): legacy mode.
            if (store.persistMode !== 'local') {
              store.persistMode = 'local';
              store.settingsScope = null;
              writeLocalConfig(store.config);
            }
          }
          return;
        }
        store.persistMode = 'host';
        var userLayer = snap.user;
        var hasUserLayer = Boolean(userLayer && typeof userLayer === 'object' && Object.keys(userLayer).length > 0);
        if (!migrated) {
          migrated = true;
          if (!hasUserLayer) {
            var local = readLocalConfig();
            if (local) {
              var patch = {};
              var touched = false;
              for (var k in local) {
                if (k in DEFAULT_CONFIG && local[k] !== DEFAULT_CONFIG[k]) { patch[k] = local[k]; touched = true; }
              }
              if (touched) {
                for (var pk in patch) {
                  (function (field, value) {
                    Promise.resolve().then(function () { return scope.set(field, value); })
                      .catch(function (e) { try { console.warn('[dsh-asr-coding] settings migration write failed:', e && e.message ? e.message : e); } catch (e2) {} });
                  })(pk, patch[pk]);
                }
              }
            }
            clearLocalConfig();
            return;
          }
          // Host already carries settings (another browser saved them): the
          // host value wins over any stale localStorage copy.
          clearLocalConfig();
          applyRemoteConfig(snap.value);
          return;
        }
        // Live updates from other browsers (or our own writes folding back):
        // never clobber values a local edit is still persisting.
        if (!store.pendingPatch && !store.persistInFlight) applyRemoteConfig(snap.value);
      };
      try {
        scope.subscribe(applySnapshot);
      } catch (e) { return; }
      applySnapshot();
    }

    function setStatus(s) { store.status = s; notify(); }

    function refreshKeyStatus(ref) {
      var keyRef = ref || API_KEY_REF;
      var api = store.apiClient;
      if (!api || !api.credentials || typeof api.credentials.describe !== 'function') return Promise.resolve();
      return api.credentials.describe({ refs: [keyRef, API_KEY_REF] }).then(function (r) {
        if (r && r.result && r.result.ok) {
          var view = r.result.value.credentials[keyRef];
          var shared = keyRef === API_KEY_REF ? null : r.result.value.credentials[API_KEY_REF];
          var ownConfigured = Boolean(view && view.configured);
          store.keyStatus = {
            loaded: true,
            configured: ownConfigured || Boolean(shared && shared.configured),
            own: ownConfigured,
            source: ownConfigured
              ? (view && view.source ? String(view.source) : '')
              : (shared && shared.configured ? 'shared:' + (shared.source || '') : ''),
            writable: !(view && view.writable === false),
            error: ''
          };
        } else {
          store.keyStatus = { loaded: true, configured: false, source: '', writable: true, error: (r && r.result && r.result.error && r.result.error.message) || 'describe failed' };
        }
        notify();
      }).catch(function (e) {
        store.keyStatus = { loaded: true, configured: false, source: '', writable: true, error: (e && e.message) || String(e) };
        notify();
      });
    }

    function subscribe(fn) {
      store.listeners.add(fn);
      return function () { store.listeners.delete(fn); };
    }

    function useStore() {
      var state = React.useState(0);
      var force = state[1];
      React.useEffect(function () {
        return subscribe(function () { force(function (n) { return n + 1; }); });
      }, []);
      return store;
    }

    // Translate helper. Prefers the locale-service-bound translate (reads the
    // active DSH locale at call time); degrades to the English dictionary when
    // the locale service is unavailable. Params interpolate {name} placeholders.
    function T(key, params) {
      if (store.t) return store.t(key, params);
      var s = Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
      if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m; });
      return s;
    }

    // ---------- recording session (module-level, shared by button + pill) ----------
    var activeRec = null;
    var pendingMic = false;
    var micRequestToken = 0;
    var browserToken = 0;
    var browserWanted = false;
    var activeStream = null;
    var recChunks = [];
    var recStartedAt = 0;

    function browserSR() {
      return (typeof window !== 'undefined') ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
    }

    function pickMime() {
      if (typeof MediaRecorder === 'undefined') return null;
      var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      for (var i = 0; i < list.length; i++) {
        try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
      }
      return null;
    }

    function bytesToBase64(bytes) {
      var bin = '';
      var CHUNK = 0x8000;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }

    function writeAscii(view, offset, value) {
      for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    }

    // GLM-ASR-2512 accepts WAV/MP3 only, while MediaRecorder normally produces
    // WebM or MP4. Decode the browser recording, down-mix it to mono, resample
    // to 16 kHz and encode PCM16 WAV before sending it to the host.
    function convertBlobToWav(blob) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return Promise.reject(new Error('AudioContext is unavailable'));
      var audioContext = new AudioContextClass();
      return blob.arrayBuffer().then(function (encoded) {
        return audioContext.decodeAudioData(encoded.slice(0));
      }).then(function (audioBuffer) {
        var sourceRate = audioBuffer.sampleRate;
        var targetRate = 16000;
        var sourceLength = audioBuffer.length;
        var targetLength = Math.max(1, Math.ceil(sourceLength * targetRate / sourceRate));
        var channels = audioBuffer.numberOfChannels;
        var samples = new Float32Array(targetLength);
        for (var i = 0; i < targetLength; i++) {
          var sourcePos = i * sourceRate / targetRate;
          var left = Math.min(sourceLength - 1, Math.floor(sourcePos));
          var right = Math.min(sourceLength - 1, left + 1);
          var mix = sourcePos - left;
          var sample = 0;
          for (var channel = 0; channel < channels; channel++) {
            var data = audioBuffer.getChannelData(channel);
            sample += data[left] + (data[right] - data[left]) * mix;
          }
          samples[i] = sample / channels;
        }
        var wav = new ArrayBuffer(44 + samples.length * 2);
        var view = new DataView(wav);
        writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeAscii(view, 8, 'WAVE');
        writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, targetRate, true);
        view.setUint32(28, targetRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);
        for (var j = 0; j < samples.length; j++) {
          var value = Math.max(-1, Math.min(1, samples[j]));
          view.setInt16(44 + j * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        }
        return {
          audioBase64: bytesToBase64(new Uint8Array(wav)),
          mimeType: 'audio/wav',
          duration: audioBuffer.duration,
          byteLength: wav.byteLength
        };
      }).finally(function () {
        try { audioContext.close(); } catch (e) {}
      });
    }

    // ---------- live streaming session (zhipu / aliyun realtime) ----------
    var PCM_RATE = 16000;
    var ZHIPU_SEGMENT_MS = 5000;
    var ZHIPU_MIN_FLUSH_SAMPLES = Math.round(PCM_RATE * 0.4);
    var liveSession = null;

    var WORKLET_SRC = [
      "class PcmPublisher extends AudioWorkletProcessor {",
      "  constructor(options) { super();",
      "    this.target = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;",
      "    this.ratio = sampleRate / this.target;",
      "  }",
      "  process(inputs) {",
      "    const ch = inputs[0] && inputs[0][0];",
      "    if (!ch || !ch.length) return true;",
      "    const n = Math.max(1, Math.floor(ch.length / this.ratio));",
      "    const buf = new Int16Array(n);",
      "    for (let i = 0; i < n; i++) {",
      "      const p = i * this.ratio;",
      "      const i0 = Math.floor(p);",
      "      const i1 = Math.min(i0 + 1, ch.length - 1);",
      "      const frac = p - i0;",
      "      let s = ch[i0] + (ch[i1] - ch[i0]) * frac;",
      "      s = Math.max(-1, Math.min(1, s));",
      "      buf[i] = s < 0 ? s * 32768 : s * 32767;",
      "    }",
      "    this.port.postMessage(buf.buffer, [buf.buffer]);",
      "    return true;",
      "  }",
      "}",
      "registerProcessor('pcm-publisher', PcmPublisher);"
    ].join('\n');

    function convertBlockToInt16(channel) {
      var ratio = channel.length / PCM_RATE;
      var n = Math.max(1, Math.floor(channel.length / ratio));
      var out = new Int16Array(n);
      for (var i = 0; i < n; i++) {
        var p = i * ratio;
        var i0 = Math.floor(p);
        var i1 = Math.min(i0 + 1, channel.length - 1);
        var frac = p - i0;
        var s = Math.max(-1, Math.min(1, channel[i0] + (channel[i1] - channel[i0]) * frac));
        out[i] = s < 0 ? s * 32768 : s * 32767;
      }
      return out;
    }

    function pcmFramesToWavBase64(frames) {
      var samples = 0;
      for (var i = 0; i < frames.length; i++) samples += frames[i].length;
      var wav = new ArrayBuffer(44 + samples * 2);
      var view = new DataView(wav);
      writeAscii(view, 0, 'RIFF');
      view.setUint32(4, 36 + samples * 2, true);
      writeAscii(view, 8, 'WAVE');
      writeAscii(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, PCM_RATE, true);
      view.setUint32(28, PCM_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, 'data');
      view.setUint32(40, samples * 2, true);
      var offset = 44;
      for (var f = 0; f < frames.length; f++) {
        var frame = frames[f];
        for (var j = 0; j < frame.length; j++) {
          view.setInt16(offset, frame[j], true);
          offset += 2;
        }
      }
      return bytesToBase64(new Uint8Array(wav));
    }

    function applyText(inputActions, base, text) {
      var t = (text || '').trim();
      var next = t ? (base ? base + ' ' + t : t) : base;
      inputActions.setDraft(next);
    }

    function callTranscribe(payload) {
      var options = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload)
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        options.signal = AbortSignal.timeout(60000);
      }
      return fetch('/stt-input/transcribe', options).then(function (res) { return res.json(); });
    }

    // Map a host error result ({ code, detail }) to a localized message. The
    // host returns stable machine-readable codes; UI wording is resolved here
    // against the active locale. Unknown codes fall back to the raw detail.
    function errorMessage(r) {
      if (!r || typeof r !== 'object') return T('err.failed');
      var code = r.code || '';
      var detail = r.detail || '';
      switch (code) {
        case 'missing_audio': return T('err.missingAudio');
        case 'no_speech': return T('err.noSpeech');
        case 'missing_key': return T('err.missingKey');
        case 'decode_failed': return T('err.decodeFailed');
        case 'unsupported_audio': return T('err.unsupportedAudio', { detail: detail });
        case 'invalid_audio': return T('err.invalidAudio', { detail: detail });
        case 'audio_too_large': return T('err.audioTooLarge');
        case 'audio_too_long': return T('err.zhipuTooLong');
        case 'invalid_endpoint': return T('err.invalidEndpoint');
        case 'stream_connect': return T('err.streamConnect');
        case 'stream_closed': return T('err.streamClosed');
        case 'forbidden': return T('err.forbidden');
        case 'timeout': return T('err.timeout');
        case 'request_failed': return detail ? T('err.requestFailed', { detail: detail }) : T('err.requestFailed');
        case 'api_error': return detail || r.error || T('err.failed');
        default: return detail || r.error || T('err.failed');
      }
    }

    function startRecording(inputActions, base, cfg) {
      if (liveSession || activeRec || pendingMic) return;
      if (cfg.engine === 'api' && (cfg.provider === 'zhipu' || cfg.provider === 'aliyun')) {
        startLiveSession(inputActions, base, cfg);
        return;
      }
      recStartedAt = Date.now();
      if (cfg.engine === 'browser') {
        var SR = browserSR();
        if (!SR) {
          setStatus({ kind: 'error', msg: T('err.browserUnsupported') });
          return;
        }
        var myToken = ++browserToken;
        browserWanted = true;
        var finalText = '';
        var spawn = function () {
          var rec = new SR();
          rec.lang = cfg.language === 'auto' ? (navigator.language || 'en') : cfg.language;
          rec.continuous = true;
          rec.interimResults = true;
          rec.onresult = function (e) {
          // Iterate from index 0 (not e.resultIndex) so transcripts that were
          // already finalized before a pause are always retained. Iterating from
          // resultIndex would drop any earlier recognized text after a pause,
          // erasing part of the draft in both append and replace modes.
          var f = '';
          var it = '';
          for (var i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) f += e.results[i][0].transcript;
            else it = e.results[i][0].transcript; // last (current) interim hypothesis only
          }
          finalText = f;
          var combined = (f + it).replace(/\s+$/, '');
          applyText(inputActions, base, combined);
        };
          rec.onerror = function (e) {
            var name = (e && e.error) || 'unknown';
            // Transient conditions: onend follows and restarts if still wanted.
            if (name === 'no-speech' || name === 'aborted') return;
            browserWanted = false;
            activeRec = null;
            setStatus({ kind: 'error', msg: T('err.localError', { err: name }) });
          };
          rec.onend = function () {
            activeRec = null;
            if (browserWanted && myToken === browserToken) {
              // Chrome ends a continuous session after a few seconds of
              // silence; restart transparently so the recording the user
              // started stays alive until they click stop.
              try { spawn(); return; } catch (e) {}
            }
            applyText(inputActions, base, finalText);
            setStatus({ kind: 'idle' });
          };
          activeRec = rec;
          try { rec.start(); } catch (e) {
            activeRec = null;
            setStatus({ kind: 'error', msg: T('err.startFailed', { err: ((e && e.message) || String(e)) }) });
          }
        };
        setStatus({ kind: 'recording' });
        try { spawn(); } catch (e) {
          setStatus({ kind: 'error', msg: T('err.startFailed', { err: ((e && e.message) || String(e)) }) });
        }
      } else {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus({ kind: 'error', msg: T('err.micUnsupported') });
          return;
        }
        pendingMic = true;
        var requestToken = ++micRequestToken;
        setStatus({ kind: 'requesting' });
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          if (requestToken !== micRequestToken) {
            var staleTracks = stream.getTracks();
            for (var stale = 0; stale < staleTracks.length; stale++) { try { staleTracks[stale].stop(); } catch (e) {} }
            return;
          }
          pendingMic = false;
          activeStream = stream;
          try {
            var mime = pickMime();
            var opts = { audioBitsPerSecond: 32000 };
            if (mime) opts.mimeType = mime;
            var rec = new MediaRecorder(stream, opts);
            recChunks = [];
            rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) recChunks.push(e.data); };
            rec.onstop = function () {
              var tracks = stream.getTracks();
              for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
              activeStream = null;
              finalizeApi(inputActions, base, cfg);
            };
            rec.start();
            activeRec = rec;
            setStatus({ kind: 'recording' });
          } catch (e) {
            var tracks = stream.getTracks();
            for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (stopError) {} }
            activeStream = null;
            throw e;
          }
        }).catch(function (e) {
          if (requestToken !== micRequestToken) return;
          pendingMic = false;
          var name = (e && e.name) || (e && e.message) || String(e);
          setStatus({ kind: 'error', msg: T('err.micAccess', { err: name }) });
        });
      }
    }

    function finalizeApi(inputActions, base, cfg) {
      setStatus({ kind: 'transcribing' });
      if (!recChunks.length) {
        setStatus({ kind: 'error', msg: T('err.noAudio') });
        return;
      }
      var mime = recChunks[0].type || 'audio/webm';
      var blob = new Blob(recChunks, { type: mime });
      var isZhipu = cfg.provider === 'zhipu';
      var isAliyun = cfg.provider === 'aliyun';
      var audioPromise = (isZhipu || isAliyun)
        ? convertBlobToWav(blob)
        : blob.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            return { audioBase64: bytesToBase64(bytes), mimeType: mime, byteLength: bytes.byteLength };
          });
      audioPromise.then(function (audio) {
        if (isZhipu && audio.duration > 30) {
          setStatus({ kind: 'error', msg: T('err.zhipuTooLong') });
          return null;
        }
        var byteLength = audio.byteLength == null ? Math.floor(audio.audioBase64.length * 3 / 4) : audio.byteLength;
        if (byteLength > 6 * 1024 * 1024) {
          setStatus({ kind: 'error', msg: T('err.tooLong') });
          return null;
        }
        return callTranscribe({
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
          model: cfg.model === 'custom' ? (cfg.customModel || 'whisper-1') : cfg.model,
          baseUrl: cfg.baseUrl,
          language: cfg.language === 'auto' ? '' : cfg.language,
          prompt: cfg.hotwords || '',
          provider: cfg.provider
        });
      }).then(function (r) {
        if (!r) return;
        if (r.ok && r.text) {
          applyText(inputActions, base, r.text);
          setStatus({ kind: 'idle' });
        } else {
          setStatus({ kind: 'error', msg: errorMessage(r) });
        }
      }).catch(function (e) {
        var err = (e && e.message) || String(e);
        setStatus({ kind: 'error', msg: (isZhipu || isAliyun) ? T('err.audioConvert', { err: err }) : T('err.recognition', { err: err }) });
      });
    }

    function liveDraftText(session) {
      var text = session.committed;
      if (session.interim) text = (text ? text + ' ' : '') + session.interim;
      return text.trim();
    }

    function pushLiveDraft(session) {
      applyText(session.inputActions, session.base, liveDraftText(session));
    }

    function teardownLiveAudio(session) {
      if (session.node) {
        try { session.node.disconnect(); } catch (e) {}
        session.node = null;
      }
      if (session.context) {
        try { session.context.close(); } catch (e) {}
        session.context = null;
      }
      if (session.stream) {
        var tracks = session.stream.getTracks();
        for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
        session.stream = null;
      }
      activeStream = null;
    }

    function endLive(session, error) {
      if (session.finishTimer) { clearTimeout(session.finishTimer); session.finishTimer = null; }
      if (session.segmentTimer) { clearInterval(session.segmentTimer); session.segmentTimer = null; }
      if (session.ws) {
        try { session.ws.onmessage = null; session.ws.onclose = null; session.ws.onerror = null; session.ws.close(); } catch (e) {}
        session.ws = null;
      }
      teardownLiveAudio(session);
      if (liveSession === session) liveSession = null;
      if (error) setStatus({ kind: 'error', msg: errorMessage(error) });
      else setStatus({ kind: 'idle' });
    }

    function fallbackLiveToBatch(session) {
      // If the live session already produced recognized text, do NOT run the
      // whole clip through the batch path again — that would duplicate the
      // transcript and keep the spinner busy for the full re-upload.
      if (session.committed) {
        endLive(session, null);
        return;
      }
      if (!session.allFrames.length) {
        endLive(session, { code: 'no_speech' });
        return;
      }
      var cfg = session.cfg;
      var b64 = pcmFramesToWavBase64(session.allFrames);
      callTranscribe({
        audioBase64: b64,
        mimeType: 'audio/wav',
        model: cfg.model === 'custom' ? (cfg.customModel || 'whisper-1') : cfg.model,
        baseUrl: cfg.baseUrl,
        language: cfg.language === 'auto' ? '' : cfg.language,
        prompt: cfg.hotwords || '',
        provider: cfg.provider
      }).then(function (r) {
        if (r && r.ok && r.text) {
          session.committed = (session.committed + ' ' + r.text).trim();
          session.interim = '';
          pushLiveDraft(session);
          endLive(session, null);
        } else {
          endLive(session, r && typeof r === 'object' ? r : { code: 'failed' });
        }
      }).catch(function (e) {
        endLive(session, { code: 'request_failed', detail: (e && e.message) || String(e) });
      });
    }

    function handleLiveError(session, error) {
      if (session.kind === 'aliyun' && !session.committed && session.allFrames.length) {
        if (session.ws) { try { session.ws.onmessage = null; session.ws.onclose = null; session.ws.onerror = null; session.ws.close(); } catch (e) {} session.ws = null; }
        fallbackLiveToBatch(session);
        return;
      }
      endLive(session, error);
    }

    function flushZhipuSegment(session, force) {
      var frames = session.segmentFrames.splice(0);
      if (!frames.length) return Promise.resolve(false);
      var samples = 0;
      for (var i = 0; i < frames.length; i++) samples += frames[i].length;
      if (!force && samples < ZHIPU_MIN_FLUSH_SAMPLES) {
        session.segmentFrames = frames.concat(session.segmentFrames);
        return Promise.resolve(false);
      }
      var cfg = session.cfg;
      var b64 = pcmFramesToWavBase64(frames);
      return callTranscribe({
        audioBase64: b64,
        mimeType: 'audio/wav',
        model: cfg.model === 'custom' ? (cfg.customModel || 'whisper-1') : cfg.model,
        baseUrl: cfg.baseUrl,
        language: cfg.language === 'auto' ? '' : cfg.language,
        prompt: cfg.hotwords || '',
        provider: 'zhipu'
      }).then(function (r) {
        if (r && r.ok && r.text) {
          session.committed = (session.committed + ' ' + r.text).trim();
          session.interim = '';
          pushLiveDraft(session);
          return true;
        }
        if (r && !r.ok) {
          session.stopped = true;
          teardownLiveAudio(session);
          endLive(session, r);
          return true;
        }
        return false;
      });
    }

    function closeLiveSocket(session) {
      if (session.finishTimer) { clearTimeout(session.finishTimer); session.finishTimer = null; }
      if (session.ws) {
        try { session.ws.onmessage = null; session.ws.onclose = null; session.ws.onerror = null; session.ws.close(); } catch (e) {}
        session.ws = null;
      }
    }

    function stopLiveSession() {
      var session = liveSession;
      if (!session || session.stopped) return;
      session.stopped = true;
      setStatus({ kind: 'transcribing' });
      teardownLiveAudio(session);
      if (session.kind === 'aliyun') {
        if (session.ws && session.ws.readyState === 1) {
          try { session.ws.send(JSON.stringify({ type: 'finish' })); } catch (e) {}
          if (session.committed) {
            // Text is already on screen (measured: finish->done ~20ms for
            // fun-asr-realtime). Free the mic and the spinner immediately and
            // let the socket finish quietly; the final aggregate replaces the
            // draft once it lands, guarded so it never clobbers a newer
            // recording the user may already have started.
            session.finalizing = true;
            liveSession = null;
            setStatus({ kind: 'idle' });
            session.finishTimer = setTimeout(function () { closeLiveSocket(session); }, 4000);
            return;
          }
          session.finishTimer = setTimeout(function () {
            if (liveSession !== session) return;
            fallbackLiveToBatch(session);
          }, 5000);
        } else {
          fallbackLiveToBatch(session);
        }
      } else {
        if (session.segmentTimer) { clearInterval(session.segmentTimer); session.segmentTimer = null; }
        Promise.race([
          Promise.resolve(flushZhipuSegment(session, true)).catch(function (e) { return null; }),
          new Promise(function (resolve) { setTimeout(resolve, 10000); })
        ]).then(function () {
          if (liveSession === session) endLive(session, session.committed ? null : { code: 'no_speech' });
        });
      }
    }

    function disposeLiveSession() {
      var session = liveSession;
      if (!session) return;
      session.stopped = true;
      if (session.finishTimer) { clearTimeout(session.finishTimer); session.finishTimer = null; }
      if (session.segmentTimer) { clearInterval(session.segmentTimer); session.segmentTimer = null; }
      if (session.ws) {
        try { session.ws.onmessage = null; session.ws.onclose = null; session.ws.onerror = null; session.ws.close(); } catch (e) {}
        session.ws = null;
      }
      teardownLiveAudio(session);
      liveSession = null;
    }

    function startLiveSession(inputActions, base, cfg) {
      if (liveSession || activeRec || pendingMic) return;
      pendingMic = true;
      var requestToken = ++micRequestToken;
      setStatus({ kind: 'requesting' });
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        if (requestToken !== micRequestToken) {
          var stale = stream.getTracks();
          for (var s = 0; s < stale.length; s++) { try { stale[s].stop(); } catch (e) {} }
          return;
        }
        pendingMic = false;
        activeStream = stream;
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        var context;
        try { context = new AudioContextClass({ sampleRate: PCM_RATE }); }
        catch (e) { context = new AudioContextClass(); }
        var session = {
          kind: cfg.provider,
          inputActions: inputActions,
          base: base,
          cfg: cfg,
          stream: stream,
          context: context,
          node: null,
          ws: null,
          segmentFrames: [],
          allFrames: [],
          committed: '',
          interim: '',
          finishing: false,
          stopped: false,
          segmentTimer: null,
          finishTimer: null
        };
        liveSession = session;
        recStartedAt = Date.now();
        var onFrame = function (int16) {
          if (!liveSession || liveSession !== session || session.stopped) return;
          session.allFrames.push(int16);
          if (session.kind === 'aliyun') {
            if (session.ws && session.ws.readyState === 1) {
              try { session.ws.send(int16.buffer.slice(0)); } catch (e) {}
            }
          } else {
            session.segmentFrames.push(int16);
          }
        };
        var beginTransport = function () {
          setStatus({ kind: 'recording' });
          if (session.kind === 'aliyun') {
            var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            var connectWs = function () {
            var ws = new WebSocket(proto + '//' + window.location.host + '/stt-input/stream');
            session.ws = ws;
            ws.onopen = function () {
              ws.send(JSON.stringify({ type: 'start', provider: cfg.provider, model: cfg.model === 'custom' ? (cfg.customModel || 'fun-asr-realtime') : cfg.model, language: cfg.language === 'auto' ? '' : cfg.language, prompt: cfg.hotwords || '' }));
            };
            ws.onmessage = function (ev) {
              var active = liveSession === session;
              if (!active && !session.finalizing) return;
              var msg;
              try { msg = JSON.parse(ev.data); } catch (e) { return; }
              if (!active && session.finalizing) {
                // Already finalized visually; only the final aggregate matters,
                // and only while the user has not started a newer recording.
                if (msg.type === 'done') {
                  if (msg.text && liveSession === null) applyText(session.inputActions, session.base, msg.text);
                  closeLiveSocket(session);
                }
                return;
              }
              if (msg.type === 'started') {
                setStatus({ kind: 'recording' });
              } else if (msg.type === 'sentence') {
                if (msg.isFinal) {
                  session.committed = (session.committed + ' ' + msg.text).trim();
                  session.interim = '';
                } else {
                  session.interim = msg.text || '';
                }
                pushLiveDraft(session);
              } else if (msg.type === 'done') {
                if (msg.text) {
                  session.committed = msg.text;
                  session.interim = '';
                  pushLiveDraft(session);
                  endLive(session, null);
                } else {
                  endLive(session, { code: 'no_speech' });
                }
              } else if (msg.type === 'error') {
                handleLiveError(session, { code: msg.code, detail: msg.detail });
              }
            };
            ws.onclose = function () {
              if (session.finalizing) { closeLiveSocket(session); return; }
              if (liveSession !== session || session.stopped) return;
              // An unexpected drop mid-recording should not kill the session:
              // reconnect transparently (bounded) and keep streaming.
              if (!session.reconnects) session.reconnects = 0;
              if (session.reconnects < 2) {
                session.reconnects++;
                try { connectWs(); return; } catch (e) {}
              }
              handleLiveError(session, { code: 'stream_closed' });
            };
            ws.onerror = function () {
              if (session.finalizing) { closeLiveSocket(session); return; }
              if (liveSession !== session || session.stopped) return;
              if (!session.committed) handleLiveError(session, { code: 'stream_connect' });
            };
            };
            connectWs();
          } else {
            session.segmentTimer = setInterval(function () {
              if (liveSession !== session || session.stopped) return;
              flushZhipuSegment(session, false).catch(function (e) { return false; });
            }, ZHIPU_SEGMENT_MS);
          }
        };
        var attachFallbackProcessor = function () {
          var node = context.createScriptProcessor(4096, 1, 1);
          node.onaudioprocess = function (e) {
            onFrame(convertBlockToInt16(e.inputBuffer.getChannelData(0)));
          };
          var zero = context.createGain();
          zero.gain.value = 0;
          context.createMediaStreamSource(stream).connect(node);
          node.connect(zero);
          zero.connect(context.destination);
          session.node = node;
          beginTransport();
        };
        if (context.audioWorklet) {
          var blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
          var url = URL.createObjectURL(blob);
          context.audioWorklet.addModule(url).then(function () {
            URL.revokeObjectURL(url);
            var node = new AudioWorkletNode(context, 'pcm-publisher', { processorOptions: { targetRate: PCM_RATE } });
            node.port.onmessage = function (e) { onFrame(new Int16Array(e.data)); };
            var source = context.createMediaStreamSource(stream);
            var zero = context.createGain();
            zero.gain.value = 0;
            source.connect(node);
            node.connect(zero);
            zero.connect(context.destination);
            session.node = node;
            beginTransport();
          }).catch(function () {
            URL.revokeObjectURL(url);
            attachFallbackProcessor();
          });
        } else {
          attachFallbackProcessor();
        }
      }).catch(function (e) {
        if (requestToken !== micRequestToken) return;
        pendingMic = false;
        var name = (e && e.name) || (e && e.message) || String(e);
        setStatus({ kind: 'error', msg: T('err.micAccess', { err: name }) });
      });
    }

    function stopRecording(inputActions, base, cfg) {
      if (liveSession) {
        stopLiveSession();
        return;
      }
      browserWanted = false;
      browserToken++;
      var rec = activeRec;
      activeRec = null;
      if (!rec) return;
      try { rec.stop(); } catch (e) {
        if (cfg.engine === 'api') finalizeApi(inputActions, base, cfg);
        else setStatus({ kind: 'error', msg: T('err.stopFailed') });
      }
    }

    function disposeRecording() {
      disposeLiveSession();
      browserWanted = false;
      browserToken++;
      pendingMic = false;
      micRequestToken++;
      var rec = activeRec;
      activeRec = null;
      if (rec) {
        try {
          rec.onstop = null;
          rec.onend = null;
          rec.onerror = null;
          rec.onresult = null;
          rec.ondataavailable = null;
          rec.stop();
        } catch (e) {}
      }
      if (activeStream) {
        var tracks = activeStream.getTracks();
        for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
        activeStream = null;
      }
      recChunks = [];
    }

    // ---------- icons ----------
    var MicIcon = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('path', { d: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' }),
      React.createElement('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
      React.createElement('line', { x1: '12', y1: '19', x2: '12', y2: '22' }));
    var StopIcon = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor' },
      React.createElement('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }));
    var SpinIcon = React.createElement('svg', { className: 'stt-spin', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
      React.createElement('path', { d: 'M21 12a9 9 0 1 1-6.2-8.56' }));

    // ---------- mic button (composer tool row) ----------
    // Latest composer props, refreshed on every render, so the global
    // Ctrl+\ hotkey can drive exactly what the button would do.
    var micProps = null;
    // Latest input draft, refreshed on every MicButton render (the useInput
    // subscription re-renders it on each draft change) for the same hotkey.
    var micDraft = '';

    function micShortcutLabel() {
      return 'Ctrl+\\';
    }

    function toggleMic() {
      var props = micProps;
      if (!props) return;
      var st = store.status;
      var cfg = store.config;
      var inputActions = props.inputActions;
      if (!inputActions) return;
      var recording = st.kind === 'recording';
      var transcribing = st.kind === 'transcribing' || st.kind === 'requesting';
      if (transcribing) return;
      var draft = micDraft;
      var base = cfg.insertMode === 'replace' ? '' : draft;
      if (recording) stopRecording(inputActions, base, cfg);
      else startRecording(inputActions, base, cfg);
    }

    function isMicHotkey(e) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      if (e.shiftKey || e.altKey) return false;
      return e.key === '\\' || e.code === 'Backslash';
    }

    function handleMicHotkey(e, type) {
      if (!isMicHotkey(e)) return;
      var holdMode = store.config.triggerMode === 'hold';
      if (holdMode) {
        // Hold-to-talk: keydown arms recording (ignoring OS auto-repeat),
        // keyup releases it — mirroring the button's press-and-hold feel.
        if (type === 'keydown') {
          if (e.repeat) return;
          e.preventDefault();
          if (store.status.kind !== 'recording' && store.status.kind !== 'transcribing' && store.status.kind !== 'requesting') toggleMic();
        } else if (type === 'keyup') {
          if (store.status.kind === 'recording') {
            e.preventDefault();
            toggleMic();
          }
        }
        return;
      }
      if (type !== 'keydown' || e.repeat) return;
      e.preventDefault();
      toggleMic();
    }

    function MicButton(props) {
      micProps = props;
      useStore();
      // The draft reaches session-scope slot entries only through the
      // standard `useInput` selector hook — `conversation.input.left` passes
      // NO `input` prop (that shape is the dock slot's owner props), so
      // reading props.input.draft here always yielded '' and made append mode
      // silently replace the draft. Calling the hook also subscribes this
      // button to draft changes, keeping micDraft fresh for the Ctrl+\ path.
      // It runs before any early return so the hook call order stays stable.
      var inputState = null;
      if (typeof props.useInput === 'function') {
        inputState = props.useInput(function (s) { return s; });
      }
      var st = store.status;
      var cfg = store.config;
      var inputActions = props.inputActions;
      if (!inputActions) return null;
      var draft = (inputState && inputState.draft) || '';
      micDraft = draft;
      var recording = st.kind === 'recording';
      var transcribing = st.kind === 'transcribing' || st.kind === 'requesting';
      var holdMode = cfg.triggerMode === 'hold';
      var startNow = function () {
        if (transcribing) return;
        var base = cfg.insertMode === 'replace' ? '' : draft;
        startRecording(inputActions, base, cfg);
      };
      var stopNow = function () {
        var stopBase = cfg.insertMode === 'replace' ? '' : draft;
        stopRecording(inputActions, stopBase, cfg);
      };
      var onClick = holdMode ? undefined : function () {
        if (transcribing) return;
        if (recording) stopNow();
        else startNow();
      };
      // Hold-to-talk: pointer down starts, pointer up / cancel stops. Pointer
      // capture keeps the up event on the button even when the pointer is
      // dragged away mid-recording.
      var onPointerDown = holdMode ? function (e) {
        e.preventDefault();
        try { if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        startNow();
      } : undefined;
      var onPointerUp = holdMode ? function () {
        if (st.kind !== 'recording') return;
        stopNow();
      } : undefined;
      var idleText = holdMode ? T('mic.hold') : T('mic.idle');
      var title = (recording ? T('mic.recording') : transcribing ? T('mic.transcribing') : idleText) + ' · ' + micShortcutLabel();
      var cls = 'stt-mic-btn' + (recording ? ' stt-recording' : '') + (transcribing ? ' stt-transcribing' : '');
      var icon = recording ? StopIcon : transcribing ? SpinIcon : MicIcon;
      var handlers = { className: cls, title: title, 'aria-label': title };
      if (onClick) handlers.onClick = onClick;
      if (onPointerDown) handlers.onPointerDown = onPointerDown;
      if (onPointerUp) {
        handlers.onPointerUp = onPointerUp;
        handlers.onPointerCancel = onPointerUp;
      }
      if (holdMode) handlers.onContextMenu = function (e) { e.preventDefault(); };
      return React.createElement('button', handlers, icon);
    }

    // ---------- status pill (under the composer) ----------
    function StatusPill() {
      useStore();
      var st = store.status;
      var state = React.useState(0);
      var now = state[0];
      var setNow = state[1];
      React.useEffect(function () {
        if (st.kind !== 'recording') return undefined;
        setNow(Date.now());
        var id = setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { clearInterval(id); };
      }, [st.kind]);
      if (st.kind === 'idle') return null;
      var cls = 'stt-status';
      var content;
      if (st.kind === 'recording') {
        cls += ' stt-recording';
        var secs = recStartedAt ? Math.max(0, Math.round(((now || Date.now()) - recStartedAt) / 1000)) : 0;
        content = React.createElement('span', null,
          React.createElement('span', { className: 'stt-dot' }),
          React.createElement('span', null, T('pill.recording', { secs: secs })));
      } else if (st.kind === 'requesting') {
        content = React.createElement('span', null, T('pill.requesting'));
      } else if (st.kind === 'transcribing') {
        content = React.createElement('span', null, T('pill.transcribing'));
      } else if (st.kind === 'error') {
        cls += ' stt-error';
        content = React.createElement('span', null, '⚠ ' + (st.msg || ''));
      } else {
        cls += ' stt-ok';
        content = React.createElement('span', null, '✓ ' + (st.msg || T('pill.recognized')));
      }
      return React.createElement('div', { className: cls }, content);
    }

    // ---------- settings page ----------
    function Opts(list) {
      return list.map(function (o) { return React.createElement('option', { key: o.v, value: o.v }, o.t); });
    }

    function Field(props) {
      return React.createElement('label', { className: 'stt-field' },
        React.createElement('span', { className: 'stt-label' }, props.label),
        props.children);
    }

    function ApiKeyEditor() {
      useStore();
      var ks = store.keyStatus;
      var api = store.apiClient;
      var activeKeyRef = KEY_REF_BY_PROVIDER[store.config.provider] || KEY_REF_BY_PROVIDER.custom;
      var draftState = React.useState('');
      var draft = draftState[0];
      var setDraft = draftState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      React.useEffect(function () {
        refreshKeyStatus(activeKeyRef);
      }, [activeKeyRef]);
      var statusText;
      var statusCls = 'stt-key-status';
      if (ks.error) {
        statusText = ks.error;
        statusCls += ' stt-key-err';
      } else if (ks.configured) {
        statusText = ks.source.indexOf('shared:') === 0
          ? T('key.sharedSource', { source: ks.source.slice(7) || '-' })
          : T('key.configured', { source: ks.source || '-' });
        statusCls += ' stt-key-ok';
      } else {
        statusText = T('key.missing');
      }
      var hint = (!ks.error && ks.configured && !ks.writable) ? React.createElement('div', { className: 'stt-key-status stt-key-err' }, T('key.envShadow')) : null;
      var saveKey = function () {
        var value = (draft || '').trim();
        if (!value || !api || !api.credentials || typeof api.credentials.set !== 'function') return;
        setBusy(true);
        api.credentials.set({ ref: activeKeyRef, value: value }).then(function (r) {
          setBusy(false);
          if (r && r.result && !r.result.ok) {
            store.keyStatus = { loaded: true, configured: ks.configured, source: ks.source, writable: ks.writable, error: (r.result.error && r.result.error.message) || 'set failed' };
            notify();
            return;
          }
          setDraft('');
          return refreshKeyStatus(activeKeyRef);
        }).catch(function (e) {
          setBusy(false);
          store.keyStatus = { loaded: true, configured: ks.configured, source: ks.source, writable: ks.writable, error: (e && e.message) || String(e) };
          notify();
        });
      };
      var clearKey = function () {
        if (!api || !api.credentials || typeof api.credentials.unset !== 'function') return;
        setBusy(true);
        api.credentials.unset({ ref: activeKeyRef }).then(function (r) {
          setBusy(false);
          if (r && r.result && !r.result.ok) {
            store.keyStatus = { loaded: true, configured: ks.configured, source: ks.source, writable: ks.writable, error: (r.result.error && r.result.error.message) || 'unset failed' };
            notify();
            return;
          }
          return refreshKeyStatus(activeKeyRef);
        }).catch(function (e) {
          setBusy(false);
          store.keyStatus = { loaded: true, configured: ks.configured, source: ks.source, writable: ks.writable, error: (e && e.message) || String(e) };
          notify();
        });
      };
      return React.createElement(Field, { label: T('apiKey.label') },
        React.createElement('div', { className: 'stt-key-editor' },
          React.createElement('div', { className: statusCls }, statusText),
          hint,
          React.createElement('div', { className: 'stt-row' },
            React.createElement('input', { type: 'password', value: draft, placeholder: 'sk-…', disabled: busy || !ks.writable, onChange: function (e) { setDraft(e.target.value); } }),
            React.createElement('button', { className: 'stt-btn', disabled: busy || !ks.writable || !(draft || '').trim(), onClick: saveKey }, T('key.save')),
            ks.configured ? React.createElement('button', { className: 'stt-btn', disabled: busy || !ks.writable, onClick: clearKey }, T('key.clear')) : null)));
    }

    function SttSettings() {
      useStore();
      var cfg = store.config;
      var set = function (patch) { setConfig(patch); };
      var api = cfg.engine === 'api';
      var customModel = cfg.model === 'custom';
      var hotwordsSupported = cfg.provider !== 'aliyun'
        || (cfg.model !== 'qwen3-asr-flash-realtime' && cfg.model !== 'fun-asr-realtime-2026-02-28');
      var ALL_MODELS = [
        { v: 'whisper-1', t: T('model.whisper1') },
        { v: 'whisper-large-v3', t: T('model.whisperLargeV3') },
        { v: 'whisper-large-v3-turbo', t: T('model.whisperLargeV3Turbo') },
        { v: 'distil-whisper-large-v3-en', t: T('model.distilEn') },
        { v: 'glm-asr-2512', t: T('model.glmAsr2512') },
        { v: 'fun-asr-realtime', t: T('model.funAsrStable') },
        { v: 'fun-asr-realtime-2026-02-28', t: T('model.funAsrRealtime') },
        { v: 'qwen3-asr-flash-realtime', t: T('model.qwen3AsrFlash') },
        { v: 'custom', t: T('model.custom') }
      ];
      var MODELS_BY_PROVIDER = {
        openai: ['whisper-1'],
        groq: ['whisper-large-v3', 'whisper-large-v3-turbo', 'distil-whisper-large-v3-en'],
        zhipu: ['glm-asr-2512'],
        aliyun: ['fun-asr-realtime', 'fun-asr-realtime-2026-02-28', 'qwen3-asr-flash-realtime']
      };
      var DEFAULT_MODEL_BY_PROVIDER = {
        openai: 'whisper-1',
        groq: 'whisper-large-v3',
        zhipu: 'glm-asr-2512',
        aliyun: 'fun-asr-realtime'
      };
      var allowed = MODELS_BY_PROVIDER[cfg.provider];
      var modelOptions = allowed
        ? ALL_MODELS.filter(function (option) { return option.v === 'custom' || allowed.indexOf(option.v) >= 0; })
        : ALL_MODELS;
      // Self-heal a stale provider/model combination (for example an aliyun
      // selection persisted together with a whisper model from an older UI).
      React.useEffect(function () {
        // Self-heal a stale provider selection (for example the removed
        // Token Plan preset persisted in an older localStorage config).
        if (cfg.provider !== 'openai' && cfg.provider !== 'groq' && cfg.provider !== 'zhipu'
          && cfg.provider !== 'aliyun' && cfg.provider !== 'custom') {
          set({ provider: 'aliyun', model: 'fun-asr-realtime', language: 'auto' });
          return;
        }
        if (allowed && cfg.model !== 'custom' && allowed.indexOf(cfg.model) < 0) {
          set({ model: DEFAULT_MODEL_BY_PROVIDER[cfg.provider] });
        }
      }, [cfg.provider, cfg.model]);
      var onProvider = function (p) {
        set({ provider: p });
        if (p === 'openai') set({ baseUrl: 'https://api.openai.com', model: 'whisper-1' });
        else if (p === 'groq') set({ baseUrl: 'https://api.groq.com/openai', model: 'whisper-large-v3' });
        else if (p === 'zhipu') set({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-asr-2512', language: 'auto' });
        else if (p === 'aliyun') set({ baseUrl: '', model: 'fun-asr-realtime', language: 'auto' });
      };
      return React.createElement('div', { className: 'stt-settings' },
        React.createElement('div', { className: 'stt-head' },
          React.createElement('div', { className: 'stt-title' }, T('title')),
          React.createElement('div', { className: 'stt-desc' }, T('desc'))),
        React.createElement(Field, { label: T('engine.label') },
          React.createElement('select', { value: cfg.engine, onChange: function (e) { set({ engine: e.target.value }); } }, Opts([
            { v: 'browser', t: T('engine.browser') },
            { v: 'api', t: T('engine.api') }
          ]))),
        api ? React.createElement(React.Fragment, null,
          React.createElement(Field, { label: T('provider.label') },
            React.createElement('select', { value: cfg.provider, onChange: function (e) { onProvider(e.target.value); } }, Opts([
              { v: 'openai', t: T('provider.openai') },
              { v: 'groq', t: T('provider.groq') },
              { v: 'zhipu', t: T('provider.zhipu') },
              { v: 'aliyun', t: T('provider.aliyun') },
              { v: 'custom', t: T('provider.custom') }
            ]))),
          (cfg.provider === 'custom') ? React.createElement(Field, { label: T('baseUrl.label') },
            React.createElement('input', { type: 'text', value: cfg.baseUrl, placeholder: 'https://api.openai.com', onChange: function (e) { set({ baseUrl: e.target.value }); } })) : null,
          React.createElement(Field, { label: T('model.label') },
            React.createElement('select', { value: cfg.model, disabled: cfg.provider === 'zhipu', onChange: function (e) { set({ model: e.target.value }); } }, Opts(modelOptions))),
          customModel ? React.createElement(Field, { label: T('customModel.label') },
            React.createElement('input', { type: 'text', value: cfg.customModel, placeholder: T('customModel.placeholder'), onChange: function (e) { set({ customModel: e.target.value }); } })) : null,
          hotwordsSupported ? React.createElement(Field, { label: T('hotwords.label') },
            React.createElement('textarea', { value: cfg.hotwords, placeholder: T('hotwords.placeholder'), onChange: function (e) { set({ hotwords: e.target.value }); } }),
            React.createElement('span', { className: 'stt-label' }, T('hotwords.hint'))) : null,
          React.createElement(ApiKeyEditor)
        ) : null,
        cfg.provider !== 'zhipu' ? React.createElement(Field, { label: T('language.label') },
          React.createElement('select', { value: cfg.language, onChange: function (e) { set({ language: e.target.value }); } }, Opts(
            (cfg.provider === 'aliyun' && cfg.model === 'fun-asr-realtime-2026-02-28')
              ? [{ v: 'auto', t: T('language.auto') }, { v: 'zh', t: T('language.zh') }, { v: 'en', t: T('language.en') }, { v: 'ja', t: T('language.ja') }]
              : cfg.provider === 'aliyun'
                ? [
                    { v: 'auto', t: T('language.auto') }, { v: 'zh', t: T('language.zh') }, { v: 'yue', t: T('language.yue') }, { v: 'en', t: T('language.en') },
                    { v: 'ja', t: T('language.ja') }, { v: 'ko', t: T('language.ko') }, { v: 'fr', t: T('language.fr') }, { v: 'de', t: T('language.de') },
                    { v: 'es', t: T('language.es') }, { v: 'ru', t: T('language.ru') }, { v: 'pt', t: T('language.pt') }, { v: 'it', t: T('language.it') },
                    { v: 'vi', t: T('language.vi') }, { v: 'th', t: T('language.th') }, { v: 'id', t: T('language.id') }, { v: 'hi', t: T('language.hi') },
                    { v: 'ar', t: T('language.ar') }, { v: 'tr', t: T('language.tr') }, { v: 'uk', t: T('language.uk') }
                  ]
                : [
                    { v: 'auto', t: T('language.auto') }, { v: 'zh', t: T('language.zh') }, { v: 'en', t: T('language.en') },
                    { v: 'ja', t: T('language.ja') }, { v: 'ko', t: T('language.ko') }, { v: 'fr', t: T('language.fr') },
                    { v: 'de', t: T('language.de') }, { v: 'es', t: T('language.es') }, { v: 'ru', t: T('language.ru') },
                    { v: 'pt', t: T('language.pt') }, { v: 'it', t: T('language.it') }
                  ]
          ))) : null,
        React.createElement('div', { className: 'stt-field' },
          React.createElement('span', { className: 'stt-label' }, T('trigger.label')),
          React.createElement('div', { className: 'stt-row' },
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-trigger', checked: cfg.triggerMode !== 'hold', onChange: function () { set({ triggerMode: 'click' }); } }),
              React.createElement('span', null, T('trigger.click'))),
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-trigger', checked: cfg.triggerMode === 'hold', onChange: function () { set({ triggerMode: 'hold' }); } }),
              React.createElement('span', null, T('trigger.hold'))))),
        React.createElement('div', { className: 'stt-field' },
          React.createElement('span', { className: 'stt-label' }, T('insert.label')),
          React.createElement('div', { className: 'stt-row' },
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-insert', checked: cfg.insertMode === 'append', onChange: function () { set({ insertMode: 'append' }); } }),
              React.createElement('span', null, T('insert.append'))),
            React.createElement('label', { className: 'stt-radio' },
              React.createElement('input', { type: 'radio', name: 'stt-insert', checked: cfg.insertMode === 'replace', onChange: function () { set({ insertMode: 'replace' }); } }),
              React.createElement('span', null, T('insert.replace'))))),
        React.createElement('div', { className: 'stt-note' }, T('note'))
      );
    }

    // ---------- plugin ----------
    var inject = ['slots', 'locale', 'connection', 'configForms'];

    function apply(ctx) {
      var connection = (typeof ctx.get === 'function') ? ctx.get('connection') : null;
      store.apiClient = (connection && connection.api) ? connection.api : null;
      if (store.apiClient) refreshKeyStatus();
      initSettingsScope(ctx);
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () { return disposeRecording; });
      }
      // Register this plugin's dictionary namespace and follow the active DSH
      // locale. The translate function reads the active locale at call time, so
      // live switches are picked up on the next render; the subscription forces
      // every store-backed component to re-render after a switch. All side
      // effects belong to the fiber and are disposed on stop/update.
      var locale = ctx.get('locale');
      if (locale) {
        ctx.effect(function () {
          return locale.register(NS, { zh: zh, en: en });
        });
        ctx.effect(function () {
          store.t = locale.bind(NS);
          var off = locale.subscribe(function () { notify(); });
          return function () { store.t = null; off(); };
        });
      } else {
        store.t = null;
      }
      try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          ctx.effect(function () {
            var onKeyDown = function (e) { handleMicHotkey(e, 'keydown'); };
            var onKeyUp = function (e) { handleMicHotkey(e, 'keyup'); };
            document.addEventListener('keydown', onKeyDown);
            document.addEventListener('keyup', onKeyUp);
            return function () {
              document.removeEventListener('keydown', onKeyDown);
              document.removeEventListener('keyup', onKeyUp);
            };
          });
        }
      } catch (e) {}

      try {
        var style = document.createElement('style');
        style.setAttribute('data-plugin', 'dsh-asr-coding');
        style.textContent = CSS;
        document.head.appendChild(style);
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () { if (style.parentNode) style.parentNode.removeChild(style); };
          });
        }
      } catch (e) {}

      function register(name, id, order, component, extra) {
        ctx.slots.inject(name, function () {
          var opts = { name: name, id: id, order: order };
          if (extra) for (var k in extra) opts[k] = extra[k];
          return ctx.slots.register(opts, component);
        });
      }

      register('conversation.input.left', 'stt-input-mic', 30, MicButton);
      register('conversation.composer.dock', 'stt-input-status', 100, StatusPill);
      register('settings.section', 'stt-input', 52, SttSettings, {
        label: function () { return T('nav'); },
        inject: function () { return {}; }
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = 'dsh-asr-coding';
    return module.exports;
  }
});
