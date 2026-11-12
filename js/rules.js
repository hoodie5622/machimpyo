import { buildExpectedFilename, getFileExtension, invalidFilenameCharacters } from './utils.js';

const emptyCounts = () => ({ pass: 0, fail: 0, not_checked: 0, not_applicable: 0 });
const countStatuses = (results) => {
  const counts = emptyCounts();
  for (const result of results) if (Object.hasOwn(counts, result.status)) counts[result.status] += 1;
  return counts;
};

function result(origin, rule, file, values) {
  return {
    resultId: `${origin}:${rule?.id || values.code}:${file?.selectionId || 'group'}`,
    origin,
    ruleId: rule?.id ?? null,
    roleId: rule?.roleId ?? file?.roleId ?? null,
    selectionId: file?.selectionId ?? null,
    status: 'not_checked', code: rule?.type || '', label: rule?.label || '',
    message: '', expected: null, actual: null, nextAction: null,
    evidence: rule?.evidence ?? null,
    ...values,
  };
}

function systemResults(template, files) {
  const roles = new Set(template.roles.map((role) => role.id));
  const results = [result('system', null, null, {
    code: 'SYS_NO_FILES', label: '선택 파일',
    status: files.length ? 'pass' : 'fail',
    message: files.length ? '검사할 파일을 선택했어요.' : '제출할 파일을 선택해 주세요.',
    expected: '파일 1개 이상', actual: `${files.length}개`,
    nextAction: files.length ? null : '제출할 파일을 선택해 주세요.',
  })];
  for (const file of files) {
    const assigned = typeof file.roleId === 'string' && roles.has(file.roleId);
    results.push(result('system', null, file, {
      code: 'SYS_UNASSIGNED', label: '파일 역할', status: assigned ? 'pass' : 'fail',
      message: assigned ? '문서 역할이 지정되어 있어요.' : '이 파일이 어떤 문서인지 선택해 주세요.',
      expected: '등록된 문서 역할', actual: assigned ? template.roles.find((role) => role.id === file.roleId).label : '역할 미지정',
      nextAction: assigned ? null : '파일 목록에서 문서 역할을 지정해 주세요.',
    }));
    const validSize = Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0;
    results.push(result('system', null, file, {
      code: 'SYS_EMPTY_FILE', label: '빈 파일 점검', status: !validSize ? 'not_checked' : file.sizeBytes > 0 ? 'pass' : 'fail',
      message: !validSize ? '파일 크기 정보를 확인할 수 없어요.' : file.sizeBytes > 0 ? '0바이트 파일이 아니에요.' : '파일이 0바이트예요.',
      expected: '0바이트보다 큼', actual: `${file.sizeBytes}바이트`,
      nextAction: !validSize || file.sizeBytes === 0 ? '파일을 직접 열어 확인한 뒤 다시 선택해 주세요.' : null,
    }));
    const name = file.name;
    const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
    const validName = typeof name === 'string' && name.length > 0 && name.trim().length > 0 && name !== '.' && name !== '..'
      && dot !== 0 && dot !== name.length - 1 && !invalidFilenameCharacters.test(name);
    results.push(result('system', null, file, {
      code: 'SYS_INVALID_FILENAME', label: '기본 파일명', status: validName ? 'pass' : 'fail',
      message: validName ? '본문 이름이 있는 파일명이에요.' : '파일명에 본문 이름이 없거나 사용할 수 없는 문자가 있어요.',
      expected: '본문 이름이 있는 파일명', actual: typeof name === 'string' ? name : '(파일명 없음)',
      nextAction: validName ? null : '올바른 이름으로 저장한 파일을 다시 선택해 주세요.',
    }));
  }
  return results;
}

function compareFilename(actual, expected) {
  const normalize = (name) => {
    const nfc = name.normalize('NFC');
    const dot = nfc.lastIndexOf('.');
    return dot > 0 ? `${nfc.slice(0, dot)}.${nfc.slice(dot + 1).toLowerCase()}` : nfc;
  };
  return normalize(actual) === normalize(expected);
}

function byteResult(rule, file, size) {
  if (!Number.isSafeInteger(size) || size < 0) return result('template', rule, file, {
    status: 'not_checked', message: '정확한 파일 용량을 확인할 수 없어요.',
    nextAction: '파일을 다시 선택한 뒤 검사해 주세요.',
  });
  const pass = size <= rule.params.maxBytes;
  return result('template', rule, file, {
    status: pass ? 'pass' : 'fail', expected: `${rule.params.maxBytes.toLocaleString('ko-KR')}바이트 이하 (${rule.params.displayUnit})`,
    actual: `${size.toLocaleString('ko-KR')}바이트`,
    message: pass ? '용량 제한 이내예요.' : `${(size - rule.params.maxBytes).toLocaleString('ko-KR')}바이트 초과했어요.`,
    nextAction: pass ? null : '용량을 줄인 파일을 다시 선택하고 검사해 주세요.',
  });
}

