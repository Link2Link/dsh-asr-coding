import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

/**
 * dsh-asr-coding — host half.
 *
 * Transcribes a recorded audio clip through an OpenAI-compatible
 * /v1/audio/transcriptions endpoint (OpenAI Whisper, Groq, …), or through
 * Zhipu's /api/paas/v4/audio/transcriptions endpoint (GLM-ASR-2512).
 *
 * The client half (lib/client.js) POSTs JSON
 *   { audioBase64, mimeType, model, baseUrl, apiKey, language, provider }
 * to /stt-input/transcribe. This half decodes the base64 audio, builds a
 * multipart/form-data body (Node ≥ 18 global fetch / FormData / Blob) and
 * uploads it to the provider-specific transcription endpoint, returning
 *   { ok: true, text }  |  { ok: false, code, detail? }
 *
 * Failures are returned as stable machine-readable `code` strings (plus an
 * optional human-readable `detail`): the client maps codes to localized
 * wording against the active DSH locale, so no prose lives on the host.
 *
 * The API key is supplied per-request by the client (kept in page memory
 * only) and is never persisted or logged here.
 */

export const name = 'dsh-asr-coding';
export const inject = [];

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_BODY = Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 64 * 1024; // base64 audio plus bounded JSON metadata
const REQUEST_TIMEOUT_MS = 120000;
const FUN_ASR_TIMEOUT_MS = 120000;
const FUN_ASR_MODEL = 'fun-asr-realtime';
const FUN_ASR_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const STREAM_PATH = '/stt-input/stream';
const STREAM_MAX_FRAME_BYTES = 64 * 1024;
const STREAM_IDLE_TIMEOUT_MS = 120000;
const FUN_ASR_LANGUAGES = new Set(['zh', 'en', 'ja']);
const FUN_ASR_STABLE_LANGUAGES = new Set(['zh', 'en', 'ja', 'ko', 'vi', 'th', 'id', 'ms', 'tl', 'hi', 'ar', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'nl', 'sv', 'da', 'fi', 'no', 'el', 'pl', 'cs', 'hu', 'ro', 'bg', 'hr', 'sk']);
const QWEN_REALTIME_MODEL = 'qwen3-asr-flash-realtime';
const QWEN_REALTIME_LANGUAGES = new Set(['zh', 'yue', 'en', 'ja', 'de', 'ko', 'ru', 'fr', 'pt', 'ar', 'it', 'es', 'hi', 'id', 'th', 'tr', 'uk', 'vi', 'cs', 'da', 'fil', 'fi', 'is', 'ms', 'no', 'pl', 'sv']);
const QWEN_REALTIME_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
const API_KEY_REF = 'DSH_ASR_API_KEY';
// One credential slot per provider preset so switching presets never
// overwrites another preset's key; the legacy shared slot is the fallback.
const API_KEY_REFS = {
  openai: 'DSH_ASR_OPENAI_KEY',
  groq: 'DSH_ASR_GROQ_KEY',
  zhipu: 'DSH_ASR_ZHIPU_KEY',
  aliyun: 'DSH_ASR_ALIYUN_KEY',
  custom: 'DSH_ASR_CUSTOM_KEY'
};
let WebSocketClient = WebSocket;
const PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com', path: '/v1/audio/transcriptions' },
  groq: { baseUrl: 'https://api.groq.com/openai', path: '/v1/audio/transcriptions' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', path: '/audio/transcriptions' },
  aliyun: { baseUrl: '', path: '' }
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error) {
  return (error && error.message) ? error.message : String(error);
}

async function resolveApiKey(services, ref) {
  const credentials = services && services.credentials;
  if (!credentials || typeof credentials.resolve !== 'function') return '';
  try {
    const resolved = await credentials.resolve(ref);
    return (resolved && typeof resolved.value === 'string') ? resolved.value.trim() : '';
  } catch {
    return '';
  }
}

