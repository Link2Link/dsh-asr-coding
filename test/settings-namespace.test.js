import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, SETTINGS_NS, SettingsSchema, Config, SETTINGS_DEFAULTS } from '../lib/index.js';

/**
 * dsh ≥ 0.1.7 serves a plugin's settings namespace from the module-level
 * `Config` export (namespace = profile entry id), so the client settings
 * page persists to the host settings document (shared by every browser)
 * instead of per-browser localStorage.
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

test('exports the settings schema as the module-level Config (dsh ≥ 0.1.7)', () => {
  assert.equal(Config, SettingsSchema);
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

test('apply mounts the webServer route without touching the settings service', () => {
  const { ctx, state, injects } = makeCtx();
  apply(ctx);
  assert.equal(state.registrations.size, 0);
  assert.ok(injects.some(deps => deps.includes('webServer')));
});

test('apply tolerates a host without the settings service', () => {
  const { ctx, state } = makeCtx({ withSettings: false });
  apply(ctx);
  assert.equal(state.registrations.size, 0);
});
