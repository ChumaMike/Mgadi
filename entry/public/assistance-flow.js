import { makePack, verifyPack } from './shared/pack.js';
import { sha256Hex } from './shared/sha256.js';

const KEY='mgadi.assistance.v1';
const PHASES=['incoming','guidance','feedback','permission','evidence','review','pack'];
const MAX_FILES=20,MAX_BYTES=20*1024*1024;
export function readAssistance(storage){
  const raw=storage.getItem(KEY);if(!raw)return null;
  const c=JSON.parse(raw);
  if(c?.version!==1||!PHASES.includes(c.phase)||typeof c.id!=='string'||typeof c.description!=='string'||!Array.isArray(c.evidence)||!Array.isArray(c.timeline)||!c.flow||!Array.isArray(c.flow.steps))throw Error('Unreadable saved incident');
  if(c.evidence.length>MAX_FILES||!c.evidence.every(f=>typeof f.name==='string'&&Number.isFinite(f.size)&&f.size>=0&&/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('Unreadable evidence inventory');
  return c;
}
export function assistancePackData(c){
 return {format:'mgadi-incident-pack/4',incidentId:c.id,generatedAt:new Date().toISOString(),startedAt:c.startedAt,
  description:c.description,assessment:{label:c.label,title:c.flow.title,certainty:'Working guide, not a confirmed diagnosis'},
  bank:{name:c.bank||'Not selected',contactStatus:c.bankStatus||'not_reported',reference:c.reference||'',feedback:c.feedback||''},
  evidenceChoice:c.permission||'not_recorded',evidence:c.evidence,timeline:c.timeline,
  actions:c.flow.steps.map(step=>({id:step.id,title:step.title,status:step.id==='bank'&&c.bankStatus==='contacted'?'user_reported_contact':'not_confirmed'})),
  guide:{reviewed:false,status:'Draft guidance; practitioner review pending'},
  note:'File bytes are not included. Actions are user reported. SHA-256 detects differences against a trusted original checksum; it is not a digital signature or proof of authenticity. This record does not confirm resolution or recovery.'};
}
export function createAssistanceFlow({root,clear,goHome,banks}){
 let current=null,processing=false,storageWarning='',pack=null;
 const el=(tag,text='',attrs={})=>{const n=document.createElement(tag);n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const b=(text,fn,cls='button')=>{const n=el('button',text,{type:'button',class:cls});n.addEventListener('click',fn);return n;};
 const p=text=>el('p',text);const small=text=>el('p',text,{class:'privacy'});
 const row=(...nodes)=>{const n=el('div','',{class:'assistance-actions'});n.append(...nodes);return n;};
 const field=(label,key,{type='text',max=1000}={})=>{const box=el('div','',{class:'field'}),id='assistance-'+key,input=el(type==='textarea'?'textarea':'input','',{id,...(type==='textarea'?{}:{type}),maxlength:String(max)});input.value=current[key]||'';input.addEventListener('input',()=>{current[key]=input.value;save();});box.append(el('label',label,{for:id}),input);return box;};
 const event=text=>current.timeline.push({at:new Date().toISOString(),text});
 function save(){try{localStorage.setItem(KEY,JSON.stringify(current));storageWarning='';}catch{storageWarning='Progress could not be saved on this browser. Keep this tab open and download your pack before leaving.';}}
 function go(phase){stopReading();current.phase=phase;save();render();window.scrollTo(0,0);}
 function stopReading(){if('speechSynthesis'in window)window.speechSynthesis.cancel();}
 function start({incident,label,flow}){
  const launch=()=>{current={version:1,id:'MG-'+Date.now().toString(36).toUpperCase(),startedAt:new Date().toISOString(),phase:'incoming',label,flow,description:incident.redacted?.text||incident.description||'',evidence:[],timeline:[{at:new Date().toISOString(),text:'Incident report received'}],bankStatus:'not_reported'};pack=null;save();render();};
  if(current&&current.phase!=='pack'){const card=screen('Keep your current report?', 'Your active report is saved on this browser.');card.append(row(b('Resume my report',render),b('Replace with this new report',launch,'button secondary')));return;}
  launch();
 }
 function screen(title,description){clear();const card=el('section','',{class:'card assistance-card'});card.append(el('p','MGADI · YOUR NEXT SAFE STEP',{class:'assistance-eyebrow'}),el('h1',title));if(description)card.append(p(description));if(storageWarning)card.append(el('p',storageWarning,{role:'alert',class:'notice bad'}));root.append(card);return card;}
 function getInstruction(){
  const bankStep=current.flow.steps.find(s=>s.id==='bank');
  return bankStep?{title:'Please contact your bank now',body:'If you haven’t already, call your bank through an official contact. Tell them about the suspected payment scam and ask whether the payment can be stopped or recalled. Keep the reference they give you.'}:{title:current.flow.steps[0]?.title||'Let’s take the next safe step',body:(current.flow.steps[0]?.do||['If money may be at risk, contact your bank through its official app or card.']).join(' ')};
 }
 function resume(){try{current=readAssistance(localStorage);if(!current)return false;if(current.phase==='pack'&&!current.pack){current.phase='review';}pack=current.pack||null;render();return true;}catch{current=null;return false;}}
 function incoming(){const card=screen('Mgadi is ready to guide you.', 'I’m sorry you’re dealing with this. Let’s take it one step at a time.');
  card.append(el('div','M',{class:'assistance-call-mark','aria-hidden':'true'}),el('h2','Incoming in-app guidance'),p('Pick up to see your first action. You can read every word, with optional read-aloud.'),small('Guided assistance · no telephone call, microphone or live agent connection.'),row(b('Pick up guidance',()=>{event('Owner opened in-app guidance');go('guidance');}),b('Continue by text',()=>go('guidance'),'button secondary')));
 }
 function guidance(){const instruction=getInstruction(),card=screen(instruction.title,instruction.body);
  card.append(small('Contact your bank without waiting to finish collecting evidence. Recovery is not guaranteed.'));
  const audioStatus=el('p','',{role:'status',class:'privacy'});
  const read=b('Read this guidance aloud',()=>{if(!('speechSynthesis'in window)){audioStatus.textContent='Read aloud is unavailable here. The full guidance is written above.';return;}const u=new SpeechSynthesisUtterance(instruction.title+'. '+instruction.body);u.lang='en-ZA';window.speechSynthesis.speak(u);audioStatus.textContent='Reading the written guidance. You can stop it at any time.';},'button secondary');
  card.append(small('Read aloud is optional. Your device/browser voice may use an online speech service.'),row(read,b('Stop reading',stopReading,'button secondary')),audioStatus);
  const label=el('label','Choose your bank',{for:'assistance-bank'}),choice=el('select','',{id:'assistance-bank'});choice.append(el('option','Select a bank',{value:''}));for(const bank of banks.banks)choice.append(el('option',bank.name,{value:bank.name}));choice.value=current.bank||'';
  const contact=el('div','',{class:'assistance-bank'});
  const draw=()=>{contact.replaceChildren();const bank=banks.banks.find(x=>x.name===current.bank);if(bank){contact.append(el('strong',bank.name),el('a','Call '+bank.number,{href:'tel:'+bank.tel,class:'button secondary'}),small('Confirm this contact with your bank card or official banking app. Opening the dialler does not mark the bank contacted.'));}};
  choice.addEventListener('change',()=>{current.bank=choice.value;save();draw();});draw();card.append(label,choice,contact,small('Directory last checked: '+banks.checkedOn+'. Never use a number supplied in a suspicious message.'),row(b('Finish guidance / hang up',()=>{event('Owner finished in-app guidance');go('feedback');}),b('Skip to evidence',()=>{event('Owner continued to evidence; bank contact unconfirmed');go('permission');},'button secondary')));
 }
 function feedback(){const card=screen('Welcome back. How did it go?', 'Record what happened when you contacted your bank. You can leave anything you do not know.');
  const select=el('select','',{id:'assistance-bank-status'});for(const[v,t]of [['not_reported','I have not contacted the bank yet'],['contacted','I spoke to the bank'],['unreachable','I tried but could not get through'],['not_applicable','This does not apply to my incident']])select.append(el('option',t,{value:v}));select.value=current.bankStatus;select.addEventListener('change',()=>{current.bankStatus=select.value;save();});
  card.append(el('label','Bank contact status',{for:'assistance-bank-status'}),select,field('Bank reference (optional)','reference',{max:100}),field('What did they tell you? (optional)','feedback',{type:'textarea',max:1500}),small('This records your report; Mgadi has not contacted the bank or checked their response.'),row(b('Continue to evidence',()=>{event('Owner recorded bank feedback: '+current.bankStatus);go('permission');}),b('Back to bank contacts',()=>go('guidance'),'button secondary')));
 }
 function permission(){const card=screen('How would you like to add evidence?', 'I can help organise the files you choose. You stay in control of what is selected.');
  card.append(p('Accept opens your browser’s file chooser. Mgadi reads only the selected files on this device to record their names and SHA-256 fingerprints. Files are not uploaded.'),el('a','Read the formal access explanation ↗',{href:'/evidence-access.html',target:'_blank',rel:'noopener noreferrer',class:'access-explanation'}),small('Deny opens no file chooser. You can select evidence yourself on the next screen.'),row(b('Accept — choose files',()=>{current.permission='accepted_selected_files_only';event('Owner accepted access to individually selected files');go('evidence');root.querySelector('#assistance-evidence').click();}),b('Deny — I’ll add evidence myself',()=>{current.permission='denied_then_manual';event('Owner declined assisted file selection; manual selection available');go('evidence');},'button secondary')));
 }
 function inventory(container,{removable=false}={}){container.replaceChildren();if(!current.evidence.length){container.append(small('No files added yet. You can still prepare a pack and list missing records.'));return;}
  current.evidence.forEach((file,index)=>{const item=el('article','',{class:'assistance-evidence-item'}),details=el('details');details.append(el('summary','View SHA-256 fingerprint'),el('code',file.sha256));item.append(el('strong',file.name),small(Math.ceil(file.size/1024)+' KB · '+new Date(file.addedAt).toLocaleString('en-ZA')),details);if(removable)item.append(b('Remove this entry',()=>{current.evidence.splice(index,1);event('Owner removed an evidence entry');save();inventory(container,{removable:true});},'button secondary'));container.append(item);});
 }
 function evidence(){const card=screen('Add the evidence you have.',current.permission==='denied_then_manual'?'You declined assisted selection. Choose your own files below; nothing is selected automatically.':'Choose only the records you want in your incident inventory.');
  const help=el('details','',{open:''}),list=el('ul');
  for(const text of ['The original suspicious email or message, including sender and time.','The invoice or request with the changed banking details.','Proof of payment, if money was sent.','The bank reference and your real supplier’s response, if available.'])list.append(el('li',text));
  help.append(el('summary','What evidence should I collect?'),list,small('Keep originals unchanged. Screenshots are useful when you cannot export a message. Do not open suspicious links or attachments just to collect evidence.'));
  const input=el('input','',{id:'assistance-evidence',type:'file',multiple:'',accept:'image/*,.pdf,.eml,.msg,.txt,.csv'}),feedback=el('p','',{role:'status'}),items=el('div');inventory(items,{removable:true});
  const next=b('Review my evidence →',()=>go('review'));
  input.addEventListener('change',async()=>{if(processing)return;processing=true;input.disabled=true;next.disabled=true;const id=current.id;feedback.textContent='Creating fingerprints on this device…';const errors=[];
   try{for(const file of Array.from(input.files||[])){if(current.evidence.length>=MAX_FILES){errors.push('Maximum 20 files.');break;}if(file.size>MAX_BYTES){errors.push(file.name+' is larger than 20 MB.');continue;}const sha256=await sha256Hex(await file.arrayBuffer());if(current.id!==id)break;if(current.evidence.some(e=>e.sha256===sha256&&e.name===file.name))continue;current.evidence.push({name:file.name,size:file.size,type:file.type||'unknown',sha256,addedAt:new Date().toISOString()});event('Evidence fingerprint recorded: '+file.name);}save();inventory(items,{removable:true});feedback.textContent=errors.length?errors.join(' '):current.evidence.length+' file(s) in your inventory. No files were uploaded.';}catch(e){feedback.textContent=e.message;}finally{processing=false;input.disabled=false;next.disabled=false;input.value='';}
  });
  card.append(help,el('label','Select evidence files yourself',{for:'assistance-evidence'}),input,small('20 files maximum · 20 MB per file. Only names, sizes and fingerprints are saved. Keep the original files separately.'),feedback,items,field('Evidence still missing / notes (optional)','missing',{type:'textarea',max:1500}),row(next,b('Back to access choice',()=>go('permission'),'button secondary')));
 }
 function review(){const card=screen('Review before creating your pack.', 'Check your selected files and the information below. Go back to remove or add evidence.');
  card.append(el('h2','Your report'),p(current.description||'No description recorded.'),el('h2','Bank feedback'),p(current.bank||'No bank selected'),p(({not_reported:'Not contacted yet',contacted:'You reported speaking to the bank',unreachable:'You reported being unable to reach the bank',not_applicable:'You reported this does not apply'})[current.bankStatus]||'Not recorded'),p(current.reference||'No reference recorded'),p(current.feedback||'No feedback recorded'),el('h2','Evidence selected'));
  const items=el('div');inventory(items);card.append(items);if(current.missing)card.append(el('h2','Missing records / notes'),p(current.missing));
  card.append(small('Your pack will contain this record and the file fingerprints. Original file contents are not attached. Review filenames and notes before sharing.'),row(b('Create SHA-256 incident pack',async()=>{if(processing)return;processing=true;const status=el('p','Creating your pack…',{role:'status'});card.append(status);try{event('Owner reviewed the incident and requested a pack');pack=await makePack({...assistancePackData(current),missingEvidence:current.missing||''});current.pack=pack;go('pack');}catch(e){status.textContent=e.message;}finally{processing=false;}}),b('Back — edit evidence',()=>go('evidence'),'button secondary'),b('Edit bank feedback',()=>go('feedback'),'button secondary')));
 }
 function complete(){pack=current.pack||pack;if(!pack){go('review');return;}const card=screen('Your incident pack is ready.', 'Download your record for your bank or another trusted responder.');
  card.append(el('div','✓',{class:'assistance-success','aria-hidden':'true'}),el('h2',current.evidence.length+' evidence fingerprint(s)'),p('SHA-256 checksum created for the incident record.'),el('code',pack.fingerprint,{class:'hash'}),small('A checksum helps detect edits against the original. It does not lock the file or prove authenticity.'),row(b('Download incident pack (.json)',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));const a=el('a','',{href:url,download:'mgadi-'+current.id+'.json'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}),b('Print / save PDF',()=>window.print(),'button secondary'),b('Review my record',()=>go('review'),'button secondary')));
  const verifier=el('details'),input=el('input','',{type:'file',accept:'.json,application/json',id:'assistance-verify'}),result=el('p','',{role:'status'});input.addEventListener('change',async()=>{try{const f=input.files[0];if(!f)return;if(f.size>5*1024*1024)throw Error();result.textContent=await verifyPack(JSON.parse(await f.text()))?'Checksum matches. Compare with your retained original.':'Checksum mismatch — this differs from its recorded checksum.';}catch{result.textContent='This is not a readable incident pack.';}});verifier.append(el('summary','Check a downloaded pack'),el('label','Choose a Mgadi JSON pack',{for:'assistance-verify'}),input,result);card.append(verifier,small('Saved on this browser until you clear it. The incident and any bank recovery remain separate from creating this record.'),b('Close and clear this report',()=>{const d=el('dialog','',{'aria-label':'Clear saved incident'});d.append(el('h2','Clear this saved report?'),p('Download your pack first if you need to keep it. This removes the record from this browser.'),row(b('Keep report',()=>{d.close();d.remove();}),b('Clear report',()=>{localStorage.removeItem(KEY);stopReading();current=null;pack=null;d.close();d.remove();goHome();},'button secondary')));document.body.append(d);d.showModal();},'button secondary'));
 }
 function render(){if(!current)return;({incoming,guidance,feedback,permission,evidence,review,pack:complete}[current.phase]||incoming)();}
 return {start,resume,stop:stopReading};
}
