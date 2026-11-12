/** Template data is never executable. All imported fields are checked before use. */
export const MAX_TEMPLATE_BYTES = 262144;
const MAX_BYTES = 1_000_000_000_000;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_KEYS = ['documentType', 'schemaVersion', 'templateId', 'revision', 'status', 'title', 'description', 'createdAt', 'updatedAt', 'source', 'roles', 'rules', 'manualChecks'];
const RULE_PARAMS = {
  role_count: ['min', 'max'],
  allowed_extensions: ['allowed'],
  max_file_bytes: ['maxBytes', 'displayUnit'],
  filename_template: ['pattern'],
  max_total_bytes: ['maxBytes', 'displayUnit'],
};
const CONTENT_KEYS = ['title', 'description', 'source', 'roles', 'rules', 'manualChecks'];
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const length = value => [...value].length;
const byteLength = value => new TextEncoder().encode(value).byteLength;
const newId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
const lf = value => value.replace(/\r\n?/g, '\n');

/** Object key order is irrelevant; array order and stored field values are not. */
export function canonicalStringify(value) {
  function sort(item) {
    if (Array.isArray(item)) return item.map(sort);
    if (isObject(item)) {
      const result = Object.create(null);
      for (const key of Object.keys(item).sort()) result[key] = sort(item[key]);
      return result;
    }
    return item;
  }
  return JSON.stringify(sort(value));
}

export function sameContent(a, b) {
  if (!a || !b) return false;
  return CONTENT_KEYS.every(key => canonicalStringify(a[key]) === canonicalStringify(b[key]));
}

function isISODate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d, hh, mm, ss, zone] = match;
  const [year, month, day, hour, minute, second] = [y, m, d, hh, mm, ss].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** Drafts permit incomplete values, but never unknown fields or executable input. */