// Resolve the key for one provider: its dedicated slot first, then the legacy
// shared slot, so keys saved before per-provider slots existed keep working
// while each preset's saves and clears stay isolated from the others.
async function resolveApiKeyFor(services, provider) {
  const specific = await resolveApiKey(services, API_KEY_REFS[provider] || API_KEY_REFS.custom);
  if (specific) return specific;
  return resolveApiKey(services, API_KEY_REF);
}

function isSameOriginRequest(request) {
  const headers = request && request.headers;
  const getHeader = (name) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : (value || '');
  };
  const fetchSite = String(getHeader('sec-fetch-site')).toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const origin = getHeader('origin');
  const host = getHeader('host');
  if (!host) return false;
  if (!origin) return fetchSite === 'same-origin';
  try { return new URL(origin).host === String(host).toLowerCase(); }
  catch { return false; }
}

function decodeBase64(value) {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const bytes = Buffer.from(normalized, 'base64');
  const canonical = bytes.toString('base64');
  if (canonical !== normalized) return null;
  return bytes;
}

function isWav(bytes) {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE';
}

function wavDurationSeconds(bytes) {
  if (!isWav(bytes)) return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) return null;
    if (id === 'fmt ' && size >= 12) byteRate = bytes.readUInt32LE(start + 8);
    if (id === 'data') { dataSize = size; break; }
    offset = start + size + (size % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
}

function isMp3(bytes) {
  if (bytes.length < 3) return false;
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function isUnsafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}


function pcm16FromWav(bytes) {
  if (!isWav(bytes)) return null;
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) return null;
    if (id === 'fmt ' && size >= 16) {
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14)
      };
    } else if (id === 'data') {
      data = bytes.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) return null;
  return { data, sampleRate: format.sampleRate };
}

function funAsrDetail(message) {
  const header = message && message.header;
  return String((header && (header.error_message || header.error_code)) || (message && message.message) || 'Fun-ASR task failed');
}

async function transcribeFunAsr({ bytes, apiKey, language, model, prompt }) {
  const pcm = pcm16FromWav(bytes);
  if (!pcm) return { ok: false, code: 'invalid_audio', detail: 'Fun-ASR requires mono PCM16 WAV audio' };
  const taskId = randomUUID();
  const parameters = { format: 'pcm', sample_rate: pcm.sampleRate, heartbeat: true };
  if (language) parameters.language_hints = [language];
  const runTask = {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: model || FUN_ASR_MODEL,
      parameters,
      input: funAsrContext(prompt, model)
    }
  };
  const finishTask = {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} }
  };

  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let streamTimer = null;
    const finalSentences = new Map();
    const interimSentences = new Map();
    const socket = new WebSocketClient(FUN_ASR_ENDPOINT, {
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'User-Agent': 'dsh-asr-coding'
      }
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (streamTimer) clearTimeout(streamTimer);
      try { socket.close(); } catch {}
      const terminateTimer = setTimeout(() => { try { socket.terminate(); } catch {} }, 1000);
      if (typeof terminateTimer.unref === 'function') terminateTimer.unref();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ ok: false, code: 'timeout' }), FUN_ASR_TIMEOUT_MS);
    const sendFrame = (data, binary, callback) => {
      if (socket.readyState !== WebSocketClient.OPEN && socket.readyState !== 1) {
        finish({ ok: false, code: 'request_failed', detail: 'WebSocket is not open' });
        return;
      }
      socket.send(data, { binary }, (error) => {
        if (error) finish({ ok: false, code: 'request_failed', detail: messageOf(error) });
        else if (callback && !settled) callback();
      });
    };
    const streamAudio = () => {
      const chunkSize = Math.max(2, Math.floor(pcm.sampleRate * 2 * 0.1));
      let offset = 0;
      const sendNext = () => {
        if (settled) return;
        if (offset >= pcm.data.length) {
          sendFrame(JSON.stringify(finishTask), false);
          return;
        }
        const end = Math.min(pcm.data.length, offset + chunkSize);
        const chunk = pcm.data.subarray(offset, end);
        offset = end;
        sendFrame(chunk, true, () => { streamTimer = setTimeout(sendNext, 100); });
      };
      sendNext();
    };
    socket.on('open', () => sendFrame(JSON.stringify(runTask), false));
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(raw.toString('utf8')); }
      catch { return; }
      if (!message.header || message.header.task_id !== taskId) return;
      const event = message.header.event;
      if (event === 'task-started') {
        if (started) return;
        started = true;
        streamAudio();
      } else if (event === 'result-generated') {
        const sentence = message.payload && message.payload.output && message.payload.output.sentence;
        if (!sentence || sentence.heartbeat || typeof sentence.text !== 'string') return;
        const id = Number.isInteger(sentence.sentence_id) ? sentence.sentence_id : interimSentences.size + finalSentences.size + 1;
        if (sentence.sentence_end) {
          finalSentences.set(id, sentence.text);
          interimSentences.delete(id);
        } else {
          interimSentences.set(id, sentence.text);
        }
      } else if (event === 'task-finished') {
        const ids = new Set([...finalSentences.keys(), ...interimSentences.keys()]);
        const text = [...ids].sort((a, b) => a - b).map((id) => finalSentences.get(id) ?? interimSentences.get(id) ?? '').join('').trim();
        finish(text ? { ok: true, text } : { ok: false, code: 'no_speech' });
      } else if (event === 'task-failed') {
        finish({ ok: false, code: 'api_error', detail: funAsrDetail(message) });
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      if (response && typeof response.resume === 'function') response.resume();
      finish({ ok: false, code: 'api_error', detail: 'WebSocket handshake failed: HTTP ' + response.statusCode });
    });
    socket.on('error', (error) => finish({ ok: false, code: 'request_failed', detail: messageOf(error) }));
    socket.on('close', (code, reason) => {
      if (!settled) finish({ ok: false, code: 'request_failed', detail: 'WebSocket closed before task completion (' + code + '): ' + reason.toString() });
    });
  });
}

