import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';

import { apply, __setWebSocketClientForTests } from '../lib/index.js';

let upstreamSocket;

// every test in this file drives the relay against the fake upstream


class FakeUpstream extends EventEmitter {
  static OPEN = 1;
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 1;
    this.sent = [];
    upstreamSocket = this;
    queueMicrotask(() => this.emit('open'));
  }
  send(data, options, callback) {
    this.sent.push({ data, options });
    queueMicrotask(() => {
      if (callback) callback();
      if (typeof data !== 'string') return;
      const message = JSON.parse(data);
      if (message.header && message.header.action === 'run-task') {
        this.taskId = message.header.task_id;
        this.emit('message', Buffer.from(JSON.stringify({ header: { task_id: this.taskId, event: 'task-started' }, payload: {} })), false);
      }
    });
  }
  close() { this.readyState = 3; }
  terminate() {}
}

function mountUpgrade(credentialValue = 'secret') {
  let upgrade;
  apply({
    inject(_deps, callback) {
      callback({
        effect(install) { install(); },
        credentials: {
          resolve: async (ref) => (ref === 'DSH_ASR_API_KEY' && credentialValue
            ? { value: credentialValue, source: 'file' }
            : undefined)
        },
        webServer: {
          register() { return () => {}; },
          registerUpgrade(value) { upgrade = value; return () => {}; }
        }
      });
    }
  });
  return upgrade;
}

function startTestServer(upgrade) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => upgrade.handler(req, socket, head));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function openClient(port, origin) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket('ws://127.0.0.1:' + port + '/stt-input/stream', {
      headers: { origin }
    });
    client.on('error', reject);
    client.on('open', () => resolve(client));
  });
}

test('live streaming route relays PCM and pushes interim sentences', async () => {
  __setWebSocketClientForTests(FakeUpstream);
  const upgrade = mountUpgrade();
  const server = await startTestServer(upgrade);
  const port = server.address().port;
  const events = [];
  const client = await openClient(port, 'http://127.0.0.1:' + port);
  const done = new Promise((resolve, reject) => {
    client.on('error', reject);
    client.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString('utf8'));
      events.push(message);
      if (message.type === 'done') resolve();
    });
  });
  client.send(JSON.stringify({ type: 'start', language: 'zh' }));
  client.send(Buffer.alloc(3200));
  await new Promise((resolve) => setTimeout(resolve, 30));
  // simulate upstream recognition results then finishing
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ header: { task_id: upstreamSocket.taskId, event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, sentence_end: false, text: '你好' } } } })), false);
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ header: { task_id: upstreamSocket.taskId, event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, sentence_end: true, text: '你好，' } } } })), false);
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ header: { task_id: upstreamSocket.taskId, event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 2, sentence_end: true, text: '世界' } } } })), false);
  client.send(JSON.stringify({ type: 'finish' }));
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ header: { task_id: upstreamSocket.taskId, event: 'task-finished' } })), false);
  await done;
  client.close();
  server.close();

  assert.deepEqual(events.map((event) => event.type), ['started', 'sentence', 'sentence', 'sentence', 'done']);
  assert.deepEqual(events.filter((event) => event.type === 'sentence').map((event) => event.isFinal), [false, true, true]);
  assert.equal(events.at(-1).text, '你好，世界');
  assert.equal(upstreamSocket.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
  assert.equal(upstreamSocket.options.headers.Authorization, 'Bearer secret');
  const runTask = JSON.parse(upstreamSocket.sent[0].data);
  assert.equal(runTask.payload.model, 'fun-asr-realtime');
  assert.equal(runTask.payload.parameters.format, 'pcm');
  assert.equal(runTask.payload.parameters.sample_rate, 16000);
  assert.deepEqual(runTask.payload.parameters.language_hints, ['zh']);
  const binary = upstreamSocket.sent.filter((frame) => Buffer.isBuffer(frame.data));
  assert.equal(binary.length, 1);
  assert.equal(binary[0].data.length, 3200);
});

