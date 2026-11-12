import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleTemplate } from '../data/example-template.js';
import { validateTemplate, serializeTemplate, parseTemplateJSON, canonicalStringify, sameContent, compareTemplates, classifyImport, createDraft, finalizeDraft, importAsCopy, MAX_TEMPLATE_BYTES } from '../js/templates.js';

const example = () => structuredClone(exampleTemplate);
const invalid = (mutate, pathPart) => {
  const template = example();
  mutate(template);
  const result = validateTemplate(template);
  assert.equal(result.valid, false);
  if (pathPart) assert.ok(result.errors.some(error => error.path.includes(pathPart)), JSON.stringify(result.errors));
};

test('fictional example is ready, export uses two spaces and a final newline, and round trips', () => {
  assert.deepEqual(validateTemplate(exampleTemplate), { valid: true, errors: [] });
  const json = serializeTemplate(exampleTemplate);
  assert.ok(json.startsWith('{\n  "documentType"'));
  assert.ok(json.endsWith('}\n'));
  assert.deepEqual(parseTemplateJSON(json), exampleTemplate);
});

test('T32 JSON syntax and non-object roots are rejected', () => {
  for (const input of ['{', 'null', '[]', '1', '"string"']) assert.throws(() => parseTemplateJSON(input));
});

test('T33 exact numeric schema version and document type are required', () => {
  for (const version of [2, '1', null]) invalid(t => { t.schemaVersion = version; }, 'schemaVersion');
  invalid(t => { t.documentType = 'other'; }, 'documentType');
});

test('T34 duplicate IDs across all item categories are rejected', () => {
  invalid(t => { t.roles[1].id = t.roles[0].id; }, 'roles[1].id');
  invalid(t => { t.manualChecks[0].id = t.rules[0].id; }, 'manualChecks[0].id');
  invalid(t => { t.rules[0].id = t.roles[0].id; }, 'rules[0].id');
});

test('T35 dangling role references and invalid global scope are rejected', () => {
  invalid(t => { t.rules[2].roleId = 'missing'; }, 'roleId');
  invalid(t => { t.manualChecks[0].roleId = 'missing'; }, 'roleId');
  invalid(t => { t.rules[2].roleId = null; }, 'roleId');
  invalid(t => { t.rules.push({ id: 'total', type: 'max_total_bytes', roleId: 'report', label: '합계', params: { maxBytes: 5000000, displayUnit: 'MB' }, evidence: { kind: 'author_note', text: '작성자가 추가한 합계 제한' } }); }, 'roleId');
});

test('T36 counts require integers, ordered bounds, and max of at least one', () => {
  invalid(t => { t.rules[0].params.min = 1.5; }, 'params.min');
  invalid(t => { t.rules[0].params.min = 2; }, 'params.max');
  invalid(t => { t.rules[0].params.max = 0; }, 'params.max');
  invalid(t => { t.rules[0].params.min = -1; }, 'params.min');
});

test('T36 size limits are positive safe integers up to one TB', () => {
  for (const value of [-1, 0, 1.5, 1_000_000_000_001, Number.MAX_SAFE_INTEGER + 1, '5000000', NaN]) invalid(t => { t.rules[4].params.maxBytes = value; }, 'maxBytes');
  const template = example();
  template.rules[4].params.maxBytes = 1_000_000_000_000;
  assert.equal(validateTemplate(template).valid, true);
});

test('T37 unknown rule types, fields, and placeholders fail instead of being discarded', () => {
  invalid(t => { t.rules[0].type = 'execute_code'; }, 'type');
  invalid(t => { t.extra = 'unknown'; }, 'extra');
  invalid(t => { t.source.extra = 'unknown'; }, 'extra');
  invalid(t => { t.rules[0].params.unexpected = 1; }, 'unexpected');
  invalid(t => { t.rules[6].params.pattern = '{unknown}.pdf'; }, 'pattern');
});