function funAsrContext(prompt, model) {
  // The docs scope input.context to fun-asr-realtime (and qwen-audio streaming
  // models we do not expose); other fun versions reject it, so send it only
  // where it is supported.
  if (!prompt || (model && model !== 'fun-asr-realtime')) return {};
  return {
    context: [
      { role: 'user', content: [{ type: 'input_text', text: String(prompt).slice(0, 400) }] }
    ]
  };
}

function zhipuHotwords(prompt) {
  if (!prompt) return null;
  const words = String(prompt).split(/[,，\n]/).map((word) => word.trim()).filter(Boolean);
  return words.length ? words.slice(0, 100) : null;
}

function qwenLanguageOf(language, model) {
  if (!language) return '';
  const set = model === QWEN_REALTIME_MODEL ? QWEN_REALTIME_LANGUAGES : FUN_ASR_STABLE_LANGUAGES;
  return set.has(language) ? language : '';
}

function funLanguageOf(language, model) {
  if (!language) return '';
  const set = model === 'fun-asr-realtime-2026-02-28' ? FUN_ASR_LANGUAGES : FUN_ASR_STABLE_LANGUAGES;
  return set.has(language) ? language : '';
}

// Qwen-ASR-Realtime batch path: the same OmniRealtime WebSocket protocol used
// by the live relay (session.update → base64 PCM appends → session.finish),
// driven over a complete PCM16 clip.
function transcribeQwenRealtime({ pcm, apiKey, language, model }) {
  const completedOrder = [];
  const finals = new Map();
  return new Promise((resolve) => {
    let settled = false;
    let streamTimer = null;
    const socket = new WebSocketClient(QWEN_REALTIME_ENDPOINT + '?model=' + encodeURIComponent(model), {
      headers: { Authorization: 'Bearer ' + apiKey, 'User-Agent': 'dsh-asr-coding' }
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (streamTimer) clearTimeout(streamTimer);
      try { socket.close(); } catch {}
      const terminateTimer = setTimeout(() => { try { socket.terminate(); } catch {} }, 1000);
      if (typeof terminateTimer.unref === 'function') terminateTimer.unref();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ ok: false, code: 'timeout' }), FUN_ASR_TIMEOUT_MS);
    const sendEvent = (payload, callback) => {
      if (socket.readyState !== WebSocketClient.OPEN && socket.readyState !== 1) {
        finish({ ok: false, code: 'request_failed', detail: 'WebSocket is not open' });
        return;
      }
      socket.send(JSON.stringify(payload), undefined, (error) => {
        if (error) finish({ ok: false, code: 'request_failed', detail: messageOf(error) });
        else if (callback && !settled) callback();
      });
    };
    const sessionUpdate = {
      event_id: randomUUID(),
      type: 'session.update',
      session: {
        input_audio_format: 'pcm',
        sample_rate: pcm.sampleRate,
        ...(language ? { input_audio_transcription: { language } } : {}),
        turn_detection: { type: 'server_vad', threshold: 0.0, silence_duration_ms: 400 }
      }
    };
    const streamAudio = () => {
      const chunkSize = Math.max(2, Math.floor(pcm.sampleRate * 2 * 0.1));
      let offset = 0;
      const sendNext = () => {
        if (settled) return;
        if (offset >= pcm.data.length) {
          sendEvent({ event_id: randomUUID(), type: 'session.finish' });
          return;
        }
        const end = Math.min(pcm.data.length, offset + chunkSize);
        const chunk = pcm.data.subarray(offset, end);
        offset = end;
        sendEvent({ event_id: randomUUID(), type: 'input_audio_buffer.append', audio: chunk.toString('base64') }, () => {
          streamTimer = setTimeout(sendNext, 100);
        });
      };
      sendNext();
    };
    socket.on('open', () => sendEvent(sessionUpdate, streamAudio));
    socket.on('message', (raw, isBinary) => {
      if (isBinary || settled) return;
      let message;
      try { message = JSON.parse(raw.toString('utf8')); }
      catch { return; }
      const type = message.type;
      if (type === 'session.created' || type === 'session.updated') {
        return;
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        if (typeof message.transcript === 'string' && message.item_id && !finals.has(message.item_id)) {
          finals.set(message.item_id, message.transcript);
          completedOrder.push(message.item_id);
        }
      } else if (type === 'conversation.item.input_audio_transcription.failed') {
        const detail = (message.error && (message.error.message || message.error.code)) || 'transcription failed';
        finish({ ok: false, code: 'api_error', detail: String(detail) });
      } else if (type === 'session.finished') {
        const text = completedOrder.map((id) => finals.get(id) || '').join('').trim();
        finish(text ? { ok: true, text } : { ok: false, code: 'no_speech' });
      } else if (type === 'error') {
        const detail = (message.error && (message.error.message || message.error.code)) || 'unknown error';
        finish({ ok: false, code: 'api_error', detail: String(detail) });
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      if (response && typeof response.resume === 'function') response.resume();
      finish({ ok: false, code: 'api_error', detail: 'WebSocket handshake failed: HTTP ' + response.statusCode });
    });
    socket.on('error', (error) => finish({ ok: false, code: 'request_failed', detail: messageOf(error) }));
    socket.on('close', (code, reason) => {
      if (!settled) finish({ ok: false, code: 'request_failed', detail: 'WebSocket closed before session completion (' + code + '): ' + reason.toString() });
    });
  });
}

