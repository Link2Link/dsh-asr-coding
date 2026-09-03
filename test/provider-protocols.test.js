import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';

import { apply, __setWebSocketClientForTests } from '../lib/index.js';

function makeWav(seconds = 0.1) {
  const sampleRate = 16000;
  const dataSize = Math.round(sampleRate * 2 * seconds);
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

function mountRoute(credentialValue = 'test-key') {
  const refs = typeof credentialValue === 'string'
    ? { DSH_ASR_API_KEY: credentialValue }
    : credentialValue;
  let route;
  apply({
    inject(_deps, callback) {
      callback({
        effect(install) { install(); },
        credentials: {
          resolve: async (ref) => (refs[ref]
            ? { value: refs[ref], source: 'file' }
            : undefined)
        },
        webServer: { register(value) { route = value; return () => {}; } }
      });
    }
  });
  return route;
}

async function invoke(route, body, headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = 'POST';
  request.headers = headers;
  let status;
  let raw = '';
  await route.handler(request, {
    writeHead(value) { status = value; },
    end(value = '') { raw += value; }
  });
  return { status, body: JSON.parse(raw) };
}

test('Fun-ASR uses the pinned WebSocket protocol and aggregates sentences', async () => {
  let socket;
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = 1;
      this.sent = [];
      socket = this;
      queueMicrotask(() => this.emit('open'));
    }
    send(data, options, callback) {
      this.sent.push({ data, options, at: Date.now() });
      queueMicrotask(() => {
        if (callback) callback();
        if (typeof data !== 'string') return;
        const message = JSON.parse(data);
        if (message.header.action === 'run-task') {
          this.taskId = message.header.task_id;
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-started' }, payload: {} })), false);
        } else if (message.header.action === 'finish-task') {
          for (const sentence of [
            { sentence_id: 1, sentence_end: false, text: '你好' },
            { sentence_id: 1, sentence_end: true, text: '你好，' },
            { sentence_id: 2, sentence_end: true, text: '世界' }
          ]) this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'result-generated' }, payload: { output: { sentence } } })), false);
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-finished' }, payload: {} })), false);
        }
      });
    }
    close() { this.readyState = 3; }
    terminate() {}
  }
  __setWebSocketClientForTests(FakeWebSocket);
  const result = await invoke(mountRoute('secret'), {
    provider: 'aliyun', baseUrl: 'https://attacker.invalid',
    language: 'zh', mimeType: 'audio/wav', audioBase64: makeWav().toString('base64')
  });
  assert.deepEqual(result, { status: 200, body: { ok: true, text: '你好，世界' } });
  assert.equal(socket.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
  assert.equal(socket.options.headers.Authorization, 'Bearer secret');
  const runTask = JSON.parse(socket.sent[0].data);
  assert.equal(runTask.payload.model, 'fun-asr-realtime');
  assert.deepEqual(runTask.payload.parameters, { format: 'pcm', sample_rate: 16000, heartbeat: true, language_hints: ['zh'] });
  assert.ok(socket.sent.some(({ data, options }) => Buffer.isBuffer(data) && options.binary));
  assert.equal(JSON.parse(socket.sent.at(-1).data).header.action, 'finish-task');
});

test('Fun-ASR reports an explicit no-speech result', async () => {
  class EmptyWebSocket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; queueMicrotask(() => this.emit('open')); }
    send(data, _options, callback) {
      queueMicrotask(() => {
        if (callback) callback();
        if (typeof data !== 'string') return;
        const message = JSON.parse(data);
        if (message.header.action === 'run-task') {
          this.taskId = message.header.task_id;
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-started' } })), false);
        } else if (message.header.action === 'finish-task') {
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-finished' } })), false);
        }
      });
    }
    close() { this.readyState = 3; }
    terminate() {}
  }
  __setWebSocketClientForTests(EmptyWebSocket);
  const result = await invoke(mountRoute(), { provider: 'aliyun', mimeType: 'audio/wav', audioBase64: makeWav().toString('base64') });
  assert.equal(result.body.code, 'no_speech');
});

test('known HTTP providers keep their pinned endpoint contracts', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const fields = {};
    for (const [key, value] of options.body.entries()) fields[key] = typeof value === 'string' ? value : value.name;
    calls.push({ url: String(url), fields });
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const route = mountRoute('key');
    const wav = makeWav().toString('base64');
    const zhipu = await invoke(route, { provider: 'zhipu', baseUrl: 'https://evil.invalid', model: 'wrong', mimeType: 'audio/wav', audioBase64: wav });
    assert.equal(zhipu.body.ok, true);
    assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions');
    assert.equal(calls[0].fields.model, 'glm-asr-2512');
    assert.equal(calls[0].fields.stream, 'false');
    const openai = await invoke(route, { provider: 'openai', baseUrl: 'https://evil.invalid', model: 'whisper-1', language: 'zh', mimeType: 'audio/webm', audioBase64: Buffer.from('audio').toString('base64') });
    assert.equal(openai.body.ok, true);
    assert.equal(calls[1].url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(calls[1].fields.language, 'zh');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('qwen realtime batch uses the realtime endpoint and protocol', async () => {
  let socket;
  class FakeQwenSocket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = 1;
      this.sent = [];
      socket = this;
      queueMicrotask(() => this.emit('open'));
    }
    send(data, _options, callback) {
      this.sent.push({ data });
      queueMicrotask(() => {
        if (callback) callback();
        const message = JSON.parse(data);
        if (message.type === 'session.finish') {
          this.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: '你好，世界' })), false);
          this.emit('message', Buffer.from(JSON.stringify({ type: 'session.finished' })), false);
        }
      });
    }
    close() { this.readyState = 3; }
    terminate() {}
  }
  __setWebSocketClientForTests(FakeQwenSocket);
  const result = await invoke(mountRoute('secret'), {
    provider: 'aliyun', model: 'qwen3-asr-flash-realtime', language: 'zh',
    mimeType: 'audio/wav', audioBase64: makeWav().toString('base64')
  });
  assert.deepEqual(result.body, { ok: true, text: '你好，世界' });
  assert.equal(socket.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime');
  assert.equal(socket.options.headers.Authorization, 'Bearer secret');
  const sent = socket.sent.map((entry) => JSON.parse(entry.data));
  assert.equal(sent[0].type, 'session.update');
  assert.equal(sent[0].session.input_audio_transcription.language, 'zh');
  const appends = sent.filter((event) => event.type === 'input_audio_buffer.append');
  assert.ok(appends.length >= 1);
  assert.equal(sent.at(-1).type, 'session.finish');
});

