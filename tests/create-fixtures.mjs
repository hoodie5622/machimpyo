import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exampleTemplate } from '../data/example-template.js';
import { serializeTemplate } from '../js/templates.js';

const fixtureDirectory = new URL('./fixtures/', import.meta.url);
await mkdir(fixtureDirectory, { recursive: true });
const smallFakeFile = Buffer.alloc(100, '.');
smallFakeFile.write('MACHIMPYO QA: FAKE CONTENT. NOT A REAL PDF.\n');

const version2 = structuredClone(exampleTemplate);
version2.revision = 2;
version2.updatedAt = '2026-11-13T00:00:00Z';
const consentLimit = version2.rules.find(rule => rule.type === 'max_file_bytes' && rule.roleId === 'consent');
consentLimit.params.maxBytes = 50;
consentLimit.evidence = { kind: 'author_note', text: '가상 재검사 테스트: 동의서 제한을 50바이트로 변경했습니다.' };
const conflict = structuredClone(exampleTemplate);
conflict.title = '탐구 보고서 제출 — 같은 버전 충돌 테스트';

const files = new Map([
  ['03107_홍길동_탐구보고서.pdf', smallFakeFile],
  ['동의서.pdf', smallFakeFile],
  ['아주_긴_한글_파일명으로_줄바꿈과_좁은_화면에서_버튼을_확인하는_가상_탐구보고서_최종본.pdf', smallFakeFile],
  ['잘못된_보고서.pdf', Buffer.alloc(5_000_001, 0)],
  ['example-template.json', serializeTemplate(exampleTemplate)],
  ['version2.json', serializeTemplate(version2)],
  ['same-revision-conflict.json', serializeTemplate(conflict)],
  ['invalid-template.json', '{ "documentType": "machimpyo-template",\n'],
  ['README.md', `# 가상 브라우저 검사 자료\n\n이 폴더의 PDF 확장자 파일은 **실제 PDF 문서가 아닙니다**. 파일명·개수·바이트 용량을 검사하기 위한 가짜 내용입니다. 문서 열기, 손상 탐지, 본문·서명 확인을 검증하는 자료로 사용하지 마세요.\n\n- \`03107_홍길동_탐구보고서.pdf\`: 100바이트. 보고서 역할, 학번 \`03107\`, 이름 \`홍길동\`으로 검사합니다.\n- \`동의서.pdf\`: 100바이트. 동의서 역할로 지정합니다.\n- \`잘못된_보고서.pdf\`: 5,000,001바이트. 예시의 5MB 제한을 정확히 1바이트 초과하며 파일명도 맞지 않습니다.\n- \`example-template.json\`: 명세의 가상 예시 기준 v1. 두 작은 파일은 자동 규칙을 통과하고 수동 서명 확인은 별도로 남습니다.\n- \`version2.json\`: 같은 기준 ID의 v2. 동의서 개별 제한을 50바이트로 바꿨으므로 100바이트 동의서는 용량 검사에 실패합니다. v2를 저장한 뒤 v1을 가져오면 오래된 버전 처리도 확인할 수 있습니다.\n- \`same-revision-conflict.json\`: v1과 ID·버전은 같고 제목이 다릅니다. v1이 저장된 상태에서 같은 버전 충돌을 확인합니다.\n- \`invalid-template.json\`: 문법이 깨진 JSON. 가져오기 실패 시 기존 기준과 세션이 보존되는지 확인합니다.\n\n다시 만들기: 프로젝트 폴더에서 \`node tests/create-fixtures.mjs\`. 이 명령은 이 폴더의 위 파일들을 가상 데이터로 덮어씁니다.\n`]
]);

for (const [name, content] of files) {
  const output = new URL(name, fixtureDirectory);
  await writeFile(output, content);
  console.log(`${fileURLToPath(output)} (${Buffer.byteLength(content)} bytes)`);
}
