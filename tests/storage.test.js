import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY, SETTINGS_KEY } from '../js/storage.js';
import { exampleTemplate } from '../data/example-template.js';
import { createDraft } from '../js/templates.js';

class FakeStorage {
  values = new Map();
  failRead = false;
  failWrite = false;
  failRemove = false;
  ignoreWrite = false;
  writes = 0;
  getItem(key) {
    if (this.failRead) throw new Error('Storage blocked');
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.writes++;
    if (this.failWrite) throw new Error('Quota exceeded');
    if (!this.ignoreWrite) this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.failRemove) throw new Error('Storage blocked');
    this.values.delete(key);
  }
}
const copy = value => structuredClone(value);
const dataFor = template => ({ templates: template ? [copy(template)] : [], previous: [], drafts: [] });
const encoded = data => JSON.stringify({ schemaVersion: 1, ...data });

test('empty load is read-only and returns dedicated lists', () => {
  const backend = new FakeStorage();
  const loaded = createStore(backend).load();
  assert.deepEqual(loaded, { data: dataFor(null), error: null, raw: null });
  assert.equal(backend.writes, 0);
});

test('ready templates round-trip without session or file data', () => {
  const backend = new FakeStorage();
  const store = createStore(backend);
  const data = dataFor(exampleTemplate);
  const saved = store.save(data, null);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.conflict, false);
  assert.deepEqual(store.load().data, data);
  assert.deepEqual(Object.keys(JSON.parse(saved.raw)), ['schemaVersion', 'templates', 'previous', 'drafts']);
  assert.equal(backend.getItem(SETTINGS_KEY), null);
});

test('corrupt JSON is retained for recovery and cannot be overwritten', () => {
  const backend = new FakeStorage();
  backend.values.set(STORAGE_KEY, '{broken');
  const store = createStore(backend);
  const loaded = store.load();
  assert.ok(loaded.error);
  assert.equal(loaded.raw, '{broken');
  assert.deepEqual(loaded.data, dataFor(null));
  assert.equal(store.save(dataFor(exampleTemplate), loaded.raw).ok, false);
  assert.equal(backend.getItem(STORAGE_KEY), '{broken');
  assert.equal(backend.writes, 0);
});

test('unknown storage fields, versions, duplicate current IDs and invalid ready data are rejected', () => {
  for (const value of [
    { schemaVersion: 2, ...dataFor(null) },
    { schemaVersion: 1, ...dataFor(null), student: { name: 'unsaved' } },
    { schemaVersion: 1, templates: [exampleTemplate, exampleTemplate], previous: [], drafts: [] },
    { schemaVersion: 1, templates: [{ ...exampleTemplate, status: 'draft' }], previous: [], drafts: [] },
    { schemaVersion: 1, templates: [], previous: {}, drafts: [] }
  ]) {
    const backend = new FakeStorage();
    backend.values.set(STORAGE_KEY, JSON.stringify(value));
    const store = createStore(backend);
    assert.ok(store.load().error);
    assert.equal(store.save(dataFor(null), backend.getItem(STORAGE_KEY)).ok, false);
    assert.equal(backend.writes, 0);
  }
});

test('safe unfinished drafts can be saved and restored', () => {
  const backend = new FakeStorage();
  const store = createStore(backend);
  const draft = createDraft();
  draft.template.title = '';
  draft.template.roles = [];
  draft.template.rules = [];
  const data = { templates: [], previous: [], drafts: [draft] };
  const saved = store.save(data, null);
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(store.load().data.drafts, [draft]);
});

test('draft base snapshot remains recoverable after a newer current revision is stored', () => {
  const backend = new FakeStorage();
  const draft = createDraft(exampleTemplate);
  const next = { ...copy(exampleTemplate), revision: 2, title: '새 버전' };
  const data = { templates: [next], previous: [copy(exampleTemplate)], drafts: [draft] };
  const saved = createStore(backend).save(data, null);
  assert.equal(saved.ok, true, saved.error);
});

