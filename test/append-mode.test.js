import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Regression test for append mode: the mic button lives in the
 * `conversation.input.left` slot, whose standard props carry the draft only
 * through the `useInput` selector hook (there is NO `input` prop — that
 * shape belongs to the dock slot's owner props). Reading `props.input.draft`
 * always yielded '', so `applyText` called `inputActions.setDraft(text)` on
 * an empty base and silently REPLACED whatever the user had already typed.
 *
 * This drives the real client bundle: window.__ModuleLoader__ captures the
 * factory, apply() registers the slot components, and the mic button is
 * clicked start→stop against a fake SpeechRecognition, asserting the final
 * setDraft call preserves the pre-existing draft and appends after it.
 */

let capturedLoaderDef = null;
globalThis.window = {
  __ModuleLoader__: {
    load(def) { capturedLoaderDef = def; }
  }
};
await import('../lib/client.js');
assert.ok(capturedLoaderDef, 'client bundle registered through window.__ModuleLoader__');
assert.equal(capturedLoaderDef.id, 'dsh-asr-coding');

// Minimal React stand-in: MicButton only needs useState/useEffect from
// useStore() and createElement to return its handler props.
const fakeReact = {
  calls: { useState: 0, useEffect: 0 },
  useState(init) {
    fakeReact.calls.useState += 1;
    return [typeof init === 'function' ? init() : init, function () {}];
  },
  useEffect(fn) {
    fakeReact.calls.useEffect += 1;
    try { fn(); } catch (e) {}
    return undefined;
  },
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    return { type, props: props || {}, children };
  },
  Fragment: 'FakeFragment'
};

const moduleExports = capturedLoaderDef.factory(function (name) {
  assert.equal(name, 'react');
  return fakeReact;
});
assert.equal(moduleExports.name, 'dsh-asr-coding');

// apply() with a host stub: capture the slot registrations, expose nothing
// else (no settings scope, no locale, no document in Node).
function registerComponents() {
  const factories = new Map();
  const ctx = {
    get(key) { return undefined; },
    effect(fn) { try { fn(); } catch (e) {} return undefined; },
    slots: {
      inject(name, factory) { factories.set(name, factory); },
      register(opts, component) { return { opts, component }; }
    }
  };
  moduleExports.apply(ctx);
  const entry = factories.get('conversation.input.left');
  assert.ok(entry, 'mic button registered in conversation.input.left');
  return entry().component;
}

// Fake SpeechRecognition: stop() finalizes one recognized sentence and ends.
class FakeSpeechRecognition {
  constructor() { this.continuous = false; this.interimResults = false; }
  start() { FakeSpeechRecognition.last = this; }
  stop() {
    const self = this;
    self.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: '识别到的文字' } }]
    });
    self.onend();
  }
}
globalThis.window.SpeechRecognition = FakeSpeechRecognition;

test('mic button appends recognized text after the existing draft', () => {
  const MicButton = registerComponents();

  const calls = { useInput: 0, setDraft: [] };
  const inputActions = {
    setDraft(text) { calls.setDraft.push(text); },
    addImages() { return false; },
    removeImage() {},
    pruneImages() {},
    submit() {}
  };
  // The real slot contract: draft arrives via the useInput hook, and no
  // `input` prop exists at all (the previously assumed shape).
  const props = {
    inputActions,
    useInput(selector) {
      calls.useInput += 1;
      return selector({ draft: '已有的输入', imageIds: [], draftRev: 1, phase: 'plain', occurrences: [], queue: [] });
    }
  };

  const started = MicButton(props);
  assert.equal(typeof started.props.onClick, 'function', 'click mode exposes onClick');
  started.props.onClick(); // begin recording
  assert.ok(FakeSpeechRecognition.last, 'SpeechRecognition instance started');

  const stopped = MicButton(props);
  stopped.props.onClick(); // stop → fake SR finalizes and ends

  assert.equal(calls.useInput >= 2, true, 'draft read through the useInput hook');
  assert.ok(calls.setDraft.length >= 1, 'at least one draft write');
  // Every write (live preview and final) must preserve the existing draft.
  for (const write of calls.setDraft) {
    assert.ok(write.indexOf('已有的输入') === 0, `write preserved the draft: ${write}`);
  }
  assert.equal(calls.setDraft[calls.setDraft.length - 1], '已有的输入 识别到的文字');
});

test('mic button works when the draft is empty (nothing to preserve)', () => {
  const MicButton = registerComponents();
  const written = [];
  const props = {
    inputActions: { setDraft(t) { written.push(t); }, addImages() { return false; }, removeImage() {}, pruneImages() {}, submit() {} },
    useInput(selector) { return selector({ draft: '', imageIds: [], draftRev: 1, phase: 'plain', occurrences: [], queue: [] }); }
  };
  MicButton(props).props.onClick();
  MicButton(props).props.onClick();
  assert.deepEqual(written, ['识别到的文字', '识别到的文字']);
});
