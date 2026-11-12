import {el, button, field, badge, notice} from './render.js';
import {uid, parseSizeInput, buildExpectedFilename} from './utils.js';
import {validateTemplate, finalizeDraft} from './templates.js';

const TYPES = [{value:'role_count',label:'파일 개수'},{value:'allowed_extensions',label:'허용 확장자'},{value:'max_file_bytes',label:'개별 파일 용량'},{value:'filename_template',label:'파일명 형식'},{value:'max_total_bytes',label:'전체 합계 용량'}];
const paramsFor = type => ({role_count:{min:1,max:1},allowed_extensions:{allowed:['pdf']},max_file_bytes:{maxBytes:5000000,displayUnit:'MB'},filename_template:{pattern:'{studentId}_{name}_보고서.pdf'},max_total_bytes:{maxBytes:10000000,displayUnit:'MB'}}[type]);
const isoLocal = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };

export function renderEditor(record, {onSaveDraft, onFinalize, onCancel, onDirty=()=>{}}) {
  const t = record.template;
  const numericErrors = new Map();
  const numericText = new Map();
  const sizeText = new Map();
  const root = el('div', {class:'editor-form'});
  const errors = el('div');
  const content = el('div');
  let dirty = false;
  function update(fn) { dirty = true; onDirty(); fn(); }
  function section(num,title,...children) { return el('section',{class:'card'},el('h2',{},el('span',{class:'section-num'},num),title),...children); }
  function evidence(item,path) {
    return el('div',{class:'evidence-editor'},
      field('이 조건의 근거',item.evidence.kind,v=>update(()=>{item.evidence.kind=v;}),{kind:'select',path:`${path}.evidence.kind`,items:[{value:'author_note',label:'작성자 추가 기준'},{value:'source_quote',label:'원문에서 발췌'}]}),
      field('근거 문장',item.evidence.text,v=>update(()=>{item.evidence.text=v;}),{kind:'textarea',rows:2,path:`${path}.evidence.text`,help:'원문 발췌는 위 원문에 실제 포함된 문장을 그대로 입력하세요. 작성자 추가 기준은 추가한 이유를 적어 주세요.'}));
  }
  function roles() { return [{value:'',label:'역할 선택'},...t.roles.map(r=>({value:r.id,label:r.label||'이름 없는 역할'}))]; }
  function numeric(label,value,set,path,min=0,max=30) {
    const index=Number(/rules\[(\d+)\]/.exec(path)?.[1]);
    const key=`${t.rules[index]?.id}:${path.split('.').at(-1)}`;
    const check=(v,input)=>{numericText.set(key,v);if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))){numericErrors.set(key,{path,message:'정수를 입력해 주세요.'});input?.setAttribute('aria-invalid','true');}else{numericErrors.delete(key);input?.removeAttribute('aria-invalid');set(Number(v));}};
    const raw=numericText.get(key)??String(value);
    const wrapped=field(label,raw,(v,input)=>update(()=>check(v,input)),{type:'number',min,max,step:1,path});
    check(raw,wrapped.input);return wrapped;
  }
  function size(rule,path) {
    const multiplier = rule.params.displayUnit==='MiB'?1048576:1000000;
    const raw = sizeText.get(rule.id) ?? (rule.params.maxBytes/multiplier).toFixed(2);
    const exact = el('small',{class:'muted'},`확정 값: ${rule.params.maxBytes.toLocaleString('ko-KR')}바이트`);
    const value = field('용량 제한',raw,v=>update(()=>{
      sizeText.set(rule.id,v);
      try{rule.params.maxBytes=parseSizeInput(v,rule.params.displayUnit);numericErrors.delete(rule.id);exact.textContent=`확정 값: ${rule.params.maxBytes.toLocaleString('ko-KR')}바이트`;}
      catch(error){numericErrors.set(rule.id,{path:`${path}.params.maxBytes`,message:error.message});exact.textContent=error.message;}
    }),{type:'text',inputmode:'decimal',path:`${path}.params.maxBytes`});
    const unit=field('단위',rule.params.displayUnit,v=>update(()=>{
      rule.params.displayUnit=v;
      try{rule.params.maxBytes=parseSizeInput(sizeText.get(rule.id)??raw,v);numericErrors.delete(rule.id);exact.textContent=`확정 값: ${rule.params.maxBytes.toLocaleString('ko-KR')}바이트`;}
      catch(error){numericErrors.set(rule.id,{path:`${path}.params.maxBytes`,message:error.message});exact.textContent=error.message;}
    }),{kind:'select',path:`${path}.params.displayUnit`,items:[{value:'MB',label:'MB · 1,000,000바이트'},{value:'MiB',label:'MiB · 1,048,576바이트'}]});
    if(sizeText.has(rule.id)){try{parseSizeInput(raw,rule.params.displayUnit);}catch(error){numericErrors.set(rule.id,{path:`${path}.params.maxBytes`,message:error.message});exact.textContent=error.message;}}
    return el('div',{},el('div',{class:'field-row'},value,unit),exact,el('p',{class:'small muted'},'소수점 둘째 자리까지 입력할 수 있습니다. MiB 환산에서 바이트 미만은 버립니다.'));
  }
  function paint() {
    numericErrors.clear();
    content.replaceChildren(
      section('01','기본 정보',
        field('검사 기준 제목',t.title,v=>update(()=>{t.title=v;}),{path:'title',placeholder:'예: 2학기 탐구 보고서 제출'}),
        field('설명 · 선택',t.description,v=>update(()=>{t.description=v;}),{kind:'textarea',rows:2,path:'description',placeholder:'이 기준의 용도나 주의사항을 적어 주세요.'})),
      section('02','원문과 출처',
        el('p',{class:'small muted'},'공지 내용을 보관하고 조건마다 근거를 연결하세요. 붙여 넣은 문장은 자동으로 해석하지 않습니다.'),
        field('원문 제목',t.source.title,v=>update(()=>{t.source.title=v;}),{path:'source.title',placeholder:'예: 탐구 보고서 제출 안내'}),
        field('공지 원문',t.source.text,v=>update(()=>{t.source.text=v;}),{kind:'textarea',rows:6,path:'source.text'}),
        field('원문 주소 · 선택',t.source.url??'',v=>update(()=>{t.source.url=v||null;}),{type:'url',path:'source.url',placeholder:'https://',help:'http/https 주소만 저장합니다. 앱은 주소를 자동으로 불러오지 않습니다.'}),
        field('원문 확인일',isoLocal(t.source.checkedAt),v=>update(()=>{const d=new Date(v);t.source.checkedAt=Number.isNaN(+d)?v:d.toISOString();}),{type:'datetime-local',path:'source.checkedAt'})),
      section('03','문서 역할',
        el('p',{class:'small muted'},'보고서, 동의서처럼 파일을 구분하는 역할입니다. 역할마다 개수 조건이 한 개씩 필요합니다.'),
        ...t.roles.map((role,index)=>el('div',{class:'role-editor'},
          field(`역할 ${index+1}`,role.label,v=>update(()=>{role.label=v;for(const option of content.querySelectorAll('option'))if(option.value===role.id)option.textContent=v||'이름 없는 역할';}),{path:`roles[${index}].label`,placeholder:'역할 이름'}),
          button('삭제',()=>{update(()=>{t.roles=t.roles.filter(r=>r.id!==role.id);t.rules=t.rules.filter(r=>r.roleId!==role.id);t.manualChecks=t.manualChecks.filter(r=>r.roleId!==role.id);});paint();},'subtle compact danger',{'aria-label':`${role.label||'역할'} 삭제`}) )),
        button('＋ 역할 추가',()=>{const id=uid('role');update(()=>{t.roles.push({id,label:''});t.rules.push({id:uid('rule'),type:'role_count',roleId:id,label:'파일 개수',params:{min:1,max:1},evidence:{kind:'author_note',text:''}});});paint();},'compact',{disabled:t.roles.length>=10})),
      section('04','자동 검사 조건',
        el('p',{class:'small muted'},'컴퓨터가 비교할 수 있는 조건만 등록하세요. 모호한 조건은 아래 직접 확인 항목으로 남기세요.'),
        ...t.rules.map((rule,index)=>{
          const path=`rules[${index}]`;
          const box=el('div',{class:'rule-editor'});
          box.append(el('div',{class:'rule-toolbar'},
            field('검사 종류',rule.type,v=>{update(()=>{rule.type=v;rule.params=paramsFor(v);rule.roleId=v==='max_total_bytes'?null:(rule.roleId??t.roles[0]?.id??'');});paint();},{kind:'select',path:`${path}.type`,items:TYPES}),
            button('조건 삭제',()=>{update(()=>{t.rules.splice(index,1);});numericErrors.clear();paint();},'subtle compact danger')),
            field('항목 이름',rule.label,v=>update(()=>{rule.label=v;}),{path:`${path}.label`}));
          if(rule.type!=='max_total_bytes') box.append(field('대상 역할',rule.roleId,v=>update(()=>{rule.roleId=v;}),{kind:'select',path:`${path}.roleId`,items:roles()}));
          if(rule.type==='role_count')box.append(el('div',{class:'field-row'},numeric('최소 개수',rule.params.min,v=>rule.params.min=v,`${path}.params.min`),numeric('최대 개수',rule.params.max,v=>rule.params.max=v,`${path}.params.max`,1)));
          if(rule.type==='allowed_extensions')box.append(field('허용 확장자',rule.params.allowed.join(', '),v=>update(()=>{rule.params.allowed=v.split(/[\s,]+/).filter(Boolean).map(x=>x.replace(/^\./,'').toLowerCase());}),{path:`${path}.params.allowed`,placeholder:'pdf, hwp, hwpx',help:'점을 빼고 쉼표로 구분하세요. 영문은 소문자로 저장합니다.'}));
          if(rule.type==='max_file_bytes'||rule.type==='max_total_bytes')box.append(size(rule,path));
          if(rule.type==='filename_template'){
            const preview=el('p',{class:'small muted'});
            const refresh=()=>{const v=buildExpectedFilename(rule.params.pattern,{name:'홍길동',studentId:'03107'});preview.textContent=`가상 값 미리보기: ${v.filename??v.error??'형식을 확인해 주세요.'}`;};
            const pattern=field('전체 파일명 형식',rule.params.pattern,v=>update(()=>{rule.params.pattern=v;refresh();}),{path:`${path}.params.pattern`,help:'고정 확장자로 끝나는 전체 이름을 입력하세요. 학번·이름만 삽입할 수 있습니다.'});
            box.append(pattern,el('div',{class:'actions'},...['studentId','name'].map(key=>button(key==='name'?'이름 넣기':'학번 넣기',()=>{const i=pattern.input;const start=i.selectionStart??i.value.length,end=i.selectionEnd??start;i.value=i.value.slice(0,start)+`{${key}}`+i.value.slice(end);update(()=>{rule.params.pattern=i.value;});refresh();i.focus();},'compact'))),preview);refresh();
          }
          box.append(evidence(rule,path));return box;
        }),
        button('＋ 검사 조건 추가',()=>{update(()=>{t.rules.push({id:uid('rule'),type:'allowed_extensions',roleId:t.roles[0]?.id??'',label:'확장자',params:{allowed:['pdf']},evidence:{kind:'author_note',text:''}});});paint();},'compact',{disabled:t.rules.length>=50})),
      section('05','직접 확인 항목',
        el('p',{class:'small muted'},'서명, 본문 내용, 최종본 여부처럼 사람이 직접 확인할 내용을 적어 주세요.'),
        ...t.manualChecks.map((item,index)=>el('div',{class:'rule-editor'},
          field('확인 질문',item.question,v=>update(()=>{item.question=v;}),{path:`manualChecks[${index}].question`,placeholder:'동의서의 서명을 직접 확인했나요?'}),
          field('대상 역할',item.roleId??'',v=>update(()=>{item.roleId=v||null;}),{kind:'select',path:`manualChecks[${index}].roleId`,items:[{value:'',label:'선택 파일 전체'},...roles().slice(1)]}),
          evidence(item,`manualChecks[${index}]`),
          button('확인 항목 삭제',()=>{update(()=>{t.manualChecks.splice(index,1);});paint();},'subtle compact danger'))),
        button('＋ 직접 확인 추가',()=>{update(()=>{t.manualChecks.push({id:uid('manual'),roleId:null,question:'',evidence:{kind:'author_note',text:''}});});paint();},'compact',{disabled:t.manualChecks.length>=30}))
    );
  }
  function report(list) {
    root.querySelectorAll('[aria-invalid]').forEach(n=>n.removeAttribute('aria-invalid'));
    errors.replaceChildren(notice(el('div',{},el('strong',{},'다음 내용을 확인해 주세요.'),el('ul',{class:'error-list'},...list.map(e=>el('li',{},`${e.path}: ${e.message}`)))),'error'));
    for(const error of list){const path=error.path.replace(/^\$\./,'');const f=Array.from(root.querySelectorAll('[data-path]')).find(n=>n.dataset.path===path);if(f)f.setAttribute('aria-invalid','true');}
    const first=root.querySelector('[aria-invalid]');
    if(first){first.focus();first.scrollIntoView({block:'center',behavior:'smooth'});}else errors.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function validateAndSave(ready) {
    if(numericErrors.size){report([...numericErrors.values()]);return;}
    t.updatedAt=new Date().toISOString();
    const check=validateTemplate(ready?{...t,status:'ready'}:t,ready?'ready':'draft');
    if(!check.valid){report(check.errors);return;}
    errors.replaceChildren();
    try{
      const saved=ready?onFinalize(record,finalizeDraft(record)):onSaveDraft(record);
      if(saved!==false)dirty=false;
    }catch(error){report([{path:'기준 확정',message:error.message}]);}
  }
  root.append(record.baseRevision?notice(`v${record.baseRevision}을 바탕으로 편집 중입니다. 확정하면 바뀐 내용을 새 버전으로 보관합니다.`):notice('초안은 미완성 상태로 저장할 수 있습니다. 조건과 근거를 모두 작성한 뒤 확정하세요.'),errors,content,
    el('div',{class:'sticky-actions'},button('목록으로',()=>onCancel(dirty),'subtle'),el('div',{class:'actions'},button('초안 저장',()=>validateAndSave(false)),button('기준 확정',()=>validateAndSave(true),'primary'))));
  paint();return root;
}