async function transcribe(args, apiKey) {
  const a = (args && typeof args === 'object') ? args : {};
  if (!a.audioBase64 || typeof a.audioBase64 !== 'string' || !a.audioBase64) {
    return { ok: false, code: 'missing_audio' };
  }
  if (!apiKey) {
    return { ok: false, code: 'missing_key' };
  }
  const provider = String(a.provider || 'custom');
  const preset = PROVIDER_PRESETS[provider];
  let baseUrl;
  let transcriptionPath;
  if (preset) {
    baseUrl = preset.baseUrl;
    transcriptionPath = preset.path;
  } else {
    baseUrl = String(a.baseUrl || '').replace(/\/+$/, '');
    transcriptionPath = '/v1/audio/transcriptions';
    let parsed;
    try { parsed = new URL(baseUrl); } catch { return { ok: false, code: 'invalid_endpoint' }; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || isUnsafeHostname(parsed.hostname)) {
      return { ok: false, code: 'invalid_endpoint' };
    }
  }
  const url = provider === 'aliyun' ? '' : (baseUrl.endsWith(transcriptionPath) ? baseUrl : baseUrl + transcriptionPath);
  const model = provider === 'zhipu' ? 'glm-asr-2512' : provider === 'aliyun' ? FUN_ASR_MODEL : String(a.model || 'whisper-1');
  const mime = String(a.mimeType || 'audio/webm').split(';', 1)[0].toLowerCase();
  const language = (typeof a.language === 'string' && a.language) ? a.language : '';
  const prompt = (typeof a.prompt === 'string') ? a.prompt.trim() : '';
  const extByMime = { 'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'mp4', 'audio/x-m4a': 'mp4', 'audio/webm': 'webm' };
  const ext = extByMime[mime];
  if (!ext) return { ok: false, code: 'unsupported_audio', detail: mime };
  if (provider === 'zhipu' && ext !== 'wav' && ext !== 'mp3') {
    return { ok: false, code: 'unsupported_audio', detail: 'GLM-ASR-2512 accepts WAV or MP3 audio only' };
  }

  const bytes = decodeBase64(a.audioBase64);
  if (!bytes) return { ok: false, code: 'decode_failed' };
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, code: 'audio_too_large' };
  if (provider === 'zhipu') {
    if (ext === 'wav' && !isWav(bytes)) return { ok: false, code: 'invalid_audio', detail: 'invalid WAV file' };
    if (ext === 'mp3' && !isMp3(bytes)) return { ok: false, code: 'invalid_audio', detail: 'invalid MP3 file' };
    const duration = ext === 'wav' ? wavDurationSeconds(bytes) : null;
    if (duration !== null && duration > 30) return { ok: false, code: 'audio_too_long' };
  }
  if (provider === 'aliyun') {
    if (ext !== 'wav' || !isWav(bytes)) return { ok: false, code: 'invalid_audio', detail: 'DashScope realtime ASR requires WAV audio' };
    const model = String(a.model || FUN_ASR_MODEL);
    if (model === QWEN_REALTIME_MODEL) {
      const pcm = pcm16FromWav(bytes);
      if (!pcm) return { ok: false, code: 'invalid_audio', detail: 'Qwen-ASR-Realtime requires mono PCM16 WAV audio' };
      return transcribeQwenRealtime({ pcm, apiKey, language: qwenLanguageOf(language, model), model });
    }
    const supportedLanguage = funLanguageOf(language, model);
    return transcribeFunAsr({ bytes, apiKey, language: supportedLanguage, model, prompt });
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'audio.' + ext);
  form.append('model', model);
  if (provider === 'zhipu') {
    form.append('stream', 'false');
    const hotwords = zhipuHotwords(prompt);
    if (hotwords) form.append('hotwords', JSON.stringify(hotwords));
  } else {
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
      signal: (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { ok: false, code: 'timeout' };
    }
    return { ok: false, code: 'request_failed', detail: messageOf(e) };
  }

  let json = null;
  try { json = await response.json(); } catch (e) { json = null; }

  if (!response.ok || !json || typeof json.text !== 'string') {
    const nestedError = json && json.error;
    const err = nestedError
      ? (nestedError.message || (typeof nestedError === 'string' ? nestedError : JSON.stringify(nestedError)))
      : (json && (json.message || json.msg))
        ? String(json.message || json.msg)
        : ('HTTP ' + response.status);
    return { ok: false, code: 'api_error', detail: err };
  }
  return { ok: true, text: json.text.trim() };
}

