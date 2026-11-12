import {el,button,badge,field,notice,showDialog,download} from './render.js';
import {renderEditor} from './editor.js';
import {exampleTemplate} from '../data/example-template.js';
import {createDraft,serializeTemplate,parseTemplateJSON,classifyImport,compareTemplates,importAsCopy,canonicalStringify} from './templates.js';
import {createStore,STORAGE_KEY} from './storage.js';
import {createSession,invalidateInspection,applyTemplate,beginRun,finishRun,setManual} from './state.js';
import {evaluateInspection,getManualItems,summarizeInspection} from './rules.js';
import {addFiles,replaceFile,removeFile,assignRole,toDescriptors} from './files.js';
import {formatBytes,getFileExtension,uid} from './utils.js';

const app=document.querySelector('#app');
const announcer=document.querySelector('#announcer');
const store=createStore();
let loaded=store.load(), data=loaded.data, raw=loaded.raw, storageError=loaded.error;
let saveError=null, page='library', session=null, editRecord=null, editorRaw=null, importCandidate=null, importRaw=null;
let editorDirty=false;
let toastTimer;
const clone=value=>structuredClone(value);
const statusText={pass:'통과',fail:'수정 필요',not_checked:'미검사',not_applicable:'해당 없음'};
const statusColor={pass:'green',fail:'red',not_checked:'amber',not_applicable:''};
const pageNames={library:'검사 기준',confirm:'기준 확인',files:'파일 준비',results:'검사 결과',editor:'기준 작성',import:'기준 가져오기',help:'사용 안내'};
const dateText=iso=>new Date(iso).toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'});

