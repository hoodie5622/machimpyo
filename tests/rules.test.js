import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInspection, getManualItems, summarizeInspection } from '../js/rules.js';
import { buildExpectedFilename, getFileExtension, parseSizeInput } from '../js/utils.js';

const evidence = { kind: 'author_note', text: '자동 테스트용 가상 기준' };
const rule = (id, type, roleId, params) => ({ id, type, roleId, params, label: id, evidence });
const template = {
  templateId: 'test', revision: 1, status: 'ready',
  roles: [{ id: 'report', label: '보고서' }, { id: 'consent', label: '동의서' }],
  rules: [
    rule('report_count', 'role_count', 'report', { min: 1, max: 1 }),
    rule('consent_count', 'role_count', 'consent', { min: 1, max: 1 }),
    rule('report_extension', 'allowed_extensions', 'report', { allowed: ['pdf'] }),
    rule('consent_extension', 'allowed_extensions', 'consent', { allowed: ['pdf'] }),
    rule('report_size', 'max_file_bytes', 'report', { maxBytes: 5_000_000, displayUnit: 'MB' }),
    rule('consent_size', 'max_file_bytes', 'consent', { maxBytes: 5_000_000, displayUnit: 'MB' }),
    rule('report_name', 'filename_template', 'report', { pattern: '{studentId}_{name}_탐구보고서.pdf' }),
  ],
  manualChecks: [{ id: 'signature', roleId: 'consent', question: '서명을 직접 확인했나요?', evidence }],
};
const student = { studentId: '3107', name: '홍길동' };
const originalFiles = [
  { selectionId: 'f1', roleId: 'report', name: '3107_홍길동_탐구보고서.pdf', sizeBytes: 1_000_000, lastModified: 1, mimeType: '' },
  { selectionId: 'f2', roleId: 'consent', name: '동의서.pdf', sizeBytes: 100_000, lastModified: 1, mimeType: '' },
];
const execute = (files = structuredClone(originalFiles), t = template, s = student) => evaluateInspection(t, files, s);
const findRule = (results, id) => results.find((item) => item.ruleId === id);
const findCode = (results, code) => results.find((item) => item.code === code);

test('T01: example has seven automatic template passes, manual confirmation remains pending', () => {
  const results = execute();
  assert.equal(results.filter((item) => item.origin === 'template').length, 7);
  assert.ok(results.every((item) => item.status === 'pass'));
  assert.equal(new Set(results.map((item) => item.resultId)).size, results.length);
  const manual = getManualItems(template, originalFiles, {}, 0);
  assert.equal(manual[0].status, 'pending');
  const summary = summarizeInspection(results, manual, 'current');
  assert.equal(summary.templateCounts.pass, 7);
  assert.equal(summary.manual.pending, 1);
  assert.match(summary.title, /직접 확인/);
});

test('T02/T03: missing required role is failed count and explicit unchecked file rules', () => {
  const one = execute([originalFiles[0]]);
  assert.equal(findRule(one, 'consent_count').status, 'fail');
  assert.equal(findRule(one, 'consent_extension').status, 'not_checked');
  assert.equal(findRule(one, 'consent_size').status, 'not_checked');
  assert.equal(findCode(execute([]), 'SYS_NO_FILES').status, 'fail');
});

test('T04/T05/T07: extra, unassigned, and zero-byte files count independently', () => {
  const files = structuredClone(originalFiles);
  files.push({ ...files[0], selectionId: 'extra' });
  let results = execute(files);
  assert.equal(findRule(results, 'report_count').status, 'fail');
  assert.equal(results.filter((item) => item.ruleId === 'report_extension').length, 2);
  files[0].roleId = null;
  results = execute(files);
  assert.equal(findCode(results, 'SYS_UNASSIGNED').status, 'fail');
  files.splice(2, 1); files[0].roleId = 'report'; files[0].sizeBytes = 0;
  results = execute(files);
  assert.equal(findRule(results, 'report_count').status, 'pass');
  assert.equal(findCode(results, 'SYS_EMPTY_FILE').status, 'fail');
});