/**
 * Live streaming relay: the browser opens a WebSocket on STREAM_PATH, sends a
 * JSON {type:'start', apiKey, language} control frame, then streams binary
 * mono PCM16 frames captured in real time. The host relays them to the pinned
 * Fun-ASR endpoint and pushes sentences back as JSON events so the draft
 * updates while the user is still speaking:
 *   {type:'started'} | {type:'sentence', text, isFinal} | {type:'done', text}
 *   | {type:'error', code, detail?}
 */
function runStreamSession(client, services) {
  let started = false;
  let finished = false;
  let upstream = null;
  let upstreamReady = false;
  let finishing = false;
  let apiKey = '';
  let language = '';
  let model = '';
  let provider = 'aliyun';
  let promptText = '';
  let useRealtime = false;
  let taskId = '';
  let synthId = 0;
  const pendingFrames = [];
  const finalSentences = new Map();
  const interimSentences = new Map();
  const finalsByItem = new Map();
  const completedOrder = [];
  let idleTimer = null;

  const send = (payload) => {
    if (client.readyState === 1) client.send(JSON.stringify(payload));
  };
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send({ type: 'error', code: 'timeout' });
      cleanup();
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  const aggregateText = () => {
    const ids = new Set([...finalSentences.keys(), ...interimSentences.keys()]);
    return [...ids].sort((a, b) => a - b)
      .map((id) => finalSentences.get(id) ?? interimSentences.get(id) ?? '')
      .join('').trim();
  };
  const cleanup = () => {
    finished = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (upstream) {
      try { upstream.close(); } catch {}
      const upstreamTerminator = setTimeout(() => { try { upstream && upstream.terminate(); } catch {} }, 1000);
      if (typeof upstreamTerminator.unref === 'function') upstreamTerminator.unref();
      upstream = null;
    }
    // Close the browser socket gracefully so the final 'done'/'error' event
    // already written to it can still be delivered; a hard terminate here
    // stranded the client in its finishing state.
    try { client.close(); } catch {}
    const clientTerminator = setTimeout(() => { try { client.terminate(); } catch {} }, 1000);
    if (typeof clientTerminator.unref === 'function') clientTerminator.unref();
  };

  const sendQwenAppend = (frame) => {
    if (!upstream || (upstream.readyState !== WebSocketClient.OPEN && upstream.readyState !== 1)) return;
    upstream.send(JSON.stringify({ event_id: randomUUID(), type: 'input_audio_buffer.append', audio: frame.toString('base64') }));
  };

  const connectQwenUpstream = (endpoint) => {
    upstream = new WebSocketClient(endpoint + '?model=' + encodeURIComponent(model), {
      headers: { Authorization: 'Bearer ' + apiKey, 'User-Agent': 'dsh-asr-coding' }
    });
    const sessionUpdate = {
      event_id: randomUUID(),
      type: 'session.update',
      session: {
        input_audio_format: 'pcm',
        sample_rate: 16000,
        ...(language ? { input_audio_transcription: { language } } : {}),
        turn_detection: { type: 'server_vad', threshold: 0.0, silence_duration_ms: 400 }
      }
    };
    upstream.on('open', () => {
      upstream.send(JSON.stringify(sessionUpdate));
      upstreamReady = true;
      send({ type: 'started' });
      for (const frame of pendingFrames.splice(0)) sendQwenAppend(frame);
    });
    upstream.on('message', (raw, isBinary) => {
      if (isBinary || finished) return;
      resetIdle();
      let message;
      try { message = JSON.parse(raw.toString('utf8')); }
      catch { return; }
      const type = message.type;
      if (type === 'conversation.item.input_audio_transcription.text') {
        const preview = String(message.text || '') + String(message.stash || '');
        send({ type: 'sentence', text: preview, isFinal: false });
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        if (typeof message.transcript === 'string' && message.item_id && !finalsByItem.has(message.item_id)) {
          finalsByItem.set(message.item_id, message.transcript);
          completedOrder.push(message.item_id);
        }
        send({ type: 'sentence', text: String(message.transcript || ''), isFinal: true });
      } else if (type === 'conversation.item.input_audio_transcription.failed') {
        const detail = (message.error && (message.error.message || message.error.code)) || 'transcription failed';
        send({ type: 'error', code: 'api_error', detail: String(detail) });
        cleanup();
      } else if (type === 'session.finished') {
        const text = completedOrder.map((id) => finalsByItem.get(id) || '').join('').trim();
        send({ type: 'done', text });
        cleanup();
      } else if (type === 'error') {
        const detail = (message.error && (message.error.message || message.error.code)) || 'unknown error';
        send({ type: 'error', code: 'api_error', detail: String(detail) });
        cleanup();
      }
    });
    upstream.on('unexpected-response', (_request, response) => {
      if (response && typeof response.resume === 'function') response.resume();
      send({ type: 'error', code: 'api_error', detail: 'WebSocket handshake failed: HTTP ' + response.statusCode });
      cleanup();
    });
    upstream.on('error', (error) => {
      if (finished) return;
      send({ type: 'error', code: 'request_failed', detail: messageOf(error) });
      cleanup();
    });
    upstream.on('close', () => {
      if (!finished) {
        send({ type: 'error', code: 'request_failed', detail: 'upstream connection closed early' });
        cleanup();
      }
    });
  };

  const connectUpstream = () => {
    upstream = new WebSocketClient(FUN_ASR_ENDPOINT, {
      headers: { Authorization: 'Bearer ' + apiKey, 'User-Agent': 'dsh-asr-coding' }
    });
    taskId = randomUUID();
    const runTask = {
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model,
        parameters: { format: 'pcm', sample_rate: 16000, heartbeat: true, ...(language ? { language_hints: [language] } : {}) },
        input: funAsrContext(promptText, model),
      }
    };
    const sendUpstream = (data, binary, callback) => {
      if (!upstream || (upstream.readyState !== WebSocketClient.OPEN && upstream.readyState !== 1)) return;
      upstream.send(data, { binary }, callback);
    };
    upstream.on('open', () => sendUpstream(JSON.stringify(runTask), false));
    upstream.on('message', (raw, isBinary) => {
      if (isBinary || finished) return;
      resetIdle();
      let message;
      try { message = JSON.parse(raw.toString('utf8')); }
      catch { return; }
      if (!message.header || message.header.task_id !== taskId) return;
      const event = message.header.event;
      if (event === 'task-started') {
        upstreamReady = true;
        send({ type: 'started' });
        for (const frame of pendingFrames.splice(0)) sendUpstream(frame, true);
      } else if (event === 'result-generated') {
        const sentence = message.payload && message.payload.output && message.payload.output.sentence;
        if (!sentence || sentence.heartbeat || typeof sentence.text !== 'string') return;
        let id;
        if (Number.isInteger(sentence.sentence_id)) id = sentence.sentence_id;
        else if (sentence.sentence_end) id = synthId++;
        else id = synthId;
        if (sentence.sentence_end) {
          finalSentences.set(id, sentence.text);
          interimSentences.delete(id);
        } else {
          interimSentences.set(id, sentence.text);
        }
        send({ type: 'sentence', text: sentence.text, isFinal: Boolean(sentence.sentence_end) });
      } else if (event === 'task-finished') {
        send({ type: 'done', text: aggregateText() });
        cleanup();
      } else if (event === 'task-failed') {
        send({ type: 'error', code: 'api_error', detail: funAsrDetail(message) });
        cleanup();
      }
    });
    upstream.on('unexpected-response', (_request, response) => {
      if (response && typeof response.resume === 'function') response.resume();
      send({ type: 'error', code: 'api_error', detail: 'WebSocket handshake failed: HTTP ' + response.statusCode });
      cleanup();
    });
    upstream.on('error', (error) => {
      if (finished) return;
      send({ type: 'error', code: 'request_failed', detail: messageOf(error) });
      cleanup();
    });
    upstream.on('close', () => {
      if (!finished) {
        send({ type: 'error', code: 'request_failed', detail: 'upstream connection closed early' });
        cleanup();
      }
    });
  };

  client.on('message', (data, isBinary) => {
    if (finished) return;
    resetIdle();
    if (isBinary) {
      if (!Buffer.isBuffer(data)) data = Buffer.from(data);
      if (data.length === 0 || data.length > STREAM_MAX_FRAME_BYTES) {
        send({ type: 'error', code: 'invalid_audio', detail: 'bad PCM frame size' });
        cleanup();
        return;
      }
      if (upstreamReady && upstream) {
        if (useRealtime) sendQwenAppend(data);
        else upstream.send(data, { binary: true });
      } else pendingFrames.push(data);
      return;
    }
    let message;
    try { message = JSON.parse(data.toString('utf8')); }
    catch { return; }
    if (message.type === 'start' && !started) {
      started = true;
      const requested = typeof message.language === 'string' ? message.language : '';
      promptText = (typeof message.prompt === 'string') ? message.prompt.trim() : '';
      model = (typeof message.model === 'string' && message.model) ? message.model : FUN_ASR_MODEL;
      provider = (typeof message.provider === 'string' && message.provider) ? message.provider : 'aliyun';
      useRealtime = model === QWEN_REALTIME_MODEL;
      language = (useRealtime ? qwenLanguageOf(requested, model) : funLanguageOf(requested, model));
      resolveApiKeyFor(services, provider).then((key) => {
        if (finished) return;
        apiKey = key;
        if (!apiKey) {
          send({ type: 'error', code: 'missing_key' });
          cleanup();
          return;
        }
        if (useRealtime) {
          connectQwenUpstream(QWEN_REALTIME_ENDPOINT);
        } else {
          connectUpstream();
        }
      });
    } else if (message.type === 'finish' && !finishing) {
      finishing = true;
      if (upstreamReady && upstream) {
        if (useRealtime) {
          upstream.send(JSON.stringify({ event_id: randomUUID(), type: 'session.finish' }));
        } else {
          upstream.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }));
        }
      }
    }
  });
  client.on('close', () => cleanup());
  client.on('error', () => cleanup());
  resetIdle();
}

