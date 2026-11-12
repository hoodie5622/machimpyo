let idCounter = 0;

export function uid(prefix = 'id') {
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${unique}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '알 수 없는 용량';
  if (bytes < 1000) return `${bytes.toLocaleString('ko-KR')} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(2)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function getFileExtension(name) {
  if (typeof name !== 'string') return '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export const invalidFilenameCharacters = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/u;

export function buildExpectedFilename(pattern, student = {}) {
  const missing = [];
  if (typeof pattern !== 'string' || !pattern) return { filename: null, missing, error: '파일명 형식을 확인해 주세요.' };
  const remainder = pattern.replaceAll('{studentId}', '').replaceAll('{name}', '');
  if (/[{}]/u.test(remainder) || invalidFilenameCharacters.test(remainder)) {
    return { filename: null, missing, error: '지원하지 않는 자리표시자 또는 파일명 문자가 있어요.' };
  }
  const values = {};
  for (const [key, label, limit] of [['studentId', '학번', 30], ['name', '이름', 50]]) {
    if (!pattern.includes(`{${key}}`)) continue;
    const value = typeof student[key] === 'string' ? student[key].trim().normalize('NFC') : '';
    if (!value) { missing.push(label); continue; }
    if ([...value].length > limit || invalidFilenameCharacters.test(value)) {
      return { filename: null, missing, error: `${label}은 ${limit}자 이내이며 파일명에 사용할 수 있는 문자여야 해요.` };
    }
    values[key] = value;
  }
  if (missing.length) return { filename: null, missing, error: null };
  return {
    filename: pattern.replace(/\{(studentId|name)\}/gu, (_, key) => values[key]).normalize('NFC'),
    missing,
    error: null,
  };
}

/** Parse decimal hundredths using integer arithmetic, including MiB fractions. */
export function parseSizeInput(value, unit) {
  if (unit !== 'MB' && unit !== 'MiB') throw new Error('용량 단위는 MB 또는 MiB로 선택해 주세요.');
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) throw new Error('용량은 양수이며 소수점 둘째 자리까지 입력해 주세요.');
  const [whole, fraction = ''] = text.split('.');
  // Bound input before BigInt conversion to avoid unnecessary work on huge strings.
  if (whole.length > 15) throw new Error('용량은 앱 한도인 1TB 이하여야 해요.');
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const bytes = hundredths * (unit === 'MB' ? 1_000_000n : 1_048_576n) / 100n;
  if (bytes <= 0n || bytes > 1_000_000_000_000n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('용량은 0보다 크고 앱 한도인 1TB 이하여야 해요.');
  }
  return Number(bytes);
}