test('T38 source quotes must occur in source; only newline representation is normalized', () => {
  invalid(t => { t.rules[0].evidence.text = '만들어 낸 문장'; }, 'evidence.text');
  const template = example();
  template.source.text = '첫 줄\r\n둘째 줄';
  for (const rule of template.rules) rule.evidence = { kind: 'author_note', text: '작성자가 추가한 기준' };
  template.manualChecks[0].evidence = { kind: 'source_quote', text: '첫 줄\n둘째 줄' };
  assert.equal(validateTemplate(template).valid, true);
  template.manualChecks[0].evidence.text = '첫 줄 둘째 줄';
  assert.equal(validateTemplate(template).valid, false);
});

test('T39 canonical comparison ignores object key order but preserves arrays and field values', () => {
  const reversed = Object.fromEntries(Object.entries(example()).reverse());
  assert.equal(classifyImport(exampleTemplate, reversed).kind, 'identical');
  const changed = example();
  changed.roles.reverse();
  assert.notEqual(canonicalStringify(changed), canonicalStringify(exampleTemplate));
  assert.equal(classifyImport(exampleTemplate, changed).kind, 'conflict');
});

test('T40 same revision different content and timestamps are conflicts', () => {
  const template = example();
  template.title = '다른 제목';
  assert.deepEqual(classifyImport(exampleTemplate, template).kind, 'conflict');
  assert.equal(classifyImport(exampleTemplate, template).allowReplace, false);
  template.title = exampleTemplate.title;
  template.updatedAt = '2026-11-12T14:00:00Z';
  assert.equal(classifyImport(exampleTemplate, template).kind, 'conflict');
});

test('T41 higher revision offers replacement and reports changed conditions', () => {
  const template = example();
  template.revision = 2;
  template.rules[4].params.maxBytes = 4000000;
  assert.equal(classifyImport(exampleTemplate, template).kind, 'newer');
  assert.equal(classifyImport(exampleTemplate, template).allowReplace, true);
  assert.ok(compareTemplates(exampleTemplate, template).some(item => item.includes('자동 규칙 수정')));
});

test('T42 lower revision can only be imported as copy', () => {
  const current = example();
  current.revision = 2;
  assert.equal(classifyImport(current, exampleTemplate).kind, 'older');
  assert.equal(classifyImport(current, exampleTemplate).allowReplace, false);
  const copy = importAsCopy(exampleTemplate);
  assert.notEqual(copy.templateId, exampleTemplate.templateId);
  assert.equal(copy.revision, 1);
  assert.equal(validateTemplate(copy).valid, true);
  assert.equal(sameContent(copy, exampleTemplate), true);
});

test('T43 input limit counts UTF-8 bytes before parsing', () => {
  const large = '가'.repeat(Math.floor(MAX_TEMPLATE_BYTES / 3) + 1);
  assert.throws(() => parseTemplateJSON(large), /256KiB/);
});

test('T44 HTML strings are inert data and survive unchanged', () => {
  const template = example();
  template.title = '<img src=x onerror=alert(1)>';
  template.source.title = '<script>alert(1)</script>';
  const restored = parseTemplateJSON(serializeTemplate(template));
  assert.equal(restored.title, template.title);
  assert.equal(restored.source.title, template.source.title);
});

test('T45 source URLs are http or https only', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/plain,a', '/relative']) invalid(t => { t.source.url = url; }, 'url');
  for (const url of [null, 'https://example.com/a', 'http://example.com']) {
    const template = example(); template.source.url = url;
    assert.equal(validateTemplate(template).valid, true);
  }
});

test('T50 unknown session fields cannot leak into share JSON', () => {
  for (const field of ['student', 'files', 'results', 'baseSnapshot']) {
    const template = example(); template[field] = { name: '학생' };
    assert.throws(() => serializeTemplate(template), new RegExp(field));
  }
});

test('T52 individually valid fields may still exceed the formatted UTF-8 export limit', () => {
  const template = example();
  template.source.text = '가'.repeat(50000);
  for (const rule of template.rules) rule.evidence = { kind: 'author_note', text: '나'.repeat(2000) };
  template.manualChecks = Array.from({ length: 30 }, (_, n) => ({ id: `manual_${n}`, roleId: null, question: '확인'.repeat(100), evidence: { kind: 'author_note', text: '다'.repeat(2000) } }));
  assert.ok(validateTemplate(template).errors.some(error => error.message.includes('256KiB')));
  assert.throws(() => serializeTemplate(template), /256KiB/);
});

