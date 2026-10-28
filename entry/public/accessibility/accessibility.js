import { languages, translate, translationLanguage } from './catalog.js';
import { createAvatar } from './avatar.js';
import { findReviewedSign } from './signs.js';
let locale = 'en';
const bindings = new Map();
let voiceConsent = false;
let currentUtterance;
let dialog, avatar, caption, signStatus, video, voiceStatus;
let spokenNodes = [];
let lastTarget;
const synth = window.speechSynthesis;
const el = (tag, text, attrs={}) => { const n=document.createElement(tag); n.lang='en'; if(text)bindText(n,text); for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v); return n; };
const button = (text,fn) => {const n=el('button',text,{type:'button',class:'button secondary'});n.addEventListener('click',fn);return n;};
export const getLocale = () => locale;
export function bindText(node, source, attribute=null) {
  bindings.set(new WeakRef(node),{source,attribute});
  apply(node,source,attribute);return node;
}
function apply(node,source,attribute) {
  const translated=translate(source,locale);
  if(attribute)node.setAttribute(attribute,translated);else node.textContent=translated;
  node.lang=translationLanguage(source,locale);
}
function updateLanguage() {
  stopSpeech();
  for(const [ref,{source,attribute}] of bindings) { const node=ref.deref(); if(node)apply(node,source,attribute);else bindings.delete(ref); }
  document.documentElement.lang=locale;
  document.dispatchEvent(new CustomEvent('mgadi:language',{detail:{locale}}));
}
let audioMessageStale=false;
// Silent by default: navigation, language changes and consent changes must not announce "Audio stopped."
// to screen readers. Only an explicit press of "Stop audio" announces.
export function stopSpeech(announce=false){
  synth?.cancel();currentUtterance=null;spokenNodes=[];
  if(!voiceStatus)return;
  if(announce)voiceStatus.textContent='Audio stopped.';
  else if(audioMessageStale){voiceStatus.textContent='';audioMessageStale=false;}
}
function speak(nodes, index=0) {
  if(!synth || !window.SpeechSynthesisUtterance){voiceStatus.textContent='Read aloud is unavailable in this browser. All guidance remains readable.';return;}
  if(index>=nodes.length){voiceStatus.textContent='Finished reading.';audioMessageStale=true;return;}
  const node=nodes[index], lang=node.lang||'en';
  const voices=synth.getVoices();
  const voice=voices.find(v=>v.lang.toLowerCase().split('-')[0]===lang);
  if(!voice){voiceStatus.textContent=`No ${languages[lang]||lang} voice is installed. Read the text or choose another language. No other-language voice was substituted.`;return;}
  currentUtterance=new SpeechSynthesisUtterance(node.textContent);
  currentUtterance.voice=voice;currentUtterance.lang=voice.lang;currentUtterance.rate=.9;
  currentUtterance.onend=()=>{if(spokenNodes===nodes)speak(nodes,index+1);};
  currentUtterance.onerror=()=>{voiceStatus.textContent='Audio unavailable. Please continue with the text.';};
  voiceStatus.textContent=`Reading in ${languages[lang]||lang}.`;audioMessageStale=true;
  synth.speak(currentUtterance);
}
function listen(nodes){stopSpeech();if(document.documentElement.dataset.textOnly==='true'){voiceStatus.textContent='Text-only mode is on. Turn it off to use audio.';voiceStatus.focus();return;}if(!voiceConsent){voiceStatus.textContent='Enable “Allow read aloud” first. Your browser or operating system may process this guidance using an online voice service.';voiceStatus.focus();return;}spokenNodes=nodes;speak(nodes);}
export function guidanceControls(targets, messageId) {
  const wrap=el('div','',{class:'guidance-controls','aria-label':'Guidance formats'});
  const listenButton=button('Listen',()=>listen(targets));bindText(listenButton,'Listen');
  const signButton=button('SASL availability',()=>openSign(targets,messageId));bindText(signButton,'SASL availability');
  wrap.append(listenButton,signButton);
  // Hover is opt-in and is an alternative to explicit tap/keyboard activation.
  targets.forEach(target=>target.addEventListener('pointerenter',()=>{
    if(document.querySelector('#hover-sign')?.checked && matchMedia('(hover: hover)').matches && !dialog.open)openSign(targets,messageId);
  }));
  return wrap;
}
function openSign(targets,messageId,call=false){
  lastTarget=document.activeElement;caption.replaceChildren();
  for(const target of targets){const p=el('p',target.textContent,{lang:target.lang||'en'});caption.append(p);}
  video.hidden=true;video.removeAttribute('src');
  const clip=findReviewedSign(messageId);
  signStatus.textContent=clip?`Reviewed SASL clip, reviewed by ${clip.reviewer} on ${clip.reviewedOn}.`:'SASL translation unavailable for this message. The 3D model is a visual prototype, not a signing translation. Other help that works: Listen, the transcript below, or Talk to Mgadi, which shows live captions when voice is available.';
  video.replaceChildren();
  // A reviewed clip always carries its captions (the registry will not accept one without).
  if(clip){video.src=clip.src;const track=document.createElement('track');track.kind='captions';track.src=clip.captions;track.srclang='en';track.label='Captions';track.default=true;video.append(track);video.hidden=false;}
  document.querySelector('#call-demo-note').hidden=!call;
  dialog.showModal();
}
export function installAccessibility(){
  const host=document.querySelector('#accessibility');
  const details=el('details');const summary=el('summary');const selected=el('span','English',{class:'selected-language'});
  summary.append(el('span','Language & accessibility'),selected);details.append(summary);
  const panel=el('div','',{class:'access-panel'});
  const label=el('label','Language / Ulimi / Ulwimi / Taal',{for:'language'});
  const select=el('select','',{id:'language'});
  for(const [id,name] of Object.entries(languages))select.append(el('option',name,{value:id}));
  select.addEventListener('change',()=>{locale=select.value;updateLanguage();selected.textContent=locale==='en'?'English':`${languages[locale]} · ${['zu','xh','af'].includes(locale)?'partial draft':'not translated'}`;selected.lang='en';});
  const notice=el('p','All 12 official South African languages are listed, including SASL. English is the primary interface; isiZulu, isiXhosa and Afrikaans have partial drafts. All translations need speaker review. Missing translations remain in English. SASL needs reviewed signing content; selecting it does not enable automatic sign translation.',{class:'notice',lang:'en'});
  const size=el('select','',{id:'text-size'});for(const [v,t]of [['normal','100%'],['large','125%'],['larger','150%'],['largest','200%']])size.append(el('option',t,{value:v}));size.addEventListener('change',()=>document.documentElement.dataset.textSize=size.value);
  const toggle=(id,text,fn)=>{const l=el('label','',{class:'toggle',for:id});const n=el('input','',{type:'checkbox',id});l.append(n,document.createTextNode(text));n.addEventListener('change',()=>fn(n.checked));return l;};
  voiceStatus=el('p','',{role:'status',tabindex:'-1',lang:'en',class:'audio-status'});
  panel.append(label,select,el('label','Text size',{for:'text-size'}),size,
    toggle('contrast','High contrast',v=>document.documentElement.dataset.contrast=String(v)),
    toggle('reduced-motion','Reduce movement',v=>{document.documentElement.dataset.reducedMotion=String(v);if(v)avatar?.pause();}),
    toggle('text-only','Low-data / text-only mode',v=>{document.documentElement.dataset.textOnly=String(v);if(v){avatar?.pause();video?.pause();stopSpeech();} if(dialog?.open)dialog.close();}),
    toggle('hover-sign','Open signing panel when hovering over guidance',()=>{}),
    toggle('voice-consent','Allow read aloud. The device voice service may process guidance online.',v=>{voiceConsent=v;if(!v)stopSpeech();}),
    button('Stop audio',()=>stopSpeech(true)),button('Pause audio',()=>synth?.pause()),button('Resume audio',()=>synth?.resume()));
  panel.append(notice);details.append(panel);host.append(details,voiceStatus);
  dialog=el('dialog','',{class:'sign-dialog','aria-labelledby':'sign-title'});
  const title=el('h2','Signing studio',{id:'sign-title'});
  signStatus=el('p','',{role:'status',class:'notice'});
  const note=el('p','Call walkthrough only: no telephone connection, live interpreter, camera input or sign recognition. You can read the current guidance and preview the avatar here.',{id:'call-demo-note',class:'notice'});note.hidden=true;
  const canvas=el('canvas','',{width:'400',height:'470',role:'img','aria-label':'Original three-dimensional avatar with articulated arms and fingers in a neutral pose. Not validated SASL.'});
  const avatarWrap=el('div','',{class:'avatar-wrap'});avatarWrap.append(canvas);
  caption=el('div','',{class:'sign-caption','aria-label':'Guidance transcript'});
  video=el('video','',{controls:'',preload:'none','aria-label':'Reviewed SASL guidance'});video.hidden=true;
  const controls=el('div','',{class:'avatar-controls'});
  controls.append(button('Preview neutral movement',()=>{if(document.documentElement.dataset.reducedMotion==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;avatar?.play();}),button('Pause movement',()=>avatar?.pause()));
  const rotate=el('input','',{type:'range',min:'-0.7',max:'0.7',step:'0.05',value:'-0.1',id:'avatar-angle'});rotate.addEventListener('input',()=>avatar?.rotate(Number(rotate.value)));
  controls.append(el('label','Rotate model',{for:'avatar-angle'}),rotate);
  dialog.append(title,signStatus,note,avatarWrap,controls,video,caption,button('Close',()=>dialog.close()));document.body.append(dialog);
  dialog.addEventListener('close',()=>{avatar?.destroy();avatar=null;video.pause();lastTarget?.focus();});
  // Lazy-load model geometry only when the user opens the signing panel.
  const originalShow=dialog.showModal.bind(dialog);dialog.showModal=()=>{originalShow();if(document.documentElement.dataset.textOnly!=='true')avatar=createAvatar(canvas);};
  bindText(document.querySelector('#emergency-button'),'Bank fraud line');
}
export function callWalkthrough(targets){openSign(targets,'unavailable',true);}
