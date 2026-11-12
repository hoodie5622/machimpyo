import { validateTemplate } from './templates.js';

export const STORAGE_KEY = 'machimpyo:v1:templates';
export const SETTINGS_KEY = 'machimpyo:v1:settings';
const reservedIds = new Set(['__proto__', 'constructor', 'prototype']);
const emptyData = () => ({ templates: [], previous: [], drafts: [] });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idIsValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !reservedIds.has(value);

function exactKeys(value, keys, label) {
  if (!isObject(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`${label}: 지원하지 않는 저장 구조입니다.`);
  }
}

function checkTemplate(template, mode, label) {
  const checked = validateTemplate(template, mode);
  if (!checked.valid) {
    const first = checked.errors[0];
    throw new Error(`${label}.${first?.path || ''}: ${first?.message || '유효하지 않은 기준입니다.'}`);
  }
}

function validateData(data) {
  exactKeys(data, ['templates', 'previous', 'drafts'], '저장 데이터');
  for (const key of ['templates', 'previous', 'drafts']) {
    if (!Array.isArray(data[key])) throw new Error(`${key}: 목록이어야 합니다.`);
  }
  const current = new Map();
  for (const [index, template] of data.templates.entries()) {
    checkTemplate(template, 'ready', `templates[${index}]`);
    if (current.has(template.templateId)) throw new Error('templates: 기준 ID가 중복됩니다.');
    current.set(template.templateId, template);
  }
  const previousIds = new Set();
  for (const [index, template] of data.previous.entries()) {
    checkTemplate(template, 'ready', `previous[${index}]`);
    const latest = current.get(template.templateId);
    if (!latest || template.revision >= latest.revision || previousIds.has(template.templateId)) {
      throw new Error(`previous[${index}]: 현재 기준보다 낮은 이전 버전 한 개만 보관할 수 있습니다.`);
    }
    previousIds.add(template.templateId);
  }
  const draftIds = new Set();
  for (const [index, draft] of data.drafts.entries()) {
    const label = `drafts[${index}]`;
    exactKeys(draft, ['draftId', 'baseTemplateId', 'baseRevision', 'baseSnapshot', 'template'], label);
    if (!idIsValid(draft.draftId) || draftIds.has(draft.draftId)) {
      throw new Error(`${label}.draftId: 유효하고 고유한 초안 ID가 필요합니다.`);
    }
    draftIds.add(draft.draftId);
    checkTemplate(draft.template, 'draft', `${label}.template`);
    if (draft.template.status !== 'draft') throw new Error(`${label}: 초안 상태여야 합니다.`);
    if (draft.baseTemplateId === null) {
      if (draft.baseRevision !== 0 || draft.baseSnapshot !== null || draft.template.revision !== 1) {
        throw new Error(`${label}: 새 초안의 기반 정보가 올바르지 않습니다.`);
      }
    } else {
      if (!idIsValid(draft.baseTemplateId) || !Number.isSafeInteger(draft.baseRevision) ||
          draft.baseRevision < 1 || !Number.isSafeInteger(draft.baseRevision + 1)) {
        throw new Error(`${label}: 기반 기준 ID와 버전을 확인해 주세요.`);
      }
      checkTemplate(draft.baseSnapshot, 'ready', `${label}.baseSnapshot`);
      if (draft.baseSnapshot.templateId !== draft.baseTemplateId ||
          draft.template.templateId !== draft.baseTemplateId ||
          draft.baseSnapshot.revision !== draft.baseRevision ||
          draft.template.revision !== draft.baseRevision + 1) {
        throw new Error(`${label}: 초안과 기반 기준의 ID 또는 버전이 일치하지 않습니다.`);
      }
    }
  }
}

function decode(raw) {
  if (raw === null) return emptyData();
  let stored;
  try { stored = JSON.parse(raw); }
  catch { throw new Error('저장된 JSON을 읽을 수 없습니다. 원문을 내려받아 보관한 뒤 복구해 주세요.'); }
  exactKeys(stored, ['schemaVersion', 'templates', 'previous', 'drafts'], '저장 데이터');
  if (stored.schemaVersion !== 1) throw new Error('저장 데이터의 버전을 지원하지 않습니다.');
  const data = { templates: stored.templates, previous: stored.previous, drafts: stored.drafts };
  validateData(data);
  return data;
}

/**
 * Dedicated-key storage. A raw comparison detects intervening tab changes; it is
 * deliberately not described as an atomic cross-tab transaction.
 */
export function createStore(storage) {
  let storageError = null;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; }
    catch { storageError = '이 브라우저의 저장소에 접근할 수 없습니다.'; }
  }
  if (!storage) storageError = '이 브라우저의 저장소에 접근할 수 없습니다.';
  return {
    load() {
      let raw = null;
      try {
        if (storageError) throw new Error(storageError);
        raw = storage.getItem(STORAGE_KEY);
        return { data: decode(raw), error: null, raw };
      } catch (error) {
        return { data: emptyData(), error: `기준을 불러오지 못했어요. ${error.message}`, raw };
      }
    },
    save(data, expectedRaw) {
      let currentRaw = null;
      try {
        if (storageError) throw new Error(storageError);
        currentRaw = storage.getItem(STORAGE_KEY);
        if (typeof expectedRaw !== 'string' && expectedRaw !== null) {
          throw new Error('저장 전 보관본 확인이 필요합니다. 기준 목록을 다시 읽어 주세요.');
        }
        if (currentRaw !== expectedRaw) {
          return {
            ok: false, raw: currentRaw, conflict: true,
            error: '다른 탭에서 기준이 바뀌었어요. 초안을 보존한 채 최신 목록을 다시 읽어 주세요.'
          };
        }
        // Corrupt values are never overwritten, including after a failed load.
        decode(currentRaw);
        validateData(data);
        const serialized = JSON.stringify({ schemaVersion: 1, ...data });
        storage.setItem(STORAGE_KEY, serialized);
        if (storage.getItem(STORAGE_KEY) !== serialized) {
          throw new Error('기준이 저장됐는지 확인하지 못했어요. 현재 탭의 내용을 보관해 주세요.');
        }
        return { ok: true, raw: serialized, error: null, conflict: false };
      } catch (error) {
        return {
          ok: false, raw: currentRaw, conflict: false,
          error: `이 브라우저에 저장하지 못했어요. ${error.message}`
        };
      }
    },
    reset() {
      try {
        if (storageError) throw new Error(storageError);
        storage.removeItem(STORAGE_KEY);
        storage.removeItem(SETTINGS_KEY);
        if (storage.getItem(STORAGE_KEY) !== null || storage.getItem(SETTINGS_KEY) !== null) {
          throw new Error('저장 데이터 삭제를 확인하지 못했어요.');
        }
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: `마침표 데이터를 초기화하지 못했어요. ${error.message}` };
      }
    }
  };
}