test('T53 new scaffold and incomplete rules save as draft but cannot be shared', () => {
  const record = createDraft();
  assert.equal(record.template.status, 'draft');
  assert.equal(record.template.revision, 1);
  assert.equal(record.baseTemplateId, null);
  assert.equal(record.baseRevision, 0);
  assert.equal(record.baseSnapshot, null);
  assert.equal(record.template.roles.length, 1);
  assert.equal(validateTemplate(record.template, 'draft').valid, true);
  record.template.rules[0].type = 'filename_template';
  record.template.rules[0].params = { pattern: '' };
  assert.equal(validateTemplate(record.template, 'draft').valid, true);
  assert.equal(validateTemplate(record.template, 'ready').valid, false);
  assert.throws(() => serializeTemplate(record.template), /ready/);
});

test('T54 reserved ID values and reserved object keys fail at every relevant level', () => {
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    invalid(t => { t.templateId = id; }, 'templateId');
    invalid(t => { t.roles[0].id = id; }, 'roles[0].id');
    invalid(t => { t.rules[0].id = id; }, 'rules[0].id');
    invalid(t => { t.manualChecks[0].id = id; }, 'manualChecks[0].id');
  }
  const template = example();
  template.rules[0].params = JSON.parse('{"min":1,"max":1,"__proto__":{"polluted":true}}');
  assert.equal(validateTemplate(template).valid, false);
  assert.equal({}.polluted, undefined);
});

test('each role needs exactly one count rule; all optional and impossible minimum totals fail', () => {
  invalid(t => { t.rules = t.rules.filter(r => r.id !== 'report_count'); }, 'rules');
  invalid(t => { t.rules[0].params.min = 0; t.rules[1].params.min = 0; }, 'rules');
  invalid(t => { t.rules[0].params = { min: 20, max: 20 }; t.rules[1].params = { min: 20, max: 20 }; }, 'rules');
  const template = example();
  template.rules[0].params.max = 30; template.rules[1].params.max = 30;
  assert.equal(validateTemplate(template).valid, true);
});

test('duplicate type per role and duplicate total size rules are refused', () => {
  invalid(t => { t.rules.push({ ...structuredClone(t.rules[2]), id: 'other_extension' }); }, 'type');
  invalid(t => {
    t.rules.push(...['total_a', 'total_b'].map(id => ({ id, type: 'max_total_bytes', roleId: null, label: '전체 합계', params: { maxBytes: 1, displayUnit: 'MB' }, evidence: { kind: 'author_note', text: '추가 기준' } })));
  }, 'rules');
});

test('fixed filename extension and literal characters must be safe and compatible', () => {
  for (const pattern of ['../report.pdf', '{studentId}/report.pdf', 'a:b.pdf', 'a\u0085.pdf', 'report', '.pdf', 'report.{name}', '{studentId.pdf']) invalid(t => { t.rules[6].params.pattern = pattern; }, 'pattern');
  invalid(t => { t.rules[6].params.pattern = 'report.hwpx'; }, 'pattern');
  const template = example(); template.rules[6].params.pattern = '보고서.PDF';
  assert.equal(validateTemplate(template).valid, true);
});

test('extension entries and display units use the exact supported formats', () => {
  for (const extension of ['.pdf', 'PDF', '', 'verylongextension', 'p_df']) invalid(t => { t.rules[2].params.allowed = [extension]; }, 'allowed');
  invalid(t => { t.rules[2].params.allowed = ['pdf', 'pdf']; }, 'allowed');
  invalid(t => { t.rules[4].params.displayUnit = 'KB'; }, 'displayUnit');
});