export function validateTemplate(template, mode = 'ready') {
  const errors = [];
  const ready = mode === 'ready';
  const add = (path, message) => errors.push({ path, message });
  if (!['ready', 'draft'].includes(mode)) return { valid: false, errors: [{ path: '$', message: '지원하지 않는 검증 모드예요.' }] };
  const object = (value, path, allowed, required = true) => {
    if (!isObject(value)) { add(path, '객체여야 해요.'); return false; }
    for (const key of Object.keys(value)) {
      if (RESERVED.has(key) || !allowed.includes(key)) add(`${path}.${key}`, '지원하지 않는 키예요.');
    }
    if (required) for (const key of allowed) if (!Object.hasOwn(value, key)) add(`${path}.${key}`, '필수 항목이 없어요.');
    return true;
  };
  const string = (value, path, min, max) => {
    if (typeof value !== 'string') { add(path, '문자열이어야 해요.'); return false; }
    const count = length(value);
    if (count > max || (ready && (count < min || (min > 0 && !value.trim())))) add(path, `${ready ? min : 0}~${max}자 범위로 작성해 주세요.`);
    return true;
  };
  const id = (value, path) => {
    if (!string(value, path, 1, 80)) return false;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(value) || RESERVED.has(value)) { add(path, 'ID는 영문·숫자·밑줄·하이픈을 쓰며 예약어는 사용할 수 없어요.'); return false; }
    return true;
  };
  const integer = (value, path, min, max) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) { add(path, `${min}~${max}의 안전한 정수여야 해요.`); return false; }
    return true;
  };
  const timestamp = (value, path) => {
    if (!ready && value === '') return;
    if (!isISODate(value)) add(path, '실제로 존재하는 ISO 8601 날짜·시각이어야 해요.');
  };
  const list = (value, path, min, max) => {
    if (!Array.isArray(value)) { add(path, '배열이어야 해요.'); return false; }
    if (value.length > max || (ready && value.length < min)) add(path, `${ready ? min : 0}~${max}개 범위여야 해요.`);
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) add(`${path}[${index}]`, '비어 있는 배열 항목은 사용할 수 없어요.');
    return true;
  };

  if (!object(template, '$', TOP_KEYS)) return { valid: false, errors };
  if (template.documentType !== 'machimpyo-template') add('$.documentType', '마침표 검사 기준 파일이 아니에요.');
  if (template.schemaVersion !== 1) add('$.schemaVersion', '지원하는 구조 버전은 숫자 1이에요.');
  id(template.templateId, '$.templateId');
  integer(template.revision, '$.revision', 1, Number.MAX_SAFE_INTEGER);
  if (ready ? template.status !== 'ready' : !['draft', 'ready'].includes(template.status)) add('$.status', ready ? '확정된 ready 기준만 검사·공유할 수 있어요.' : 'draft 또는 ready 상태여야 해요.');
  string(template.title, '$.title', 1, 100);
  string(template.description, '$.description', 0, 1000);
  timestamp(template.createdAt, '$.createdAt');
  timestamp(template.updatedAt, '$.updatedAt');

  if (object(template.source, '$.source', ['title', 'text', 'url', 'checkedAt'])) {
    string(template.source.title, '$.source.title', 1, 200);
    string(template.source.text, '$.source.text', 0, 50000);
    timestamp(template.source.checkedAt, '$.source.checkedAt');
    const url = template.source.url;
    if (url !== null) {
      if (typeof url !== 'string') add('$.source.url', 'null 또는 http/https 주소여야 해요.');
      else {
        try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
        catch { add('$.source.url', 'http 또는 https 주소만 사용할 수 있어요.'); }
      }
    }
  }

  const ids = new Set();
  const registerId = (value, path) => {
    if (!id(value, path) || !value) return;
    if (ids.has(value)) add(path, '역할·규칙·직접 확인의 ID는 서로 중복될 수 없어요.');
    ids.add(value);
  };
  const roles = new Set();
  if (list(template.roles, '$.roles', 1, 10)) template.roles.forEach((role, index) => {
    const path = `$.roles[${index}]`;
    if (!object(role, path, ['id', 'label'])) return;
    registerId(role.id, `${path}.id`);
    string(role.label, `${path}.label`, 1, 50);
    if (typeof role.id === 'string') roles.add(role.id);
  });
  const evidence = (value, path) => {
    if (!object(value, path, ['kind', 'text'])) return;
    if (!['source_quote', 'author_note'].includes(value.kind) && !(value.kind === '' && !ready)) add(`${path}.kind`, 'source_quote 또는 author_note를 선택해 주세요.');
    if (string(value.text, `${path}.text`, 1, 2000) && ready && value.kind === 'source_quote' && typeof template.source?.text === 'string' && !lf(template.source.text).includes(lf(value.text))) add(`${path}.text`, '원문에 포함된 발췌 문장을 입력해 주세요.');
  };
  const roleRef = (value, path, nullable = false) => {
    if (!ready && (value === '' || value === null)) return;
    if (nullable && value === null) return;
    if (typeof value !== 'string') { add(path, nullable ? '역할 ID 또는 null이어야 해요.' : '역할 ID를 지정해 주세요.'); return; }
    id(value, path);
    if (ready && !roles.has(value)) add(path, '존재하는 역할을 지정해 주세요.');
  };
  const counts = new Map();
  const roleTypes = new Set();
  let totalRules = 0;
  const validRules = [];
  if (list(template.rules, '$.rules', 1, 50)) template.rules.forEach((rule, index) => {
    const path = `$.rules[${index}]`;
    if (!object(rule, path, ['id', 'type', 'roleId', 'label', 'params', 'evidence'])) return;
    registerId(rule.id, `${path}.id`);
    string(rule.label, `${path}.label`, 1, 100);
    evidence(rule.evidence, `${path}.evidence`);
    const knownType = typeof rule.type === 'string' && Object.hasOwn(RULE_PARAMS, rule.type);
    if (!knownType) {
      if (!(rule.type === '' && !ready)) add(`${path}.type`, '지원하지 않는 자동 검사 종류예요.');
      if (rule.params !== undefined) object(rule.params, `${path}.params`, [], false);
      return;
    }
    if (rule.type === 'max_total_bytes') {
      totalRules++;
      if (ready && rule.roleId !== null) add(`${path}.roleId`, '전체 합계 규칙의 역할은 null이어야 해요.');
      if (!ready) roleRef(rule.roleId, `${path}.roleId`, true);
    } else roleRef(rule.roleId, `${path}.roleId`);
    const typeKey = `${rule.roleId}:${rule.type}`;
    if (ready && roleTypes.has(typeKey)) add(`${path}.type`, '같은 역할에 같은 종류의 규칙을 중복 등록할 수 없어요.');
    roleTypes.add(typeKey);
    if (!object(rule.params, `${path}.params`, RULE_PARAMS[rule.type])) return;
    const params = rule.params;
    if (rule.type === 'role_count') {
      const minOK = integer(params.min, `${path}.params.min`, 0, 30);
      const maxOK = integer(params.max, `${path}.params.max`, ready ? 1 : 0, 30);
      if (ready && minOK && maxOK && params.min > params.max) add(`${path}.params.max`, '최대 개수는 최소 개수보다 작을 수 없어요.');
      counts.set(rule.roleId, [...(counts.get(rule.roleId) ?? []), rule]);
    } else if (rule.type === 'allowed_extensions') {
      if (list(params.allowed, `${path}.params.allowed`, 1, 20)) {
        const extensions = new Set();
        params.allowed.forEach((extension, n) => {
          if (typeof extension !== 'string' || !/^[a-z0-9]{1,12}$/.test(extension)) add(`${path}.params.allowed[${n}]`, '점 없는 영문 소문자·숫자 1~12자로 입력해 주세요.');
          if (extensions.has(extension)) add(`${path}.params.allowed[${n}]`, '확장자가 중복되어 있어요.');
          extensions.add(extension);
        });
      }
    } else if (rule.type === 'max_file_bytes' || rule.type === 'max_total_bytes') {
      integer(params.maxBytes, `${path}.params.maxBytes`, 1, MAX_BYTES);
      if (!['MB', 'MiB'].includes(params.displayUnit)) add(`${path}.params.displayUnit`, 'MB 또는 MiB를 선택해 주세요.');
    } else if (rule.type === 'filename_template') {
      if (string(params.pattern, `${path}.params.pattern`, 1, 200) && params.pattern) {
        const fixed = params.pattern.replace(/\{(?:studentId|name)\}/g, '');
        if (/[{}]/.test(fixed)) add(`${path}.params.pattern`, '{studentId}와 {name} 자리표시자만 사용할 수 있어요.');
        if (/[\x00-\x1F\x7F-\x9F\\/:*?"<>|]/.test(fixed)) add(`${path}.params.pattern`, '파일명에 사용할 수 없는 문자나 경로 구분자가 있어요.');
        const match = /\.([a-zA-Z0-9]{1,12})$/.exec(params.pattern);
        if (ready && (!match || match.index === 0)) add(`${path}.params.pattern`, '본문 이름과 고정 확장자를 포함한 전체 파일명으로 작성해 주세요.');
      }
    }
    validRules.push({ rule, path });
  });

  if (ready) {
    for (const roleId of roles) if ((counts.get(roleId)?.length ?? 0) !== 1) add('$.rules', `역할 ${roleId}에 개수 규칙을 정확히 한 개 등록해 주세요.`);
    const countRules = [...counts.values()].flat();
    if (!countRules.some(rule => Number.isInteger(rule.params.min) && rule.params.min >= 1)) add('$.rules', '최소 한 역할은 필수 파일이 한 개 이상이어야 해요.');
    if (countRules.reduce((sum, rule) => sum + (Number.isSafeInteger(rule.params.min) ? rule.params.min : 0), 0) > 30) add('$.rules', '필요한 최소 파일 개수의 합은 앱 한도인 30개 이하여야 해요.');
    if (totalRules > 1) add('$.rules', '전체 합계 용량 규칙은 최대 한 개예요.');
    for (const { rule, path } of validRules.filter(item => item.rule.type === 'filename_template')) {
      const extension = typeof rule.params.pattern === 'string' && /\.([a-zA-Z0-9]{1,12})$/.exec(rule.params.pattern)?.[1].toLowerCase();
      const allowed = validRules.find(item => item.rule.roleId === rule.roleId && item.rule.type === 'allowed_extensions')?.rule.params.allowed;
      if (extension && Array.isArray(allowed) && !allowed.includes(extension)) add(`${path}.params.pattern`, '파일명 형식의 고정 확장자가 허용 확장자와 충돌해요.');
    }
  }

  if (list(template.manualChecks, '$.manualChecks', 0, 30)) template.manualChecks.forEach((check, index) => {
    const path = `$.manualChecks[${index}]`;
    if (!object(check, path, ['id', 'roleId', 'question', 'evidence'])) return;
    registerId(check.id, `${path}.id`);
    roleRef(check.roleId, `${path}.roleId`, true);
    string(check.question, `${path}.question`, 1, 300);
    evidence(check.evidence, `${path}.evidence`);
  });
  if (ready && !errors.length) {
    try {
      if (byteLength(`${JSON.stringify(template, null, 2)}\n`) > MAX_TEMPLATE_BYTES) add('$', '공유 JSON이 256KiB를 초과해요. 원문이나 근거 내용을 줄여 주세요.');
    } catch { add('$', 'JSON으로 저장할 수 없는 값이 있어요.'); }
  }
  return { valid: errors.length === 0, errors };
}

const validationError = errors => new Error(errors.map(({ path, message }) => `${path}: ${message}`).join('\n'));

export function serializeTemplate(template) {
  const result = validateTemplate(template, 'ready');
  if (!result.valid) throw validationError(result.errors);
  return `${JSON.stringify(template, null, 2)}\n`;
}

export function parseTemplateJSON(text) {
  if (typeof text !== 'string') throw new Error('$: UTF-8 JSON 텍스트가 필요해요.');
  if (byteLength(text) > MAX_TEMPLATE_BYTES) throw new Error('$: 기준 JSON 파일은 256KiB 이하여야 해요.');
  let template;
  try { template = JSON.parse(text); } catch { throw new Error('$: JSON 문법을 확인해 주세요.'); }
  const result = validateTemplate(template, 'ready');
  if (!result.valid) throw validationError(result.errors);
  return template;
}

export function classifyImport(existing, incoming) {
  if (!existing) return { kind: 'new', message: '새 검사 기준으로 가져옵니다.', allowReplace: true };
  if (canonicalStringify(existing) === canonicalStringify(incoming)) return { kind: 'identical', message: '같은 ID·버전·내용의 기준이 있어요. 중복 저장하지 않습니다.', allowReplace: false };
  if (incoming.revision > existing.revision) return { kind: 'newer', message: `새 기준 v${incoming.revision}입니다. 변경 내용을 확인한 뒤 갱신하거나 사본으로 가져올 수 있어요.`, allowReplace: true };
  if (incoming.revision < existing.revision) return { kind: 'older', message: `현재 v${existing.revision}보다 오래된 v${incoming.revision}입니다. 새 ID의 사본으로만 가져올 수 있어요.`, allowReplace: false };
  return { kind: 'conflict', message: '같은 ID·버전인데 내용이 달라요. 새 ID의 사본으로만 가져올 수 있어요.', allowReplace: false };
}

export function compareTemplates(previous, next) {
  if (!previous) return ['새 검사 기준이 추가됩니다.'];
  const changes = [];
  for (const [key, label] of [['title', '제목'], ['description', '설명'], ['source', '원문']]) if (canonicalStringify(previous[key]) !== canonicalStringify(next[key])) changes.push(`${label}이 변경됨`);
  for (const [key, label, field] of [['roles', '역할', 'label'], ['rules', '자동 규칙', 'label'], ['manualChecks', '직접 확인', 'question']]) {
    const before = new Map((previous[key] ?? []).map(item => [item.id, item]));
    const after = new Map((next[key] ?? []).map(item => [item.id, item]));
    for (const [id, item] of after) {
      if (!before.has(id)) changes.push(`${label} 추가: ${item[field] || id}`);
      else if (canonicalStringify(before.get(id)) !== canonicalStringify(item)) changes.push(`${label} 수정: ${item[field] || id}`);
    }
    for (const [id, item] of before) if (!after.has(id)) changes.push(`${label} 삭제: ${item[field] || id}`);
  }
  return changes.length ? changes : ['조건과 원문에 변경이 없습니다.'];
}

export function createDraft(base = null) {
  const now = new Date().toISOString();
  const roleId = newId('role');
  const template = base ? clone(base) : {
    documentType: 'machimpyo-template', schemaVersion: 1, templateId: newId('tpl'), revision: 1, status: 'draft',
    title: '', description: '', createdAt: now, updatedAt: now,
    source: { title: '', text: '', url: null, checkedAt: now },
    roles: [{ id: roleId, label: '' }],
    rules: [{ id: newId('rule'), type: 'role_count', roleId, label: '', params: { min: 1, max: 1 }, evidence: { kind: 'author_note', text: '' } }],
    manualChecks: [],
  };
  template.status = 'draft';
  template.revision = base ? base.revision + 1 : 1;
  template.updatedAt = now;
  return { draftId: newId('draft'), baseTemplateId: base?.templateId ?? null, baseRevision: base?.revision ?? 0, baseSnapshot: base ? clone(base) : null, template };
}

export function finalizeDraft(record) {
  if (!record || !isObject(record.template)) throw new Error('초안이 없어요.');
  const draftValidation = validateTemplate(record.template, 'draft');
  if (!draftValidation.valid) throw validationError(draftValidation.errors);
  if (record.baseSnapshot && sameContent(record.baseSnapshot, record.template)) return clone(record.baseSnapshot);
  const template = clone(record.template);
  template.status = 'ready';
  template.revision = record.baseSnapshot ? record.baseRevision + 1 : 1;
  template.updatedAt = new Date().toISOString();
  serializeTemplate(template);
  return template;
}

export function importAsCopy(incoming) {
  serializeTemplate(incoming);
  const template = clone(incoming);
  const now = new Date().toISOString();
  template.templateId = newId('tpl');
  template.revision = 1;
  template.createdAt = now;
  template.updatedAt = now;
  serializeTemplate(template);
  return template;
}