for (const [size, expected] of [[5_000_000, 'pass'], [5_000_001, 'fail']]) {
  test(`T08/T09: exact 5MB boundary at ${size}`, () => {
    const files = structuredClone(originalFiles); files[0].sizeBytes = size;
    const check = findRule(execute(files), 'report_size');
    assert.equal(check.status, expected);
    assert.equal(check.actual, `${size.toLocaleString('ko-KR')}바이트`);
    if (expected === 'fail') assert.match(check.message, /1바이트/);
  });
}

test('T10/T11: MiB boundary and independent total include unassigned and duplicate-named files', () => {
  const t = structuredClone(template);
  t.rules.find((item) => item.id === 'report_size').params = { maxBytes: 5_242_880, displayUnit: 'MiB' };
  const files = structuredClone(originalFiles); files[0].sizeBytes = 5_242_880;
  assert.equal(findRule(execute(files, t), 'report_size').status, 'pass');
  files[0].sizeBytes += 1;
  assert.equal(findRule(execute(files, t), 'report_size').status, 'fail');
  t.rules.push(rule('total', 'max_total_bytes', null, { maxBytes: 5_000_000, displayUnit: 'MB' }));
  files[0].sizeBytes = 3_000_000; files[1].sizeBytes = 3_000_000;
  let results = execute(files, t);
  assert.equal(findRule(results, 'report_size').status, 'pass');
  assert.equal(findRule(results, 'consent_size').status, 'pass');
  assert.equal(findRule(results, 'total').status, 'fail');
  files[1].roleId = null; files[1].name = files[0].name;
  results = execute(files, t);
  assert.equal(findRule(results, 'total').actual, '6,000,000바이트');
});

for (const [name, extensionStatus, basicStatus] of [
  ['report.PDF', 'pass', 'pass'], ['report.final.pdf', 'pass', 'pass'],
  ['report.pdf.exe', 'fail', 'pass'], ['report', 'fail', 'pass'],
  ['.pdf', 'fail', 'fail'], ['report.', 'fail', 'fail'], ['', 'fail', 'fail'],
]) {
  test(`T12-T15: last extension and basename for ${JSON.stringify(name)}`, () => {
    const files = structuredClone(originalFiles); files[0].name = name;
    const results = execute(files);
    assert.equal(findRule(results, 'report_extension').status, extensionStatus);
    assert.equal(findCode(results, 'SYS_INVALID_FILENAME').status, basicStatus);
  });
}

test('T16/T17/T18: NFC, leading zeros, exact basename spacing and case, extension-only case folding', () => {
  const files = structuredClone(originalFiles);
  files[0].name = files[0].name.normalize('NFD');
  assert.equal(findRule(execute(files), 'report_name').status, 'pass');
  files[0].name = '03107_홍길동_탐구보고서.PDF';
  assert.equal(findRule(execute(files, template, { ...student, studentId: '03107' }), 'report_name').status, 'pass');
  for (const bad of [' 3107_홍길동_탐구보고서.pdf', '3107_홍 길동_탐구보고서.pdf', '3107_홍길동__탐구보고서.pdf']) {
    files[0].name = bad;
    const check = findRule(execute(files), 'report_name');
    assert.equal(check.status, 'fail');
    assert.equal(check.expected, '3107_홍길동_탐구보고서.pdf');
    assert.equal(check.actual, bad);
  }
});

test('T19: missing or invalid student input is unchecked without affecting other rules', () => {
  for (const bad of [{ studentId: '', name: '홍길동' }, { studentId: '3107', name: '홍/길동' }, { studentId: '1'.repeat(31), name: '홍길동' }]) {
    const results = execute(undefined, template, bad);
    assert.equal(findRule(results, 'report_name').status, 'not_checked');
    assert.equal(findRule(results, 'report_extension').status, 'pass');
  }
  assert.equal(buildExpectedFilename('{name}.pdf', { name: ' 홍길동 ' }).filename, '홍길동.pdf');
});

