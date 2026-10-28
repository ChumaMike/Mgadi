import { createAvatar } from '../accessibility/avatar.js';
import { recognizeGesture } from './gesture-cues.js';
const canvas = document.querySelector('#gesture-canvas');
const avatar = createAvatar(canvas);
const messages = {
 help: {title:'Get help',description:'Use trusted assistance. For urgent payment fraud, contact your bank first.',note:'Both arms raised: an illustrative help gesture, not SASL.'},
 check: {title:'Verify details',description:'Check changed bank details using a previously trusted contact method.',note:'A thinking pose: illustrative only, not SASL.'},
 protect: {title:'Protect your accounts',description:'Use a trusted device and follow your bank’s instructions to secure access.',note:'Crossed arms: illustrative protection gesture, not SASL.'},
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

const speechButton = document.querySelector('#speech-test');
const speechStatus = document.querySelector('#speech-status');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition && speechButton) {
  let recognizer=null;
  speechButton.addEventListener('click',()=>{
    if (recognizer){recognizer.stop();return;}
    recognizer = new SpeechRecognition(); recognizer.lang='en-ZA'; recognizer.continuous=true;recognizer.interimResults=true;
    recognizer.onresult=(event)=>{
      const latest=event.results[event.results.length-1]?.[0]?.transcript||'';
      speechStatus.textContent='Heard: '+latest;
      const found=recognizeGesture(latest);
      if(found)show(found.key);
    };
    recognizer.onerror=(event)=>{speechStatus.textContent='Speech recognition unavailable: '+event.error;};
    recognizer.onend=()=>{recognizer=null;speechButton.textContent='Test by speaking';};
    try {recognizer.start();speechButton.textContent='Stop listening';speechStatus.textContent='Listening for words…';}
    catch {recognizer=null;speechStatus.textContent='Could not start speech recognition.';}
  });
} else if (speechButton) { speechButton.disabled=true; speechStatus.textContent='Speech recognition is not supported by this browser; use the gesture buttons.'; }
