import { createAvatar } from './accessibility/avatar.js';
const canvas = document.querySelector('#gesture-canvas');
const avatar = createAvatar(canvas);
const messages = {
 stop: {title:'Stop and verify',description:'Do not pay using changed banking details until you have verified them through a trusted channel.',note:'Raised open hand: an illustrative STOP gesture, not a verified SASL sign.'},
 call: {title:'Call your bank',description:'If the payment has already happened, call your bank using an official number from your bank card or trusted source.',note:'Hand near ear: an illustrative PHONE gesture, not a verified SASL sign.'},
 save: {title:'Preserve evidence',description:'Keep the suspicious message and proof of payment. Do not send passwords, PINs or OTPs.',note:'Hands together: an illustrative REMEMBER / KEEP gesture, not a verified SASL sign.'},
};
const status=document.querySelector('#gesture-status'), details=document.querySelector('#gesture-details'),note=document.querySelector('#gesture-note');
function show(key){
 const m=messages[key];if(!m)return;
 avatar.setGesture(key);
 avatar.setMood(key==='call'?'listening':'idle');
 status.textContent=m.title;details.textContent=m.description;note.textContent=m.note;
 document.querySelectorAll('[data-gesture]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gesture===key)));
}
document.querySelectorAll('[data-gesture]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.gesture)));
const media=matchMedia('(prefers-reduced-motion: reduce)');
const setMotion=()=>{if(media.matches)avatar.pause();else avatar.play();};
media.addEventListener?.('change',setMotion);
show('stop');setMotion();
document.addEventListener('visibilitychange',()=>{if(document.hidden)avatar.pause();else setMotion()});
window.addEventListener('pagehide',()=>avatar.destroy(),{once:true});