test('hotwords map to each provider contract', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const fields = {};
    for (const [key, value] of options.body.entries()) fields[key] = typeof value === 'string' ? value : value.name;
    calls.push({ url: String(url), fields });
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const route = mountRoute('key');
    const wav = makeWav().toString('base64');
    await invoke(route, { provider: 'zhipu', mimeType: 'audio/wav', audioBase64: wav, prompt: 'Kubernetes, 智谱 GLM，\n语音识别' });
    assert.deepEqual(JSON.parse(calls[0].fields.hotwords), ['Kubernetes', '智谱 GLM', '语音识别']);
    assert.equal(calls[0].fields.prompt, undefined);
    await invoke(route, { provider: 'openai', mimeType: 'audio/webm', audioBase64: Buffer.from('audio').toString('base64'), prompt: 'Terms: Kubernetes, GLM' });
    assert.equal(calls[1].fields.prompt, 'Terms: Kubernetes, GLM');
    assert.equal(calls[1].fields.hotwords, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fun-asr-realtime carries hotwords as input context', async () => {
  let socket;
  class FakeContextSocket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; this.sent = []; socket = this; queueMicrotask(() => this.emit('open')); }
    send(data, _options, callback) {
      this.sent.push({ data });
      queueMicrotask(() => {
        if (callback) callback();
        if (typeof data !== 'string') return;
        const message = JSON.parse(data);
        if (message.header && message.header.action === 'run-task') {
          this.taskId = message.header.task_id;
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-started' } })), false);
        } else if (message.header && message.header.action === 'finish-task') {
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, sentence_end: true, text: '好的' } } } })), false);
          this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-finished' } })), false);
        }
      });
    }
    close() { this.readyState = 3; }
    terminate() {}
  }
  __setWebSocketClientForTests(FakeContextSocket);
  const result = await invoke(mountRoute('secret'), {
    provider: 'aliyun', language: 'zh', prompt: 'Kubernetes, GLM-ASR',
    mimeType: 'audio/wav', audioBase64: makeWav().toString('base64')
  });
  assert.equal(result.body.text, '好的');
  const runTask = JSON.parse(socket.sent[0].data);
  assert.deepEqual(runTask.payload.input.context, [
    { role: 'user', content: [{ type: 'input_text', text: 'Kubernetes, GLM-ASR' }] }
  ]);
  // the 2026 preview rejects context, so the same prompt must be omitted there
  const preview = await invoke(mountRoute('secret'), {
    provider: 'aliyun', model: 'fun-asr-realtime-2026-02-28', language: 'zh', prompt: 'Kubernetes',
    mimeType: 'audio/wav', audioBase64: makeWav().toString('base64')
  });
  assert.equal(preview.body.text, '好的');
  const previewRunTask = socket.sent
    .filter((entry) => typeof entry.data === 'string')
    .map((entry) => JSON.parse(entry.data))
    .filter((message) => message.payload && message.payload.model === 'fun-asr-realtime-2026-02-28')
    .at(-1);
  assert.deepEqual(previewRunTask.payload.input, {});
});

test('per-provider key slots never overwrite each other', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const fields = {};
    for (const [key, value] of options.body.entries()) fields[key] = typeof value === 'string' ? value : value.name;
    calls.push({ url: String(url), auth: options.headers.Authorization, fields });
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const route = mountRoute({
      DSH_ASR_ZHIPU_KEY: 'zhipu-specific-key',
      DSH_ASR_API_KEY: 'legacy-shared-key'
    });
    const wav = makeWav().toString('base64');
    await invoke(route, { provider: 'zhipu', mimeType: 'audio/wav', audioBase64: wav });
    assert.equal(calls[0].auth, 'Bearer zhipu-specific-key');
    await invoke(route, { provider: 'openai', mimeType: 'audio/webm', audioBase64: Buffer.from('audio').toString('base64') });
    assert.equal(calls[1].auth, 'Bearer legacy-shared-key');
    await invoke(route, { provider: 'groq', mimeType: 'audio/webm', audioBase64: Buffer.from('audio').toString('base64') });
    assert.equal(calls[2].auth, 'Bearer legacy-shared-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('route resolves the key through the credential service or reports missing_key', async () => {
  const missing = await invoke(mountRoute(''), {
    provider: 'zhipu', mimeType: 'audio/wav', audioBase64: makeWav().toString('base64')
  });
  assert.equal(missing.body.code, 'missing_key');
});

test('route rejects cross-origin calls and malformed Fun-ASR audio', async () => {
  const route = mountRoute();
  const body = { provider: 'aliyun', mimeType: 'audio/wav', audioBase64: Buffer.from('not wav').toString('base64') };
  const crossOrigin = await invoke(route, body, { host: '127.0.0.1:3080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.code, 'forbidden');
  const invalid = await invoke(route, body);
  assert.equal(invalid.body.code, 'invalid_audio');
});