export function __setWebSocketClientForTests(client) {
  WebSocketClient = client || WebSocket;
}

export function apply(ctx) {
  // Static install: webServer route (the same convention as dsh-omni-bridge /
  // dsh-session-mover). The client calls POST /stt-input/transcribe.
  ctx.inject(['webServer', 'credentials'], (hostCtx) => {
    const server = hostCtx.webServer;
    if (!server || typeof server.register !== 'function') return;
    const route = {
      kind: 'exact',
      path: '/stt-input/transcribe',
      handler: async (request, response) => {
        try {
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, code: 'method_not_allowed', detail: 'method not allowed' });
            return;
          }
          if (!isSameOriginRequest(request)) {
            sendJson(response, 403, { ok: false, code: 'forbidden', detail: 'cross-origin request rejected' });
            return;
          }
          const body = await readJsonBody(request);
          const apiKey = await resolveApiKeyFor(hostCtx, String(body.provider || 'custom'));
          const result = await transcribe(body, apiKey);
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 500, { ok: false, code: 'server_error', detail: messageOf(error) });
        }
      }
    };
    if (typeof hostCtx.effect === 'function') {
      hostCtx.effect(() => server.register(route), 'dsh-asr-coding: transcription route');
    } else {
      server.register(route);
    }

    if (typeof server.registerUpgrade === 'function') {
      const wss = new WebSocketServer({ noServer: true });
      const CRLF = String.fromCharCode(13, 10);
      const upgradeRoute = {
        path: STREAM_PATH,
        handler: (request, socket, head) => {
          if (!isSameOriginRequest(request)) {
            socket.write('HTTP/1.1 403 Forbidden' + CRLF + CRLF);
            socket.destroy();
            return;
          }
          wss.handleUpgrade(request, socket, head, (client) => runStreamSession(client, hostCtx));
        }
      };
      if (typeof hostCtx.effect === 'function') {
        hostCtx.effect(() => {
          const dispose = server.registerUpgrade(upgradeRoute);
          return () => {
            if (typeof dispose === 'function') dispose();
            wss.close();
          };
        }, 'dsh-asr-coding: streaming route');
      } else {
        server.registerUpgrade(upgradeRoute);
      }
    }
  });
}
