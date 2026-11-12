import { uid } from './utils.js';
import { invalidateInspection } from './state.js';

export function addFiles(session, fileList) {
  const files = Array.from(fileList || []);
  if (session.files.length + files.length > 30) return { added: 0, error: '앱에서 선택할 수 있는 파일은 최대 30개예요. 기존 파일은 유지했어요.' };
  if (!files.length) return { added: 0, error: null };
  if (files.some((file) => !file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0)) {
    return { added: 0, error: '파일 정보를 읽을 수 없어요. 파일 선택 버튼으로 다시 선택해 주세요.' };
  }
  session.files.push(...files.map((file) => ({ selectionId: uid('file'), file, roleId: null })));
  invalidateInspection(session);
  return { added: files.length, error: null };
}

export function replaceFile(session, selectionId, file) {
  const index = session.files.findIndex((entry) => entry.selectionId === selectionId);
  if (index < 0 || !file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0) return false;
  const roleId = session.files[index].roleId;
  session.files[index] = { selectionId: uid('file'), file, roleId };
  invalidateInspection(session);
  return true;
}

export function removeFile(session, selectionId) {
  const index = session.files.findIndex((entry) => entry.selectionId === selectionId);
  if (index < 0) return false;
  session.files.splice(index, 1);
  invalidateInspection(session);
  return true;
}

export function assignRole(session, selectionId, roleId) {
  if (roleId !== null && !session.templateSnapshot.roles.some((role) => role.id === roleId)) return false;
  const file = session.files.find((entry) => entry.selectionId === selectionId);
  if (!file || file.roleId === roleId) return false;
  file.roleId = roleId;
  invalidateInspection(session);
  return true;
}

export function toDescriptors(files) {
  return files.map(({ selectionId, file, roleId }) => ({
    selectionId, roleId, name: file.name, sizeBytes: file.size,
    lastModified: file.lastModified, mimeType: file.type || '',
  }));
}