test('real ISO calendar dates required; JavaScript date overflow is rejected', () => {
  for (const date of ['2026-02-30T00:00:00Z', '2026-11-11', '2026-13-01T00:00:00Z', '2026-11-11T24:00:00Z', '2026-11-11T12:00:00+24:00']) invalid(t => { t.createdAt = date; }, 'createdAt');
  const template = example();
  template.source.checkedAt = '2024-02-29T23:59:59.123+09:00';
  assert.equal(validateTemplate(template).valid, true);
});

test('length limits count Unicode code points, including astral characters', () => {
  const template = example(); template.title = '😀'.repeat(100);
  assert.equal(validateTemplate(template).valid, true);
  template.title += '😀';
  assert.equal(validateTemplate(template).valid, false);
});

test('new edited versions retain immutable base; unchanged content does not increment revision', () => {
  const base = example();
  const record = createDraft(base);
  assert.equal(record.template.revision, 2);
  assert.equal(record.baseRevision, 1);
  assert.equal(record.baseTemplateId, base.templateId);
  assert.deepEqual(finalizeDraft(record), base);
  record.template.title = '수정한 제목';
  const result = finalizeDraft(record);
  assert.equal(result.revision, 2);
  assert.equal(result.status, 'ready');
  assert.equal(result.templateId, base.templateId);
  assert.equal(base.title, exampleTemplate.title);
  assert.equal(record.baseSnapshot.title, base.title);
  assert.equal(result.createdAt, base.createdAt);
});

test('drafts reject unknown fields and unsafe params before unchanged-content shortcut', () => {
  const record = createDraft(exampleTemplate);
  record.template.student = { name: '비공개' };
  assert.throws(() => finalizeDraft(record), /student/);
  const draft = createDraft().template;
  draft.rules[0].type = '';
  draft.rules[0].params = JSON.parse('{"constructor":1}');
  assert.equal(validateTemplate(draft, 'draft').valid, false);
});

test('local drafts require editor container shapes while permitting empty content', () => {
  for (const mutate of [
    t => { delete t.roles; },
    t => { delete t.rules; },
    t => { delete t.manualChecks; },
    t => { delete t.source; },
    t => { delete t.rules[0].params; },
    t => { t.rules[0].params = {}; },
    t => { delete t.rules[0].evidence; },
    t => { delete t.rules[0].evidence.kind; },
    t => { t.rules[0].evidence.text = undefined; },
    t => { t.rules[0].type = 'allowed_extensions'; t.rules[0].params = {}; },
    t => { t.rules[0].type = 'max_file_bytes'; t.rules[0].params = { displayUnit: 'MB' }; },
    t => { t.templateId = ''; },
    t => { t.rules[0].type = 'max_total_bytes'; t.rules[0].roleId = {}; t.rules[0].params = { maxBytes: 5000000, displayUnit: 'MB' }; },
  ]) {
    const template = createDraft().template;
    mutate(template);
    assert.equal(validateTemplate(template, 'draft').valid, false);
  }
  const template = createDraft().template;
  template.roles = []; template.rules = []; template.manualChecks = [];
  assert.equal(validateTemplate(template, 'draft').valid, true);
});

test('comparison reports additions, deletions, and raw source changes without interpreting source', () => {
  const next = example();
  next.source.text += '\n수정';
  next.manualChecks = [];
  next.roles.push({ id: 'extra', label: '추가 문서' });
  const changes = compareTemplates(exampleTemplate, next);
  assert.ok(changes.includes('원문이 변경됨'));
  assert.ok(changes.some(change => change.includes('직접 확인 삭제')));
  assert.ok(changes.some(change => change.includes('역할 추가')));
  assert.deepEqual(compareTemplates(exampleTemplate, exampleTemplate), ['조건과 원문에 변경이 없습니다.']);
});

test('validation reports failures without mutating candidate objects', () => {
  const template = example(); template.rules[0].params.min = -1;
  const before = JSON.stringify(template);
  validateTemplate(template);
  assert.equal(JSON.stringify(template), before);
});

test('sparse arrays cannot export into invalid null entries', () => {
  const template = example(); delete template.roles[1];
  assert.equal(validateTemplate(template).valid, false);
});