test('T20/T21: MIME hints do not determine extension results or imply content verification', () => {
  const files = structuredClone(originalFiles);
  files[0].mimeType = 'application/x-bogus';
  assert.equal(findRule(execute(files), 'report_extension').status, 'pass');
  files[0].mimeType = '';
  const results = execute(files);
  assert.equal(findRule(results, 'report_extension').status, 'pass');
  assert.doesNotMatch(JSON.stringify(results), /정상 PDF|내용 검증 완료|서명 확인 완료|제출 성공/);
});

test('T22: absent optional role and manual item are inapplicable, not pass or pending', () => {
  const t = structuredClone(template); t.rules.find((item) => item.id === 'consent_count').params.min = 0;
  const files = [originalFiles[0]];
  const results = execute(files, t);
  assert.equal(findRule(results, 'consent_count').status, 'pass');
  assert.equal(findRule(results, 'consent_extension').status, 'not_applicable');
  const manual = getManualItems(t, files, {}, 0);
  assert.equal(manual[0].status, 'not_applicable');
  assert.equal(manual[0].disabled, true);
  assert.equal(summarizeInspection(results, manual, 'current').manual.pending, 0);
});

test('manual scope covers every file in role; global checks need at least one file', () => {
  const files = [...originalFiles, { ...originalFiles[1], selectionId: 'third' }];
  const items = getManualItems(template, files, { signature: { inputRevision: 3, status: 'confirmed' } }, 3);
  assert.equal(items[0].files.length, 2);
  assert.equal(items[0].status, 'confirmed');
  assert.equal(getManualItems(template, files, { signature: { inputRevision: 2, status: 'confirmed' } }, 3)[0].status, 'pending');
  assert.equal(getManualItems(template, [originalFiles[0]], {}, 0)[0].disabled, true);
  const t = structuredClone(template); t.manualChecks[0].roleId = null;
  assert.equal(getManualItems(t, [], {}, 0)[0].status, 'pending');
  assert.equal(getManualItems(t, [], {}, 0)[0].disabled, true);
  assert.equal(getManualItems(t, files, {}, 0)[0].files.length, 3);
});

test('summary priority follows run state, failure, unchecked, manual, then completed registration', () => {
  const results = execute();
  assert.match(summarizeInspection(results, [], 'not_run').title, /아직/);
  assert.equal(summarizeInspection(results, [], 'running').title, '검사 중');
  assert.equal(summarizeInspection(results, [], 'stale').title, '다시 검사 필요');
  assert.match(summarizeInspection([{ status: 'fail' }, { status: 'not_checked' }], [], 'current').title, /수정/);
  assert.match(summarizeInspection([{ status: 'not_checked' }], [], 'current').title, /검사하지 못한/);
  assert.match(summarizeInspection(results, [], 'current').title, /등록된/);
  assert.match(summarizeInspection([], [], 'current').title, /검사하지 못한/);
});

test('T51: decimal size conversion avoids binary rounding and floors only fractional bytes', () => {
  assert.equal(parseSizeInput('4.10', 'MB'), 4_100_000);
  assert.equal(parseSizeInput('5', 'MiB'), 5_242_880);
  assert.equal(parseSizeInput('0.01', 'MiB'), 10_485);
  for (const bad of ['0', '-1', '1.001', 'NaN', 'Infinity', '1e3', '', '99999999999999999999']) assert.throws(() => parseSizeInput(bad, 'MB'));
  assert.throws(() => parseSizeInput('1', 'GB'));
  assert.equal(getFileExtension('x.PDF'), 'pdf');
});

test('rule exceptions become explicit unchecked results, never vanish', () => {
  const t = structuredClone(template); t.rules[2].params = null;
  assert.equal(findRule(execute(undefined, t), 'report_extension').status, 'not_checked');
});
