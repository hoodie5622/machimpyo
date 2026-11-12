import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, invalidateInspection, applyTemplate, beginRun, finishRun, setManual } from '../js/state.js';
import { addFiles, replaceFile, removeFile, assignRole, toDescriptors } from '../js/files.js';
import { evaluateInspection } from '../js/rules.js';

const template = {
  status: 'ready', templateId: 'test', title: '가상 보고서 제출', revision: 1,
  roles: [{ id: 'report', label: '보고서' }],
  rules: [{ id: 'count', type: 'role_count', roleId: 'report', label: '보고서 개수', params: { min: 1, max: 1 }, evidence: { kind: 'author_note', text: '가상 테스트' } }],
  manualChecks: [{ id: 'manual', question: '직접 열어 확인했나요?', roleId: 'report', evidence: { kind: 'author_note', text: '가상 테스트' } }],
};
const file = () => new File(['가상 테스트 파일'], '보고서.pdf', { type: 'application/pdf', lastModified: 123 });
const started = () => {
  const session = createSession(template);
  session.templateAcknowledged = true;
  addFiles(session, [file()]);
  assignRole(session, session.files[0].selectionId, 'report');
  const snapshot = beginRun(session);
  finishRun(session, snapshot, evaluateInspection(snapshot.template, snapshot.files, snapshot.student));
  return session;
};

test('T55/T56: first input changes stay not_run; acknowledgment gates execution', () => {
  const session = createSession(template);
  addFiles(session, [file()]);
  assert.equal(session.inputRevision, 1);
  assert.equal(session.runState, 'not_run');
  assert.throws(() => beginRun(session), /기준을 확인/);
  session.templateAcknowledged = true;
  assert.equal(beginRun(session).inputRevision, 1);
  const draft = createSession({ ...template, status: 'draft' });
  draft.templateAcknowledged = true;
  assert.throws(() => beginRun(draft), /확정/);
});

test('T23/T24: mutation invalidates current result and clears manual acknowledgments', () => {
  for (const change of [
    (session) => addFiles(session, [file()]),
    (session) => removeFile(session, session.files[0].selectionId),
    (session) => replaceFile(session, session.files[0].selectionId, file()),
    (session) => assignRole(session, session.files[0].selectionId, null),
    (session) => { session.student.name = '가상'; invalidateInspection(session); },
  ]) {
    const session = started();
    assert.equal(setManual(session, 'manual', true), true);
    const previousRevision = session.inputRevision;
    change(session);
    assert.equal(session.runState, 'stale');
    assert.equal(session.inputRevision, previousRevision + 1);
    assert.equal(Object.keys(session.manualAcknowledgements).length, 0);
    assert.ok(session.latestRun);
  }
});

test('T25: applying a new template keeps files, resets deleted role, and requires acknowledgment', () => {
  const session = started();
  const newTemplate = { ...structuredClone(template), revision: 2, roles: [{ id: 'new', label: '새 역할' }], rules: [] };
  const previous = session.inputRevision;
  applyTemplate(session, newTemplate);
  assert.equal(session.inputRevision, previous + 1);
  assert.equal(session.runState, 'stale');
  assert.equal(session.files.length, 1);
  assert.equal(session.files[0].roleId, null);
  assert.equal(session.templateAcknowledged, false);
  assert.equal(session.latestRun.templateRevision, 1);
  assert.throws(() => beginRun(session));
});

test('T26/T27: repeat inspection and manual checks preserve input revision', () => {
  const session = started();
  const inputRevision = session.inputRevision;
  const firstRunId = session.latestRun.runId;
  setManual(session, 'manual', true);
  assert.equal(session.inputRevision, inputRevision);
  const snapshot = beginRun(session);
  assert.equal(finishRun(session, snapshot, evaluateInspection(snapshot.template, snapshot.files, snapshot.student)), true);
  assert.notEqual(session.latestRun.runId, firstRunId);
  assert.equal(session.inputRevision, inputRevision);
  assert.equal(session.manualAcknowledgements.manual.status, 'confirmed');
});

