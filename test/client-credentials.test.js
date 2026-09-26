import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(credentials) {
  let definition;
  const context = vm.createContext({
    window: {
      __ModuleLoader__: { load(value) { definition = value; } },
      localStorage: { getItem() { return JSON.stringify({ engine: 'api', provider: 'aliyun', model: 'fun-asr-realtime' }); } }
    }, console, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  let states = [], cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = value; }];
    },
    useEffect() {},
    createElement(type, props, ...children) { return { type, props: props || {}, children }; }
  };
  const plugin = definition.factory(() => react);
  assert.ok(plugin.inject.includes('remote.credentials'));
  const slots = new Map();
  plugin.apply({ remote: credentials ? { credentials } : undefined, get() {}, effect() {}, slots: {
    inject(name, factory) { slots.set(name, factory); },
    register(options, component) { return component; }
  } });
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of (Array.isArray(node) ? node : node.children || [])) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  const settings = slots.get('settings.section')();
  const editor = find(settings(), node => node.type?.name === 'ApiKeyEditor').type;
  states = [];
  return {
    render() { cursor = 0; return editor(); },
    find,
    button(tree, label) { return find(tree, node => node.type === 'button' && node.children.includes(label)); },
    input(tree) { return find(tree, node => node.type === 'input'); }
  };
}

function service() {
  const entries = {};
  const calls = [];
  return { entries, calls,
    async describe(refs) {
      assert.ok(Array.isArray(refs));
      return { ok: true, value: Object.fromEntries(refs.map(ref => [ref, entries[ref] || { configured: false, writable: true }])) };
    },
    async set(ref, value) { calls.push(['set', ref, value]); entries[ref] = { configured: true, writable: true, source: 'local' }; return { ok: true }; },
    async unset(ref) { calls.push(['unset', ref]); delete entries[ref]; return { ok: true }; }
  };
}

test('current remote credentials contract saves and deletes the provider key', async () => {
  const api = service(), ui = harness(api);
  await flush();
  ui.input(ui.render()).props.onChange({ target: { value: ' test-secret ' } });
  await ui.button(ui.render(), 'Save').props.onClick();
  assert.deepEqual(api.calls[0], ['set', 'DSH_ASR_ALIYUN_KEY', 'test-secret']);
  assert.equal(ui.input(ui.render()).props.value, '');
  const clear = ui.find(ui.render(), node => node.type === 'button' && node.children[0] !== 'Save');
  assert.ok(clear);
  await clear.props.onClick();
  assert.deepEqual(api.calls[1], ['unset', 'DSH_ASR_ALIYUN_KEY']);
});

test('shared credential fallback and read-only provider status survive migration', async () => {
  const api = service();
  api.entries.DSH_ASR_API_KEY = { configured: true, source: 'local', writable: true };
  const ui = harness(api);
  await flush();
  assert.match(JSON.stringify(ui.render()), /shared|共享/);
  api.entries.DSH_ASR_ALIYUN_KEY = { configured: true, source: 'env', writable: false };
  const readonly = harness(api);
  await flush();
  assert.equal(readonly.input(readonly.render()).props.disabled, true);
});

for (const mode of ['missing', 'refused', 'throw', 'invalid']) {
  test(`save reports ${mode} service failure and preserves draft`, async () => {
    const api = mode === 'missing' ? undefined : service();
    if (api) api.set = () => {
      if (mode === 'throw') throw new Error('transport unavailable');
      return Promise.resolve(mode === 'invalid' ? undefined : { ok: false, error: { message: 'write denied' } });
    };
    const ui = harness(api);
    await flush();
    ui.input(ui.render()).props.onChange({ target: { value: 'test-secret' } });
    await ui.button(ui.render(), 'Save').props.onClick();
    const tree = ui.render();
    assert.equal(ui.input(tree).props.value, 'test-secret');
    assert.ok(ui.find(tree, node => node.props.className?.includes('stt-key-err')));
    assert.equal(ui.button(tree, 'Save').props.disabled, false);
  });
}
