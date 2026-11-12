let fieldId = 0;
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'open') node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export const button = (text, action, kind = '', attrs = {}) => el('button', {type: 'button', class: `btn ${kind}`, onclick: action, ...attrs}, text);
export const badge = (text, color = '') => el('span', {class: `tag ${color}`}, text);
export function field(label, value, change, options = {}) {
  const id = `field-${++fieldId}`;
  const {kind = 'input', items, help, path, ...attrs} = options;
  const input = el(kind, {id, ...attrs});
  if (items) for (const item of items) input.append(el('option', {value: item.value, selected: item.value === value}, item.label));
  else input.value = value ?? '';
  if (kind === 'select') input.value = value ?? '';
  if (change) input.addEventListener(kind === 'select' ? 'change' : 'input', () => change(input.value, input));
  if (path) input.dataset.path = path;
  const helper = help ? el('small', {id: `${id}-help`}, help) : null;
  if (help) input.setAttribute('aria-describedby', `${id}-help`);
  const wrap = el('div', {class: 'field'}, el('label', {for: id}, label), input, helper);
  return Object.assign(wrap, {input});
}
export function notice(text, kind = '') { return el('div', {class: `notice ${kind}`}, text); }
export function showDialog(title, content, actions) {
  const dialog = el('dialog', {class: 'dialog', 'aria-labelledby': 'dialog-title'}, el('h2', {id: 'dialog-title'}, title), content);
  const close = () => {dialog.close(); dialog.remove();};
  dialog.append(el('div', {class: 'actions'}, button('닫기', close), ...actions.map(a => button(a.text, () => a.action(close), a.kind || 'primary'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal();
  return dialog;
}
export function download(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = el('a', {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