function fileResult(rule, file, student) {
  if (rule.type === 'max_file_bytes') return byteResult(rule, file, file.sizeBytes);
  if (rule.type === 'allowed_extensions') {
    const extension = getFileExtension(file.name);
    const pass = rule.params.allowed.includes(extension);
    return result('template', rule, file, {
      status: pass ? 'pass' : 'fail', expected: rule.params.allowed.map((item) => `.${item}`).join(', '),
      actual: extension ? `.${extension}` : '확장자 없음',
      message: pass ? '허용 확장자와 일치해요.' : '허용 확장자와 일치하지 않아요.',
      nextAction: pass ? null : '요구한 형식으로 저장한 파일을 다시 선택해 주세요. 확장자만 바꾸면 내용 형식이 변환되지 않아요.',
    });
  }
  if (rule.type === 'filename_template') {
    const expected = buildExpectedFilename(rule.params.pattern, student);
    if (!expected.filename) return result('template', rule, file, {
      status: 'not_checked', expected: rule.params.pattern, actual: file.name,
      message: expected.error || `${expected.missing.join('·')} 입력이 없어 예상 파일명을 만들 수 없어요.`,
      nextAction: '이름·학번 입력을 확인한 뒤 다시 검사해 주세요.',
    });
    const pass = compareFilename(file.name, expected.filename);
    return result('template', rule, file, {
      status: pass ? 'pass' : 'fail', expected: expected.filename, actual: file.name,
      message: pass ? '지정된 파일명과 일치해요.' : '파일명이 지정된 형식과 달라요. 본문 대소문자·공백·밑줄도 비교해요.',
      nextAction: pass ? null : '예상 이름으로 저장한 파일을 다시 선택해 주세요.',
    });
  }
  return result('template', rule, file, { status: 'not_checked', message: '지원하지 않는 규칙이라 검사하지 못했어요.', nextAction: '검사 기준을 확인해 주세요.' });
}

/** Pure metadata evaluation. No file body reads, DOM, storage, or network. */
export function evaluateInspection(template, files = [], student = {}) {
  const results = systemResults(template, files);
  for (const rule of template.rules) {
    try {
      if (rule.type === 'max_total_bytes') {
        const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
        results.push(byteResult(rule, null, total));
        continue;
      }
      const matching = files.filter((file) => file.roleId === rule.roleId);
      if (rule.type === 'role_count') {
        const { min, max } = rule.params;
        const pass = matching.length >= min && matching.length <= max;
        results.push(result('template', rule, null, {
          status: pass ? 'pass' : 'fail', expected: `${min}~${max}개`, actual: `${matching.length}개`,
          message: pass ? '필요한 파일 수와 일치해요.' : matching.length < min ? '필요한 파일이 부족해요.' : '선택한 파일이 최대 개수를 넘었어요.',
          nextAction: pass ? null : matching.length < min ? '빠진 파일을 선택하고 역할을 지정해 주세요.' : '선택한 파일을 확인해 필요한 파일만 남겨 주세요.',
        }));
        continue;
      }
      if (!matching.length) {
        const count = template.rules.find((candidate) => candidate.type === 'role_count' && candidate.roleId === rule.roleId);
        const optional = count?.params.min === 0;
        results.push(result('template', rule, null, {
          status: optional ? 'not_applicable' : 'not_checked',
          message: optional ? '선택 역할의 파일이 없어 적용 대상이 아니에요.' : '검사할 파일이 없어요.',
          expected: null, actual: '0개', nextAction: optional ? null : '파일을 추가하고 해당 문서 역할을 지정해 주세요.',
        }));
      } else {
        for (const file of matching) {
          try { results.push(fileResult(rule, file, student)); }
          catch { results.push(result('template', rule, file, { status: 'not_checked', message: '이 파일의 규칙 처리 중 오류가 발생했어요.', nextAction: '기준과 파일을 확인하고 다시 검사해 주세요.' })); }
        }
      }
    } catch {
      results.push(result('template', rule, null, { status: 'not_checked', message: '규칙 처리 중 오류가 발생했어요.', nextAction: '검사 기준을 확인해 주세요.' }));
    }
  }
  return results;
}

export function getManualItems(template, files, acknowledgements = {}, inputRevision = 0) {
  return template.manualChecks.map((check) => {
    const targets = check.roleId === null ? files : files.filter((file) => file.roleId === check.roleId);
    const count = template.rules.find((rule) => rule.type === 'role_count' && rule.roleId === check.roleId);
    const notApplicable = check.roleId !== null && !targets.length && count?.params.min === 0;
    const acknowledgement = acknowledgements instanceof Map ? acknowledgements.get(check.id) : Object.hasOwn(acknowledgements, check.id) ? acknowledgements[check.id] : null;
    const confirmed = targets.length > 0 && acknowledgement?.inputRevision === inputRevision && acknowledgement.status === 'confirmed';
    return {
      ...check, files: targets,
      status: notApplicable ? 'not_applicable' : confirmed ? 'confirmed' : 'pending',
      disabled: !targets.length,
    };
  });
}

export function summarizeInspection(results = [], manualItems = [], runState = 'not_run') {
  const counts = countStatuses(results);
  const systemCounts = countStatuses(results.filter((item) => item.origin === 'system'));
  const templateCounts = countStatuses(results.filter((item) => item.origin === 'template'));
  const manual = { confirmed: 0, pending: 0, not_applicable: 0 };
  for (const item of manualItems) if (Object.hasOwn(manual, item.status)) manual[item.status] += 1;
  let title;
  if (runState === 'not_run') title = '아직 검사하지 않았어요';
  else if (runState === 'running') title = '검사 중';
  else if (runState === 'stale') title = '다시 검사 필요';
  else if (counts.fail) title = '수정할 항목이 있어요';
  else if (counts.not_checked || !results.length) title = '검사하지 못한 항목이 있어요';
  else if (manual.pending) title = '직접 확인할 항목이 남아 있어요';
  else title = '등록된 검사 기준을 확인했어요';
  return { title, counts, systemCounts, templateCounts, manual };
}
