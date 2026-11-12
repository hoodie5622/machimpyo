import { uid } from './utils.js';
import { getManualItems } from './rules.js';

const clone = (value) => structuredClone(value);

export function createSession(template) {
  return {
    sessionId: uid('session'), templateSnapshot: clone(template), templateAcknowledged: false,
    inputRevision: 0, student: { studentId: '', name: '' }, files: [],
    manualAcknowledgements: Object.create(null), runState: 'not_run', latestRun: null,
    activeRunId: null,
  };
}

export function invalidateInspection(session) {
  session.inputRevision += 1;
  session.manualAcknowledgements = Object.create(null);
  session.activeRunId = null;
  session.runState = session.latestRun ? 'stale' : 'not_run';
}

export function applyTemplate(session, template) {
  session.templateSnapshot = clone(template);
  session.templateAcknowledged = false;
  const ids = new Set(template.roles.map((role) => role.id));
  for (const item of session.files) if (!ids.has(item.roleId)) item.roleId = null;
  invalidateInspection(session);
}

export function beginRun(session) {
  if (session.templateSnapshot.status !== 'ready') throw new Error('검사 기준을 먼저 확정해 주세요.');
  if (!session.templateAcknowledged) throw new Error('기준을 확인하고 “이 기준으로 검사하기”를 눌러 주세요.');
  const runId = uid('run');
  session.activeRunId = runId;
  session.runState = 'running';
  return {
    runId, sessionId: session.sessionId, templateId: session.templateSnapshot.templateId,
    templateRevision: session.templateSnapshot.revision, inputRevision: session.inputRevision,
    evaluatedInputRevision: session.inputRevision,
    template: clone(session.templateSnapshot), student: clone(session.student),
    files: session.files.map(({ selectionId, file, roleId }) => ({
      selectionId, roleId, name: file.name, sizeBytes: file.size,
      lastModified: file.lastModified, mimeType: file.type || '',
    })),
  };
}

export function finishRun(session, snapshot, results) {
  if (session.sessionId !== snapshot.sessionId || session.activeRunId !== snapshot.runId
    || session.templateSnapshot.templateId !== snapshot.templateId
    || session.templateSnapshot.revision !== snapshot.templateRevision
    || session.inputRevision !== snapshot.inputRevision) return false;
  session.latestRun = {
    runId: snapshot.runId, sessionId: snapshot.sessionId,
    templateId: snapshot.templateId, templateRevision: snapshot.templateRevision,
    templateTitle: snapshot.template.title,
    evaluatedFiles: clone(snapshot.files),
    evaluatedInputRevision: snapshot.inputRevision, evaluatedAt: new Date().toISOString(),
    results: clone(results),
  };
  session.runState = 'current';
  session.activeRunId = null;
  return true;
}

export function setManual(session, id, confirmed) {
  const descriptors = session.files.map(({ selectionId, file, roleId }) => ({
    selectionId, roleId, name: file.name, sizeBytes: file.size,
    lastModified: file.lastModified, mimeType: file.type || '',
  }));
  const check = getManualItems(session.templateSnapshot, descriptors, session.manualAcknowledgements, session.inputRevision).find((item) => item.id === id);
  if (!check || check.disabled || session.runState !== 'current') return false;
  session.manualAcknowledgements[id] = { inputRevision: session.inputRevision, status: confirmed ? 'confirmed' : 'pending' };
  return true;
}