test('qwen realtime stream relays appends and pushes sentences', async () => {
  __setWebSocketClientForTests(FakeUpstream);
  const upgrade = mountUpgrade();
  const server = await startTestServer(upgrade);
  const port = server.address().port;
  const events = [];
  const client = await openClient(port, 'http://127.0.0.1:' + port);
  const done = new Promise((resolve, reject) => {
    client.on('error', reject);
    client.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString('utf8'));
      events.push(message);
      if (message.type === 'done') resolve();
    });
  });
  const frame = Buffer.alloc(3200, 7);
  client.send(JSON.stringify({ type: 'start', model: 'qwen3-asr-flash-realtime', language: 'zh' }));
  client.send(frame);
  await new Promise((resolve) => setTimeout(resolve, 30));
  client.send(JSON.stringify({ type: 'finish' }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', item_id: 'item_1', text: '', stash: '北京' })), false);
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: '北京的天气' })), false);
  upstreamSocket.emit('message', Buffer.from(JSON.stringify({ type: 'session.finished' })), false);
  await done;
  client.close();
  server.close();

  assert.equal(upstreamSocket.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime');
  assert.equal(upstreamSocket.options.headers.Authorization, 'Bearer secret');
  const sent = upstreamSocket.sent.map((entry) => JSON.parse(entry.data));
  assert.equal(sent[0].type, 'session.update');
  assert.equal(sent[0].session.input_audio_format, 'pcm');
  assert.equal(sent[0].session.sample_rate, 16000);
  assert.equal(sent[0].session.input_audio_transcription.language, 'zh');
  assert.deepEqual(sent[0].session.turn_detection, { type: 'server_vad', threshold: 0, silence_duration_ms: 400 });
  const appends = sent.filter((event) => event.type === 'input_audio_buffer.append');
  assert.equal(appends.length, 1);
  assert.deepEqual(Buffer.from(appends[0].audio, 'base64'), frame);
  assert.equal(sent.at(-1).type, 'session.finish');
  assert.deepEqual(events.map((event) => event.type), ['started', 'sentence', 'sentence', 'done']);
  assert.deepEqual(events.filter((event) => event.type === 'sentence').map((event) => [event.text, event.isFinal]), [['北京', false], ['北京的天气', true]]);
  assert.equal(events.at(-1).text, '北京的天气');
});

test('streaming route rejects cross-origin upgrades and filters languages', async () => {
  __setWebSocketClientForTests(FakeUpstream);
  const upgrade = mountUpgrade();
  const server = await startTestServer(upgrade);
  const port = server.address().port;

  await assert.rejects(() => openClient(port, 'https://evil.example'));

  const client = await openClient(port, 'http://127.0.0.1:' + port);
  await new Promise((resolve) => {
    client.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString('utf8'));
      if (message.type === 'started') resolve();
    });
    // yue (Cantonese) is valid only for the qwen realtime model, not for the
    // default fun-asr-realtime, so the hint must be dropped
    client.send(JSON.stringify({ type: 'start', language: 'yue' }));
  });
  client.close();
  server.close();
  const runTask = JSON.parse(upstreamSocket.sent[0].data);
  assert.equal(runTask.payload.parameters.language_hints, undefined);
});

test('missing API key closes the stream with missing_key', async () => {
  __setWebSocketClientForTests(FakeUpstream);
  const upgrade = mountUpgrade('');
  const server = await startTestServer(upgrade);
  const port = server.address().port;
  const client = await openClient(port, 'http://127.0.0.1:' + port);
  const events = await new Promise((resolve) => {
    const collected = [];
    client.on('message', (data, isBinary) => {
      if (isBinary) return;
      collected.push(JSON.parse(data.toString('utf8')));
    });
    client.on('close', () => resolve(collected));
    client.send(JSON.stringify({ type: 'start' }));
  });
  server.close();
  assert.deepEqual(events, [{ type: 'error', code: 'missing_key' }]);
});