test('draft metadata and embedded template must agree; reserved draft IDs are rejected', () => {
  const mutations = [
    draft => { draft.draftId = '__proto__'; },
    draft => { draft.baseRevision = 0; },
    draft => { draft.baseSnapshot.revision = 2; },
    draft => { draft.template.revision = 1; },
    draft => { draft.template.status = 'ready'; },
    draft => { draft.extra = true; }
  ];
  for (const mutate of mutations) {
    const backend = new FakeStorage();
    const draft = createDraft(exampleTemplate);
    mutate(draft);
    const saved = createStore(backend).save({ templates: [], previous: [], drafts: [draft] }, null);
    assert.equal(saved.ok, false);
    assert.equal(backend.writes, 0);
  }
});

test('only one lower previous revision belonging to a current template is accepted', () => {
  const current = { ...copy(exampleTemplate), revision: 3 };
  const previous = { ...copy(exampleTemplate), revision: 2 };
  const cases = [
    { templates: [], previous: [previous], drafts: [] },
    { templates: [current], previous: [current], drafts: [] },
    { templates: [current], previous: [previous, previous], drafts: [] }
  ];
  for (const data of cases) {
    assert.equal(createStore(new FakeStorage()).save(data, null).ok, false);
  }
  const backend = new FakeStorage();
  const store = createStore(backend);
  const saved = store.save({ templates: [current], previous: [previous], drafts: [] }, null);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(store.load().data.previous[0].revision, 2);
});

test('intervening tab writes report a conflict and leave both incoming data and stored data untouched', () => {
  const backend = new FakeStorage();
  const store = createStore(backend);
  const original = dataFor(exampleTemplate);
  const first = store.save(original, null);
  assert.equal(first.ok, true);
  const newer = dataFor({ ...copy(exampleTemplate), revision: 2, title: '다른 탭의 버전' });
  backend.values.set(STORAGE_KEY, encoded(newer));
  const incoming = dataFor({ ...copy(exampleTemplate), title: '현재 탭의 초안' });
  const before = copy(incoming);
  const saved = store.save(incoming, first.raw);
  assert.equal(saved.ok, false);
  assert.equal(saved.conflict, true);
  assert.deepEqual(incoming, before);
  assert.equal(backend.getItem(STORAGE_KEY), encoded(newer));
});

test('missing expected raw refuses save rather than assuming a safe overwrite', () => {
  const backend = new FakeStorage();
  const saved = createStore(backend).save(dataFor(exampleTemplate));
  assert.equal(saved.ok, false);
  assert.equal(backend.writes, 0);
});

test('read, quota and silent-write failures surface errors', () => {
  const blocked = new FakeStorage();
  blocked.failRead = true;
  assert.ok(createStore(blocked).load().error);
  assert.equal(createStore(blocked).save(dataFor(exampleTemplate), null).ok, false);
  const full = new FakeStorage();
  full.failWrite = true;
  const data = dataFor(exampleTemplate);
  const before = copy(data);
  assert.equal(createStore(full).save(data, null).ok, false);
  assert.deepEqual(data, before);
  assert.equal(full.getItem(STORAGE_KEY), null);
  const ignored = new FakeStorage();
  ignored.ignoreWrite = true;
  assert.equal(createStore(ignored).save(data, null).ok, false);
});

test('reset removes only the two Machimpyo keys; removal failures are reported', () => {
  const backend = new FakeStorage();
  backend.values.set(STORAGE_KEY, 'broken data');
  backend.values.set(SETTINGS_KEY, '{}');
  backend.values.set('another-app:key', 'keep');
  const reset = createStore(backend).reset();
  assert.equal(reset.ok, true, reset.error);
  assert.equal(backend.getItem(STORAGE_KEY), null);
  assert.equal(backend.getItem(SETTINGS_KEY), null);
  assert.equal(backend.getItem('another-app:key'), 'keep');
  backend.failRemove = true;
  assert.equal(createStore(backend).reset().ok, false);
});