test('T28: late results are ignored after input, template, or newer run changes', () => {
  for (const initialResult of [false, true]) {
    const session = initialResult ? started() : createSession(template);
    session.templateAcknowledged = true;
    const snapshot = beginRun(session);
    invalidateInspection(session);
    assert.equal(finishRun(session, snapshot, []), false);
    assert.equal(session.runState, initialResult ? 'stale' : 'not_run');
  }
  const session = started();
  const old = beginRun(session);
  const current = beginRun(session);
  assert.equal(finishRun(session, old, []), false);
  assert.equal(finishRun(session, current, []), true);
});

test('T29: identical metadata never deduplicates and replacement makes a new selection ID', () => {
  const session = createSession(template);
  const same = file();
  addFiles(session, [same, same]);
  assert.equal(session.files.length, 2);
  assert.notEqual(session.files[0].selectionId, session.files[1].selectionId);
  const oldId = session.files[0].selectionId;
  assignRole(session, oldId, 'report');
  replaceFile(session, oldId, same);
  assert.notEqual(session.files[0].selectionId, oldId);
  assert.equal(session.files[0].roleId, 'report');
  const descriptors = toDescriptors(session.files);
  assert.equal(descriptors[0].name, same.name);
  assert.equal(descriptors[0].sizeBytes, same.size);
  assert.equal(descriptors[0].lastModified, same.lastModified);
});

test('T06: role model only accepts one registered role or null', () => {
  const session = started();
  const id = session.files[0].selectionId;
  assert.equal(assignRole(session, id, ['report', 'other']), false);
  assert.equal(assignRole(session, id, 'unregistered'), false);
  assert.equal(session.files[0].roleId, 'report');
});

test('30-file selection limit is atomic, no silent truncation', () => {
  const session = createSession(template);
  assert.equal(addFiles(session, Array.from({ length: 30 }, file)).added, 30);
  const inputRevision = session.inputRevision;
  const attempt = addFiles(session, [file(), file()]);
  assert.equal(attempt.added, 0);
  assert.match(attempt.error, /30개/);
  assert.equal(session.files.length, 30);
  assert.equal(session.inputRevision, inputRevision);
});

test('snapshots are detached and invalid manual targets cannot be confirmed', () => {
  const session = started();
  const snapshot = beginRun(session);
  session.student.name = '새 이름';
  session.templateSnapshot.roles[0].label = '다른 값';
  assert.equal(snapshot.student.name, '');
  assert.equal(snapshot.template.roles[0].label, '보고서');
  assert.equal(setManual(session, 'manual', true), false);
  assert.equal(setManual(session, '__proto__', true), false);
  finishRun(session, snapshot, []);
  removeFile(session, session.files[0].selectionId);
  assert.equal(setManual(session, 'manual', true), false);
});

test('T30: new sessions start without previous file, student, result, or manual state', () => {
  const session = createSession(template);
  assert.deepEqual(session.student, { studentId: '', name: '' });
  assert.deepEqual(session.files, []);
  assert.equal(session.latestRun, null);
  assert.equal(session.runState, 'not_run');
  assert.equal(session.templateAcknowledged, false);
  assert.equal(Object.getPrototypeOf(session.manualAcknowledgements), null);
});

test('completed run preserves evaluated file names and template title after removal and template changes', () => {
  const session = started();
  const evaluatedId = session.files[0].selectionId;
  const evaluatedName = session.files[0].file.name;
  removeFile(session, evaluatedId);
  applyTemplate(session, { ...structuredClone(template), title: '새 기준 제목', revision: 2 });
  assert.equal(session.runState, 'stale');
  assert.equal(session.files.length, 0);
  assert.equal(session.latestRun.templateTitle, '가상 보고서 제출');
  assert.equal(session.latestRun.templateRevision, 1);
  assert.deepEqual(session.latestRun.evaluatedFiles.map(item => ({ selectionId: item.selectionId, name: item.name })), [{ selectionId: evaluatedId, name: evaluatedName }]);
  assert.equal(session.latestRun.evaluatedFiles[0].sizeBytes, file().size);
  assert.equal(Object.hasOwn(session.latestRun.evaluatedFiles[0], 'file'), false);
});

test('completed run owns a detached copy of evaluated file descriptors', () => {
  const session = started();
  const snapshot = beginRun(session);
  finishRun(session, snapshot, []);
  snapshot.files[0].name = '스냅샷 외부 변경.pdf';
  assert.equal(session.latestRun.evaluatedFiles[0].name, '보고서.pdf');
});