function toast(text) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const node=el('div',{class:'toast',role:'status'},text);document.body.append(node);
  announcer.textContent=text;
  toastTimer=setTimeout(()=>node.remove(),5500);
}
function error(message) { saveError=message;const node=document.querySelector('#save-notice');if(node)node.replaceChildren(notice(message,'error'));toast(message); }
function persist(next,expected=raw) {
  const saved=store.save(next,expected);
  if(!saved.ok){error(saved.error);return false;}
  data=next;raw=saved.raw;storageError=null;saveError=null;return true;
}
function reloadStore() {
  loaded=store.load();data=loaded.data;raw=loaded.raw;storageError=loaded.error;saveError=null;render();
}
function leaveEditor(action) {
  showDialog('작성 중인 초안을 남길까요?',el('p',{},'저장하지 않은 내용은 현재 탭에만 남습니다. 새 초안을 시작하거나 새로고침하기 전에는 저장해 주세요.'),[
    {text:'초안 저장 후 이동',action:close=>{if(saveDraft(editRecord)){close();editorDirty=false;action();}}},
    {text:'저장 없이 이동',kind:'subtle',action:close=>{close();editorDirty=false;action();}}
  ]);
}
function navigate(target,force=false) {
  if(page==='editor'&&target!=='editor'&&editorDirty&&!force){leaveEditor(()=>navigate(target,true));return;}
  page=target;saveError=null;render(true);
}
function chooseTemplate(t) {
  if(session) applyTemplate(session,t);else session=createSession(t);
  navigate('confirm');
}
function newEditor(base=null) {
  if(page==='editor'&&editorDirty){leaveEditor(()=>newEditor(base));return;}
  editorDirty=false;
  editRecord=createDraft(base);editorRaw=raw;navigate('editor');
}
function copyEditor(t) {
  const fresh=createDraft();const id=fresh.template.templateId,now=fresh.template.createdAt;
  fresh.template={...clone(t),templateId:id,revision:1,status:'draft',createdAt:now,updatedAt:now};
  editRecord=fresh;editorRaw=raw;editorDirty=false;navigate('editor');
}
function recoveryNotice() {
  if(!storageError)return null;
  return notice(el('div',{},el('strong',{},'저장 데이터를 확인해 주세요.'),el('p',{},storageError),el('div',{class:'actions'},
    raw!==null?button('손상 원문 보관',()=>download(raw,'machimpyo-storage-recovery.txt','text/plain'),'compact'):null,
    button('다시 읽기',reloadStore,'compact'),button('마침표 데이터 초기화',resetStorage,'compact danger'))),'warning');
}
function resetStorage() {
  showDialog('마침표 데이터를 초기화할까요?',el('p',{},'이 브라우저에 저장된 마침표 기준과 초안을 지웁니다. 필요한 기준과 손상 원문을 먼저 보관하세요. 다른 앱의 저장 키는 유지합니다.'),[
    {text:'마침표 데이터 초기화',kind:'danger',action:close=>{const result=store.reset();if(!result.ok){error(result.error);return;}close();reloadStore();toast('마침표 저장 데이터를 초기화했어요.');}}
  ]);
}
function shell(main) {
  const active=['confirm','files','results'].includes(page)?'library':page;
  const nav=(text,target,symbol)=>el('button',{type:'button',class:`nav-item ${active===target?'active':''}`,onclick:()=>navigate(target),'aria-current':active===target?'page':null},el('span',{class:'nav-symbol','aria-hidden':'true'},symbol),text);
  return el('div',{class:'shell'},
    el('aside',{class:'sidebar'},el('a',{class:'brand',href:'#',onclick:e=>{e.preventDefault();navigate('library');}},el('span',{class:'brand-mark','aria-hidden':'true'},'.'),'마침표'),
      el('div',{class:'nav-label'},'WORKSPACE'),el('nav',{'aria-label':'주 메뉴'},nav('검사 기준','library','▤'),el('button',{class:`nav-item ${page==='editor'?'active':''}`,type:'button',onclick:()=>{if(page!=='editor')newEditor();}},el('span',{class:'nav-symbol','aria-hidden':'true'},'＋'),'새 기준 만들기'),nav('사용 안내','help','ⓘ')),
      el('div',{class:'sidebar-bottom'},el('small',{},el('span',{class:'privacy-dot'}),'내 브라우저에서 검사'),el('p',{},'파일은 내 기기에 그대로.','',el('br'),'제출 전, 마지막 확인을 함께해요.'))),
    el('header',{class:'topbar'},el('div',{class:'crumb'},'내 작업 공간',el('span',{},'　/　'),el('strong',{},pageNames[page])),el('div',{class:'local-badge'},el('span',{class:'privacy-dot'}),'LOCAL WORKSPACE')),
    el('main',{id:'main',class:'main',tabindex:'-1'},recoveryNotice(),el('div',{id:'save-notice'},saveError?notice(saveError,'error'):null),main,
      el('footer',{class:'footer'},el('span',{},'파일을 수정했다면 다시 선택한 뒤 검사해 주세요.'),el('span',{},'MACHIMPYO · v1.0'))));
}
function head(eyebrow,title,description,actions=null) {return el('div',{class:'page-head'},el('div',{},el('div',{class:'eyebrow'},eyebrow),el('h1',{},title),el('p',{},description)),actions);}
function render(focus=false) {
  try{
    const content={library:renderLibrary,confirm:renderConfirm,files:renderFiles,results:renderResults,editor:renderBuilder,import:renderImport,help:renderHelp}[page]();
    app.replaceChildren(shell(content));
    if(focus){document.querySelector('#main').focus({preventScroll:true});window.scrollTo({top:0});}
  }catch(err){console.error(err);app.replaceChildren(shell(el('div',{},head('WORKSPACE','화면을 표시하지 못했어요','현재 탭을 유지한 채 다시 시도해 주세요.'),notice(err.message,'error'),button('기준 목록으로',()=>navigate('library'),'primary'))));}
}
function renderLibrary() {
  const cards=data.templates.map(t=>templateCard(t));
  return el('div',{},
    head('SUBMISSION CHECK','제출 전, 마지막 확인.','파일 이름부터 빠진 문서까지, 정해진 기준으로 꼼꼼하게.',el('div',{class:'actions'},button('↥ 기준 가져오기',selectImport),button('＋ 새 기준 만들기',()=>newEditor(),'primary'))),
    el('section',{class:'welcome'},el('div',{},badge('처음이라면, 가상 예시로 시작해 보세요','blue'),el('h2',{},'준비한 파일에',el('br'),'놓친 부분은 없을까요?'),el('p',{},'탐구 보고서와 동의서 기준을 살펴보고,',el('br'),'직접 선택한 파일로 검사 흐름을 경험해 보세요.'),button('예시 기준으로 시작　→',()=>chooseTemplate(exampleTemplate),'primary')),
      el('div',{class:'welcome-art','aria-hidden':'true'},el('div',{class:'paper-art'},el('div',{class:'line short'}),el('div',{class:'line'}),el('div',{class:'line'}),el('div',{class:'line short'}),el('div',{class:'check'},'✓')))),
    el('section',{},el('div',{class:'library-head'},el('h2',{},'내 검사 기준',el('span',{class:'library-count'},data.templates.length)),badge('이 브라우저에 저장')),
      cards.length?el('div',{class:'template-grid'},cards):el('div',{class:'empty'},el('h3',{},'아직 저장한 검사 기준이 없어요'),el('p',{},'새 기준을 만들거나 공유받은 JSON 파일을 가져오세요.'))),
    data.drafts.length?el('section',{class:'card'},el('div',{class:'card-head'},el('h2',{},'작성 중인 초안'),badge(`${data.drafts.length}개`)),...data.drafts.map(d=>el('div',{class:'rule-summary'},el('strong',{},d.template.title||'제목 없는 초안'),el('p',{},`예정 버전 v${d.template.revision} · ${dateText(d.template.updatedAt)}`),el('div',{class:'actions'},button('이어서 작성',()=>{editRecord=clone(d);editorRaw=raw;navigate('editor');},'compact'),button('삭제',()=>deleteDraft(d),'subtle compact danger'))))):null,
    session?notice(el('div',{},`현재 탭에 “${session.templateSnapshot.title}” 검사 작업이 남아 있어요.`,el('div',{class:'actions'},button('진행 중인 검사로 돌아가기',()=>navigate(session.templateAcknowledged?(session.latestRun?'results':'files'):'confirm'),'compact')))):null,
    el('div',{class:'info-strip'},el('div',{},el('strong',{},'01　기준을 고르고'),el('p',{},'공지에서 정리한 조건과 근거를 확인해요.')),el('div',{},el('strong',{},'02　파일을 준비하고'),el('p',{},'파일을 선택하고 문서 역할을 지정해요.')),el('div',{},el('strong',{},'03　결과를 확인하세요'),el('p',{},'수정한 파일을 다시 선택해 재검사해요.'))));
}
function templateCard(t) {
  const previous=data.previous.find(p=>p.templateId===t.templateId);
  return el('article',{class:'card template-card'},el('div',{class:'card-head'},el('div',{class:'template-icon','aria-hidden':'true'},'▤'),badge(`v${t.revision} · 확정`,'blue')),el('h3',{},t.title),el('p',{},t.description||'저장된 검사 기준'),el('div',{class:'template-meta'},el('span',{},`역할 ${t.roles.length}개`),el('span',{},'·'),el('span',{},`자동 규칙 ${t.rules.length}개`),el('span',{},`직접 확인 ${t.manualChecks.length}개`)),el('small',{class:'muted'},`수정 ${dateText(t.updatedAt)}`),
    el('div',{class:'template-footer'},button('검사하기　→',()=>chooseTemplate(t),'primary compact'),el('div',{class:'actions'},button('편집',()=>newEditor(t),'compact'),button('내보내기',()=>exportTemplate(t),'compact'),button('삭제',()=>deleteTemplate(t),'subtle compact danger'))),
    previous?el('details',{class:'source small'},el('summary',{},`이전 v${previous.revision}과 비교`),el('ul',{class:'diff-list'},...compareTemplates(previous,t).map(s=>el('li',{},s)))):null);
}
function deleteTemplate(t) {
  showDialog('검사 기준을 삭제할까요?',el('p',{},`“${t.title}”의 확정본, 이전 버전, 연결된 초안을 이 브라우저에서 삭제합니다. 현재 검사 세션은 유지합니다.`),[{text:'삭제',kind:'danger',action:close=>{const next=clone(data);next.templates=next.templates.filter(v=>v.templateId!==t.templateId);next.previous=next.previous.filter(v=>v.templateId!==t.templateId);next.drafts=next.drafts.filter(d=>d.baseTemplateId!==t.templateId);if(persist(next)){close();render();toast('기준을 삭제했어요.');}}}]);
}
function deleteDraft(d) {showDialog('초안을 삭제할까요?',el('p',{},d.template.title||'제목 없는 초안'),[{text:'초안 삭제',kind:'danger',action:close=>{const next=clone(data);next.drafts=next.drafts.filter(v=>v.draftId!==d.draftId);if(persist(next)){close();render();}}}]);}
function steps(current) { return el('nav',{class:'steps','aria-label':'검사 단계'},...['기준 확인','파일 준비','결과 확인'].map((name,i)=>el('span',{class:`step ${i===current?'active':''}`,'aria-current':i===current?'step':null},el('b',{},i+1),name))); }
function ruleDescription(rule) {
  const p=rule.params;
  if(rule.type==='role_count')return `${p.min}~${p.max}개`;
  if(rule.type==='allowed_extensions')return p.allowed.map(v=>`.${v}`).join(', ');
  if(rule.type==='max_file_bytes'||rule.type==='max_total_bytes')return `${(p.maxBytes/(p.displayUnit==='MiB'?1048576:1000000)).toLocaleString('ko-KR',{maximumFractionDigits:6})} ${p.displayUnit} 이하 · ${p.maxBytes.toLocaleString('ko-KR')}바이트`;
  return p.pattern;
}
function sourceView(t) {
  const safeURL=t.source.url && /^https?:\/\//i.test(t.source.url);
  return el('details',{class:'source'},el('summary',{},'공지 원문과 출처 보기'),el('h4',{},t.source.title),el('pre',{},t.source.text||'원문 내용 없음'),safeURL?el('a',{href:t.source.url,target:'_blank',rel:'noopener noreferrer'},'원문 주소 열기 ↗'):null,el('p',{class:'small muted'},`작성자가 원문을 확인한 시각: ${dateText(t.source.checkedAt)}`));
}
function templateDetail(t,compact=false) {
  return el('section',{class:`card ${compact?'aside-card':''}`},el('div',{class:'card-head'},el('h2',{},compact?'검사 기준 요약':t.title),badge(`v${t.revision}`,'blue')),compact?el('p',{class:'small muted'},t.title):el('p',{class:'small muted'},t.description),
    t.templateId===exampleTemplate.templateId?notice('실제 학교 공지가 아닌 가상 예시입니다.'):null,
    ...t.roles.map(role=>el('div',{class:'rule-summary'},el('strong',{},role.label),...t.rules.filter(r=>r.roleId===role.id).map(r=>el('p',{},`${r.label}: ${ruleDescription(r)}`)))),
    ...t.rules.filter(r=>r.roleId===null).map(r=>el('div',{class:'rule-summary'},el('strong',{},r.label),el('p',{},ruleDescription(r)))),
    t.manualChecks.length?el('div',{class:'rule-summary'},el('strong',{},`직접 확인 ${t.manualChecks.length}개`),...t.manualChecks.map(m=>el('p',{},m.question))):null,
    sourceView(t));
}
function renderConfirm() {
  if(!session)return renderLibrary();
  const t=session.templateSnapshot;
  return el('div',{},head('CHECK YOUR CRITERIA','어떤 기준으로 검사할까요?','조건과 원문을 읽고, 사용할 기준을 확인해 주세요.'),steps(0),
    templateDetail(t),el('section',{class:'card'},el('h2',{},'각 조건의 근거'),...t.rules.map(r=>el('div',{class:'rule-summary'},el('strong',{},r.label),el('p',{},`${r.evidence.kind==='source_quote'?'원문 발췌':'작성자 추가 기준'}: ${r.evidence.text}`))),
      notice('확장자·파일명·개수·용량을 비교합니다. 본문 내용과 서명은 자동으로 검사하지 않습니다.')),
    el('div',{class:'action-bar'},button('목록으로',()=>navigate('library'),'subtle'),el('div',{class:'actions'},button('복사해서 새 기준 만들기',()=>copyEditor(t)),button('이 기준으로 검사하기　→',()=>{session.templateAcknowledged=true;navigate('files');},'primary'))));
}
function newVersionNotice() {
  const t=session.templateSnapshot;
  const newer=data.templates.find(v=>v.templateId===t.templateId&&v.revision>t.revision);
  if(!newer)return null;
  return notice(el('div',{},`현재는 v${t.revision} 기준입니다. 저장된 새 기준 v${newer.revision}이 있어요.`,el('ul',{class:'diff-list'},...compareTemplates(t,newer).map(s=>el('li',{},s))),el('div',{class:'actions'},button(`v${newer.revision} 확인하고 적용`,()=>chooseTemplate(newer),'compact'))),'warning');
}
function sessionNotice() {
  return el('div',{id:'session-notice'},session.runState==='stale'?notice('내용이 바뀌었어요. 이전 결과는 현재 입력의 결과가 아닙니다. 다시 검사해 주세요.','warning'):null);
}
function studentChanged(key,value,input) {
  if(session.student[key]===value)return;
  session.student[key]=value;invalidateInspection(session);
  const n=document.querySelector('#session-notice');if(n&&session.runState==='stale')n.replaceChildren(notice('내용이 바뀌었어요. 다시 검사해 주세요.','warning'));
  const action=document.querySelector('#inspect-button');if(action)action.textContent=session.latestRun?'다시 검사　→':'파일 검사　→';
}
function studentField(key,label,max) {
  const wrap=field(label,session.student[key],(v,input)=>studentChanged(key,v,input),{type:'text',maxlength:max,autocomplete:'off',placeholder:key==='studentId'?'예: 03107':'예: 홍길동',help:key==='studentId'?'앞자리 0도 그대로 사용합니다.':'파일명 형식에 사용합니다.'});
  wrap.input.addEventListener('blur',()=>{const v=wrap.input.value.trim().normalize('NFC');studentChanged(key,v,wrap.input);wrap.input.value=v;});
  return wrap;
}
function openFiles(replacementId=null) {
  const picker=el('input',{type:'file',multiple:!replacementId,class:'sr-only','aria-label':replacementId?'교체할 파일 선택':'제출할 파일 선택'});
  document.body.append(picker);
  picker.addEventListener('change',()=>{
    try{
      if(replacementId&&picker.files[0])replaceFile(session,replacementId,picker.files[0]);
      else{const result=addFiles(session,Array.from(picker.files));if(result.error)toast(result.error);}
      render();
    }catch(err){toast(err.message);}
    picker.remove();
  },{once:true});
  picker.addEventListener('cancel',()=>picker.remove(),{once:true});picker.click();
}
function filesPanel() {
  const files=session.files;
  const drop=el('div',{class:'drop-zone'},el('div',{class:'drop-icon','aria-hidden':'true'},'↥'),el('h3',{},'검사할 파일을 여기에 놓으세요'),el('p',{},'파일 내용은 업로드하지 않아요 · 최대 30개 · 폴더 선택 제외'),button('파일 선택',()=>openFiles()));
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop',e=>{
    e.preventDefault();drop.classList.remove('dragover');
    if(Array.from(e.dataTransfer.items??[]).some(item=>item.webkitGetAsEntry?.()?.isDirectory)){toast('폴더는 지원하지 않아요. 폴더 안의 파일을 선택해 주세요.');return;}
    const result=addFiles(session,Array.from(e.dataTransfer.files));render();if(result.error)toast(result.error);
  });
  const names=files.map(x=>x.file.name);
  const duplicate=names.some((name,i)=>names.indexOf(name)!==i);
  const list=files.map(entry=>{
    const f=entry.file;
    return el('div',{class:'file-row'},el('div',{class:'file-icon','aria-hidden':'true'},(getFileExtension(f.name)||'FILE').slice(0,5).toUpperCase()),el('div',{},el('div',{class:'file-name'},f.name),el('small',{class:'muted'},`${formatBytes(f.size)} · ${f.size.toLocaleString('ko-KR')}바이트`),el('div',{class:'file-tools'},el('button',{type:'button',class:'text-btn',onclick:()=>openFiles(entry.selectionId),'aria-label':`${f.name} 교체`},'교체'),el('button',{type:'button',class:'text-btn',onclick:()=>{removeFile(session,entry.selectionId);render();},'aria-label':`${f.name} 제거`},'제거'))),
      field('문서 역할',entry.roleId??'',v=>{assignRole(session,entry.selectionId,v||null);render();},{kind:'select',items:[{value:'',label:'역할을 선택하세요'},...session.templateSnapshot.roles.map(r=>({value:r.id,label:r.label}))],'aria-label':`${f.name} 문서 역할`}));
  });
  return el('section',{class:'card'},el('div',{class:'card-head'},el('h2',{},'제출 파일'),badge(`${files.length} / 30개`)),el('p',{class:'small muted'},'어떤 문서인지 역할을 직접 지정해 주세요. 원본 파일은 바뀌지 않습니다.'),drop,
    duplicate?notice('이름이 같은 파일이 있어요. 선택 항목을 확인해 주세요. 내용이 같은지는 검사하지 않습니다.','warning'):null,
    el('div',{class:'file-list'},list),el('div',{class:'file-total'},el('span',{},`선택한 파일 ${files.length}개`),el('span',{},`합계 ${files.reduce((sum,x)=>sum+x.file.size,0).toLocaleString('ko-KR')}바이트`)));
}
function renderFiles() {
  if(!session?.templateAcknowledged)return renderConfirm();
  const patterns=session.templateSnapshot.rules.filter(r=>r.type==='filename_template').map(r=>r.params.pattern).join('');
  return el('div',{},head('PREPARE YOUR FILES','파일을 준비해 주세요.','파일을 선택하고, 각각의 문서 역할을 지정하세요.'),steps(1),newVersionNotice(),sessionNotice(),
    el('div',{class:'two-col'},el('div',{class:'stack'},patterns.includes('{name}')||patterns.includes('{studentId}')?el('section',{class:'card'},el('h2',{},'파일명에 사용할 정보'),el('p',{class:'small muted'},'입력한 정보는 이 탭에서만 사용하며 저장하거나 내보내지 않습니다.'),el('div',{class:'student-info'},patterns.includes('{studentId}')?studentField('studentId','학번',30):null,patterns.includes('{name}')?studentField('name','이름',50):null)):null,filesPanel(),
      el('div',{class:'action-bar'},button('기준 다시 보기',()=>navigate('confirm'),'subtle'),button(session.latestRun?'다시 검사　→':'파일 검사　→',runInspection,'primary',{id:'inspect-button'})),el('p',{class:'small muted'},'파일명·확장자·개수·용량만 자동으로 비교합니다. 서명과 본문은 직접 확인해 주세요.')),
      templateDetail(session.templateSnapshot,true)));
}
async function runInspection() {
  try{
    const snapshot=beginRun(session);
    navigate('results');
    await new Promise(resolve=>setTimeout(resolve,20));
    let results;
    try {results=evaluateInspection(snapshot.template,snapshot.files,snapshot.student);}
    catch(err){results=[{resultId:uid('error'),origin:'system',ruleId:null,roleId:null,selectionId:null,status:'not_checked',code:'SYS_ERROR',label:'검사 실행',message:err.message,expected:null,actual:null,nextAction:'입력을 확인하고 다시 검사해 주세요.',evidence:null}];}
    if(finishRun(session,snapshot,results)){if(page==='results')render();toast('자동 검사가 끝났어요. 결과와 직접 확인 항목을 살펴보세요.');}
  }catch(err){toast(err.message);}
}
function resultRow(r) {
  const entry=session.latestRun?.evaluatedFiles?.find(f=>f.selectionId===r.selectionId);
  return el('article',{class:'result-row'},el('div',{class:'result-title'},badge(statusText[r.status],statusColor[r.status]),el('h4',{},r.label)),
    entry?el('p',{class:'file-name'},entry.name):null,el('p',{},r.message),
    r.expected!==null||r.actual!==null?el('dl',{class:'result-values'},r.expected!==null?[el('dt',{},'요구 값'),el('dd',{},r.expected)]:null,r.actual!==null?[el('dt',{},'실제 값'),el('dd',{},r.actual)]:null):null,
    r.nextAction?el('p',{},`다음 행동: ${r.nextAction}`):null,
    r.code==='filename_template'&&r.expected&&r.status==='fail'?button('예상 파일명 복사',async()=>{try{await navigator.clipboard.writeText(r.expected);toast('예상 파일명을 복사했어요.');}catch{toast('복사하지 못했어요. 위 요구 값 텍스트를 선택해 복사해 주세요.');}},'compact'):null,
    r.evidence?el('details',{},el('summary',{},r.evidence.kind==='source_quote'?'원문 근거 보기':'작성자 추가 기준 보기'),el('p',{},r.evidence.text)):el('small',{class:'muted'},'마침표 기본 점검'));
}
function manualPanel(items) {
  const stale=session.runState!=='current';
  return el('section',{class:'card'},el('div',{class:'card-head'},el('h2',{},'직접 확인'),badge('사용자 확인','amber')),el('p',{class:'small muted'},'체크는 사용자가 직접 확인했다는 표시입니다. 자동 검사 통과와 구분합니다.'),
    items.length?items.map(item=>{
      const id=`manual-${item.id}`;
      return el('div',{class:'manual-row'},el('input',{id,type:'checkbox',checked:item.status==='confirmed',disabled:stale||item.disabled||item.status==='not_applicable',onchange:e=>{setManual(session,item.id,e.target.checked);render();}}),el('div',{},el('label',{for:id},item.question),el('small',{},item.files.length?`대상 파일 전체: ${item.files.map(f=>f.name).join(', ')}`:'연결된 파일이 없습니다.'),el('small',{},`${item.evidence.kind==='source_quote'?'원문 발췌':'작성자 추가 기준'}: ${item.evidence.text}`),badge(item.status==='confirmed'?'사용자 확인':item.status==='not_applicable'?'해당 없음':item.disabled?'파일을 먼저 준비하세요':'직접 확인 필요',item.status==='confirmed'?'green':item.status==='not_applicable'?'':'amber')));
    }):el('p',{class:'small muted'},'등록된 직접 확인 항목이 없습니다.'));
}
function renderResults() {
  if(!session?.templateAcknowledged)return renderConfirm();
  const results=session.latestRun?.results??[];
  const items=getManualItems(session.templateSnapshot,toDescriptors(session.files),session.manualAcknowledgements,session.inputRevision);
  const summary=summarizeInspection(results,items,session.runState);
  const stateClass=session.runState==='stale'?'stale':results.some(r=>r.status==='fail')?'fail':session.runState==='current'&&!results.some(r=>r.status==='not_checked')&&!items.some(i=>i.status==='pending')?'pass':'';
  const metric=(counts)=>el('div',{class:'metrics'},...['pass','fail','not_checked','not_applicable'].map(s=>el('div',{class:`metric ${s}`},el('strong',{},counts[s]??0),el('span',{},statusText[s]))));
  return el('div',{},head('INSPECTION RESULTS','검사 결과를 확인하세요.','수정이 필요한 부분을 살펴보고, 파일을 다시 선택해 재검사하세요.'),steps(2),newVersionNotice(),
    el('div',{class:`result-banner ${stateClass}`,role:'status'},el('h2',{},summary.title),el('p',{},`${session.latestRun?.templateTitle??session.templateSnapshot.title} · ${session.latestRun?`결과 적용 v${session.latestRun.templateRevision}`:`선택 기준 v${session.templateSnapshot.revision}`}`),session.runState==='stale'?el('p',{},`아래 결과는 변경 전 기록입니다. 현재 선택 기준은 v${session.templateSnapshot.revision}이며 다시 검사해야 합니다.`):null),
    el('div',{class:'two-col'},el('div',{class:'stack'},
      el('section',{class:`card ${session.runState==='stale'?'result-muted':''}`},el('div',{class:'card-head'},el('h2',{},'자동 검사'),badge('기준 규칙의 파일별 결과')),metric(summary.templateCounts),...['fail','not_checked','pass','not_applicable'].map(s=>{
        const rows=results.filter(r=>r.origin==='template'&&r.status===s);return rows.length?el('div',{},el('h3',{},`${statusText[s]} · ${rows.length}건`),rows.map(resultRow)):null;
      }),!results.length?el('p',{class:'small muted'},session.runState==='running'?'선택한 파일 정보를 기준과 비교하고 있어요.':'아직 검사 결과가 없습니다.'):null),
      el('section',{class:'card'},el('h2',{},'마침표 기본 점검'),el('p',{class:'small muted'},'공지 규칙과 별도로 파일 선택, 빈 파일, 역할 지정을 확인합니다.'),el('details',{class:session.runState==='stale'?'result-muted':'',open:results.some(r=>r.origin==='system'&&r.status!=='pass')},el('summary',{class:'source'},`기본 점검 ${results.filter(r=>r.origin==='system').length}건 보기`),results.filter(r=>r.origin==='system').sort((a,b)=>(a.status==='fail'?-1:1)-(b.status==='fail'?-1:1)).map(resultRow))),
      manualPanel(items),notice('이 결과는 등록된 형식 기준을 확인한 범위입니다. 문서 내용, 실제 제출처의 최신 공지, 최종 업로드 여부는 직접 확인해 주세요.'),
      el('div',{class:'action-bar'},button('← 파일 준비로 돌아가기',()=>navigate('files')),button('다시 검사',runInspection,'primary',{disabled:session.runState==='running'})),
      session.latestRun?el('p',{class:'small muted'},`검사 시각: ${dateText(session.latestRun.evaluatedAt)} · 실제 적용 버전 v${session.latestRun.templateRevision}`):null),templateDetail(session.templateSnapshot,true)));
}
function renderBuilder() {
  if(!editRecord){editRecord=createDraft();editorRaw=raw;}
  return el('div',{},head('BUILD YOUR CRITERIA','검사 기준 만들기','공지의 조건을 한 번 정리하고, 필요한 사람과 다시 사용하세요.'),
    saveError?button('최신 목록을 읽고 사본 초안으로 저장',saveDraftCopy,'compact'):null,
    renderEditor(editRecord,{onSaveDraft:saveDraft,onFinalize:saveFinal,onDirty:()=>{editorDirty=true;},onCancel:()=>navigate('library')}));
}
function checkBase(record) {
  if(!record.baseSnapshot)return true;
  const current=data.templates.find(t=>t.templateId===record.baseTemplateId);
  if(!current||canonicalStringify(current)!==canonicalStringify(record.baseSnapshot)){error('기반 확정본이 바뀌거나 삭제됐어요. 현재 내용을 새 ID의 사본 초안으로 저장해 주세요.');return false;}return true;
}
function saveDraft(record) {
  if(!checkBase(record)){showCopyOption();return false;}
  const next=clone(data);next.drafts=next.drafts.filter(d=>d.draftId!==record.draftId);next.drafts.push(clone(record));
  if(!persist(next,editorRaw)){showCopyOption();return false;}
  editorRaw=raw;editorDirty=false;toast('초안을 이 브라우저에 저장했어요.');return true;
}
function showCopyOption() {
  const node=document.querySelector('#save-notice');if(node&&!node.querySelector('button'))node.append(button('최신 목록을 읽고 사본 초안으로 저장',saveDraftCopy,'compact'));
}
function saveDraftCopy() {
  const latest=store.load();if(latest.error){error(latest.error);return;}
  const fresh=createDraft();const id=fresh.template.templateId;
  fresh.template={...clone(editRecord.template),templateId:id,revision:1,status:'draft',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const next=clone(latest.data);next.drafts.push(fresh);
  if(persist(next,latest.raw)){editRecord=fresh;editorRaw=raw;editorDirty=false;render();toast('최신 저장본을 보존하고 사본 초안을 저장했어요.');}
}
function saveFinal(record,finalized) {
  if(!checkBase(record)){showCopyOption();return false;}
  const next=clone(data);const prior=next.templates.find(t=>t.templateId===finalized.templateId);
  if(prior&&finalized.revision>prior.revision){next.previous=next.previous.filter(t=>t.templateId!==prior.templateId);next.previous.push(prior);}
  next.templates=next.templates.filter(t=>t.templateId!==finalized.templateId);next.templates.push(finalized);
  next.drafts=next.drafts.filter(d=>d.draftId!==record.draftId);
  if(!persist(next,editorRaw)){showCopyOption();return false;}
  editorRaw=raw;editorDirty=false;navigate('library',true);toast(prior&&prior.revision===finalized.revision?'변경 내용이 없어 기존 버전을 유지했어요.':'검사 기준을 확정하고 저장했어요.');return true;
}
function exportTemplate(t) {
  try{
    const serialized=serializeTemplate(t);
    showDialog('공유할 기준을 확인하세요',el('div',{},el('p',{},`“${t.title}” · v${t.revision}`),notice('기준의 원문과 조건만 내보냅니다. 원문에 개인 정보가 있다면 공유 전에 확인하세요. 선택 파일, 검사 결과, 현재 입력한 이름·학번은 포함하지 않습니다.'),el('details',{},el('summary',{class:'source'},'내보낼 JSON 전체 보기'),el('pre',{class:'json-preview'},serialized))),[
      {text:'JSON 파일 저장',action:close=>{download(serialized,`${t.templateId}-v${t.revision}.json`);close();toast('기준 JSON을 내보냈어요.');}}
    ]);
  }catch(err){toast(err.message);}
}
function selectImport() {
  const picker=el('input',{type:'file',accept:'.json,application/json',class:'sr-only','aria-label':'검사 기준 JSON 선택'});document.body.append(picker);
  picker.addEventListener('change',async()=>{
    const file=picker.files[0];picker.remove();if(!file)return;
    if(file.size>262144){toast('기준 JSON 파일은 256KiB 이하여야 해요. 파일을 읽거나 적용하지 않았습니다.');return;}
    try{importCandidate=parseTemplateJSON(await file.text());importRaw=raw;navigate('import');}
    catch(err){showDialog('검사 기준을 가져오지 못했어요',el('div',{},el('p',{},'기존 기준과 검사 세션은 유지했습니다.'),el('pre',{class:'json-preview'},err.message)),[]);}
  },{once:true});picker.addEventListener('cancel',()=>picker.remove(),{once:true});picker.click();
}
function renderImport() {
  if(!importCandidate)return renderLibrary();
  const t=importCandidate;const existing=data.templates.find(v=>v.templateId===t.templateId);const decision=classifyImport(existing,t);
  return el('div',{},head('IMPORT CRITERIA','가져올 기준을 확인하세요.','규칙과 원문을 검토한 뒤 저장할 방식을 선택하세요.'),notice(decision.message,decision.kind==='conflict'||decision.kind==='older'?'warning':''),
    notice(`가져온 원본 ID: ${t.templateId} · v${t.revision}. 발행자 인증이나 출처 보증을 제공하지 않습니다.`),templateDetail(t),
    existing?el('section',{class:'card'},el('h2',{},'현재 기준과 달라진 내용'),el('ul',{class:'diff-list'},...compareTemplates(existing,t).map(s=>el('li',{},s)))):null,
    el('section',{class:'card'},el('h2',{},'조건별 근거'),...t.rules.map(r=>el('div',{class:'rule-summary'},el('strong',{},r.label),el('p',{},r.evidence.text)))),
    el('div',{class:'action-bar'},button('취소',()=>navigate('library'),'subtle'),el('div',{class:'actions'},decision.kind==='identical'?button('기존 기준으로 검사',()=>chooseTemplate(existing),'primary'):null,
      existing&&decision.kind!=='identical'?button('새 ID의 사본으로 가져오기',()=>commitImport(true)):null,
      decision.allowReplace?button(decision.kind==='new'?'가져오기 확정':`v${t.revision}으로 갱신`,()=>commitImport(false),'primary'):null)));
}
function commitImport(asCopy) {
  try{
    const incoming=asCopy?importAsCopy(importCandidate):clone(importCandidate);
    const next=clone(data);const existing=next.templates.find(t=>t.templateId===incoming.templateId);
    if(existing&&classifyImport(existing,incoming).kind!=='newer'){error('기준 충돌 상태가 바뀌었어요. 가져올 내용을 다시 확인해 주세요.');return;}
    if(existing){next.previous=next.previous.filter(t=>t.templateId!==existing.templateId);next.previous.push(existing);}
    next.templates=next.templates.filter(t=>t.templateId!==incoming.templateId);next.templates.push(incoming);
    if(!persist(next,importRaw))return;
    importCandidate=null;navigate('library');toast('검사 기준을 저장했어요. 목록에서 검사하기를 선택하세요.');
  }catch(err){error(err.message);}
}
function renderHelp() {
  return el('div',{},head('A LITTLE HELP','마침표 사용 안내','파일을 제출하기 전에, 한 단계씩 확인해 보세요.'),
    el('section',{class:'card'},el('h2',{},'파일을 검사하려면'),el('ol',{class:'help-list'},el('li',{},'검사 기준 목록에서 예시 또는 저장된 기준을 선택하세요.'),el('li',{},'조건과 공지 원문을 읽고 “이 기준으로 검사하기”를 누르세요.'),el('li',{},'필요한 학번·이름을 입력하고 파일을 선택하세요.'),el('li',{},'각 파일에 보고서·동의서 등의 역할을 지정하고 “파일 검사”를 누르세요.'),el('li',{},'요구 값과 실제 값을 비교하고, 파일을 수정했다면 다시 선택하세요.'),el('li',{},'재검사 후 서명·내용 등 직접 확인 항목을 체크하세요.'),el('li',{},'실제 제출은 원래 제출처에서 직접 진행하세요.'))),
    el('section',{class:'card'},el('h2',{},'나만의 기준을 만들고 공유하려면'),el('p',{class:'small muted'},'“새 기준 만들기”에서 제목, 원문, 문서 역할, 개수·확장자·용량·파일명 조건을 적으세요. 각 조건에 원문 발췌 또는 작성자 추가 근거를 남긴 뒤 확정하세요. 미완성 내용은 초안으로 저장할 수 있습니다.'),el('p',{class:'small muted'},'확정 기준의 “내보내기”로 JSON을 저장합니다. 다른 브라우저에서는 “기준 가져오기”로 같은 파일을 선택하고 미리보기 후 저장하세요. 확정본을 수정하면 새 버전으로 보관되며, 검사 세션에 적용하기 전까지 이전 기준의 결과가 유지됩니다.')),
    el('section',{class:'card'},el('h2',{},'어디까지 확인하나요?'),el('p',{class:'small muted'},'이름, 확장자, 개수, 정확한 바이트 용량만 검사합니다. 파일이 실제 PDF인지, 문서가 손상됐는지, 서명이 있는지, 내용이 올바른지는 자동으로 확인하지 않습니다.'),el('p',{class:'small muted'},'통과 · 수정 필요 · 미검사 · 해당 없음은 서로 다른 판정입니다. 입력을 바꾸면 이전 결과가 무효화되고 직접 확인 표시도 초기화됩니다.'),el('p',{class:'small muted'},'같은 파일명으로 다시 선택해도 별도 항목으로 추가됩니다. 같은 이름 안내는 내용 중복 검사가 아닙니다. 외부에서 파일을 수정해도 앱은 자동으로 감지하지 않습니다.')),
    el('section',{class:'card'},el('h2',{},'저장과 새로고침'),el('p',{class:'small muted'},'확정 기준과 초안은 현재 브라우저에 저장합니다. 다른 브라우저·다른 주소에서는 별도의 저장소를 사용합니다. 중요한 기준은 JSON으로도 보관하세요. 파일, 이름·학번, 결과, 직접 확인 표시는 새로고침하면 초기화됩니다. 파일을 다시 선택해 주세요.'),el('p',{class:'small muted'},'기준은 한 탭에서 편집하는 것을 권장합니다. 다른 탭의 변경을 감지하면 현재 초안을 보존하고 사본 저장을 안내합니다. 브라우저 정책으로 저장이 차단되면 저장 실패 안내를 확인하세요.'),el('div',{class:'actions'},button('저장 목록 다시 읽기',reloadStore),button('마침표 데이터 초기화',resetStorage,'danger'))));
}
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY&&event.key!==null)return;
  const latest=store.load();data=latest.data;raw=latest.raw;storageError=latest.error;
  if(page==='editor'){const n=document.querySelector('#save-notice');n?.replaceChildren(notice('다른 탭에서 기준이 바뀌었어요. 현재 초안은 유지했습니다. 저장 시 충돌을 확인합니다.','warning'));}
  else render();
});
render();
