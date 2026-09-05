import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, SETTINGS_NS, SettingsSchema, SETTINGS_DEFAULTS } from '../lib/index.js';

/**
 * The plugin registers its settings namespace on the host settings service so
 * the client settings page persists to ~/.dsh/settings.yaml (shared by every
 * browser) instead of per-browser localStorage.
 */

function makeCtx({ withSettings = true } = {}) {
  const state = { registrations: new Map() };
  const injects = [];
  const ctx = {
    inject(deps, callback) {
      injects.push(deps);
      // The real service proxy hands the caller a context exposing the
      // service; the webServer inject also carries credentials here.
      const hostCtx = {
        effect(install) { install(); },
        credentials: { resolve: async () => undefined },
        webServer: { register() { return () => {}; } },
        ...(withSettings
          ? {
              settings: {
                register(ns, schema, options) {
                  state.registrations.set(ns, { schema, options });
                  return { get: () => schema({}), update: async () => {}, replace: async () => {} };
                }
              }
            }
          : {})
      };
      callback(hostCtx);
    }
  };
  return { ctx, state, injects };
}

test('exports a kebab-case settings namespace matching the plugin name', () => {
  assert.equal(SETTINGS_NS, 'dsh-asr-coding');
  assert.match(SETTINGS_NS, /^[a-z][a-z0-9-]*$/);
});

test('schema resolves every documented default', () => {
  const resolved = SettingsSchema({});
  assert.deepEqual(resolved, SETTINGS_DEFAULTS);
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    assert.equal(typeof resolved[key], 'string', key);
  }
});

test('schema layers user values over defaults and keeps them strings', () => {
  const resolved = SettingsSchema({ engine: 'api', provider: 'aliyun', model: 'fun-asr-realtime' });
  assert.equal(resolved.engine, 'api');
  assert.equal(resolved.provider, 'aliyun');
  assert.equal(resolved.model, 'fun-asr-realtime');
  assert.equal(resolved.insertMode, SETTINGS_DEFAULTS.insertMode);
  assert.equal(resolved.triggerMode, SETTINGS_DEFAULTS.triggerMode);
});

test('apply registers the namespace on the host settings service', () => {
  const { ctx, state } = makeCtx();
  apply(ctx);
  assert.ok(state.registrations.has(SETTINGS_NS), 'namespace registered');
  const { schema, options } = state.registrations.get(SETTINGS_NS);
  assert.equal(schema, SettingsSchema);
  assert.deepEqual(options, {});
  // Registered schema still resolves defaults for the settings service.
  assert.equal(schema({}).engine, 'browser');
});

test('apply tolerates a host without the settings service', () => {
  const { ctx, state } = makeCtx({ withSettings: false });
  apply(ctx);
  assert.equal(state.registrations.size, 0);
});
