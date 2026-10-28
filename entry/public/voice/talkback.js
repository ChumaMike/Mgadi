import {createAvatar} from '../accessibility/avatar.js';
import {recognizeGesture} from './gesture-cues.js';
const byId=id=>document.getElementById(id);
const avatar=createAvatar(byId('avatar'));const reduced=matchMedia('(prefers-reduced-motion: reduce)');
if(!reduced.matches)avatar.play();
const status=byId('status'),chat=byId('chat'),text=byId('message'),token=byId('token'),mic=byId('mic'),send=byId('send'),stop=byId('stop'),form=byId('message-form'),aiMode=byId('ai-mode'),voice=byId('speak-replies');
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const history=[];let listening=false,recognizer=null,busy=false,speaking=null,callActive=false,visualOn=true,lastReply='',gestureTimer=null;
const phase=byId('call-phase'),stage=byId('visual-stage'),visualButton=byId('toggle-visual'),caption=byId('live-caption'),startCall=byId('start-call'),endCall=byId('end-call');
function setPhase(next){phase.textContent=next;phase.dataset.phase=next.toLowerCase().replace(/[^a-z]+/g,'-');avatar.setMood(next==='Speaking'?'speaking':next==='Listening'?'listening':next==='Thinking'?'thinking':'idle');}
function toggleVisual(){visualOn=!visualOn;byId('workspace').dataset.visual=visualOn?'on':'off';stage.hidden=!visualOn;visualButton.textContent=visualOn?'Hide gesture companion':'Show gesture companion';visualButton.setAttribute('aria-pressed',String(visualOn));if(visualOn){if(!reduced.matches)avatar.play();}else avatar.pause();}
visualButton.addEventListener('click',toggleVisual);
function startSession(){callActive=true;startCall.disabled=true;endCall.disabled=false;setPhase('Ready');report('TalkBack call started. Tap Speak or type a question.');}
function finishSession(){callActive=false;stopMic();endSpeech();startCall.disabled=false;endCall.disabled=true;caption.hidden=true;setPhase('Ended');report('Conversation ended. Your text stays visible until you clear it.');}
startCall.addEventListener('click',startSession);endCall.addEventListener('click',finishSession);
const report=(message)=>{status.textContent=message;byId('connection').textContent=message.length>45?message.slice(0,42)+'…':message;};
function add(role,message){byId('placeholder')?.remove();const b=document.createElement('div');b.className='bubble '+role;const heading=document.createElement('span');heading.className='who';heading.textContent=role==='user'?'YOU':'MGADI';const p=document.createElement('span');p.textContent=message;b.append(heading,p);chat.append(b);while(chat.children.length>18)chat.firstElementChild.remove();chat.scrollTop=chat.scrollHeight;}
function addStreamingReply(){byId('placeholder')?.remove();const el=document.createElement('div');el.className='bubble assistant';const who=document.createElement('span');who.className='who';who.textContent='MGADI · LIVE';const value=document.createElement('span');el.append(who,value);chat.append(el);chat.scrollTop=chat.scrollHeight;return value;}
function gesture(phrase){const m=recognizeGesture(phrase);if(!m)return;if(gestureTimer)clearTimeout(gestureTimer);avatar.setGesture(m.key);byId('gesture').textContent=m.label;gestureTimer=setTimeout(()=>{avatar.setGesture('none');byId('gesture').textContent='READY';},3200);}
const guided=(message)=>{const m=recognizeGesture(message);const replies={stop:'Stop and verify changed payment instructions using an independently trusted number.',call:'If you already paid, contact the fraud department of your bank immediately using an official number.',save:'Keep the suspicious messages, invoices and proof of payment. Never send passwords or one time codes.',help:'I can help you follow the on-screen first-hour response guide. Have you already sent the payment?',check:'Confirm the supplier banking details using a trusted number you had before receiving the changed instructions.',protect:'Use official bank instructions to protect your accounts. Never share your PIN, password or one time code.'};return m?replies[m.key]:'I can guide you to stop, call, save, help, check or protect. For an urgent payment fraud, contact your bank first.';};
function endSpeech(){if(speaking&&'speechSynthesis' in window){speechSynthesis.cancel();speaking=null;}stop.hidden=true;avatar.setMood('idle');}
function speak(message){endSpeech();lastReply=message;byId('replay').disabled=false;if(!voice.checked){setPhase('Ready');return;}if(!('speechSynthesis' in window)){report('Speech playback is unavailable. Read the reply in the conversation.');return;}const u=new SpeechSynthesisUtterance(message);u.lang='en-ZA';u.rate=.94;const available=speechSynthesis.getVoices();u.voice=available.find(x=>x.lang.toLowerCase()==='en-za')||available.find(x=>x.lang.startsWith('en'))||null;u.onstart=()=>{if(speaking===u){setPhase('Speaking');report('Mgadi is reading its answer aloud.');}};u.onend=()=>{if(speaking===u){speaking=null;stop.hidden=true;setPhase('Ready');report('Ready. Speak again or type a message.');}};u.onerror=()=>{if(speaking===u){speaking=null;stop.hidden=true;setPhase('Ready');report('Speech playback was blocked. You can still read and type replies.');}};speaking=u;stop.hidden=false;setPhase('Speaking');speechSynthesis.speak(u);}
function stopMic(){listening=false;if(recognizer){const r=recognizer;recognizer=null;try{r.stop();}catch{}}mic.textContent='🎙 Speak';}
async function submit(value){const message=value.trim();if(!message||busy)return;if(!callActive)startSession();stopMic();endSpeech();busy=true;setPhase('Thinking');caption.hidden=false;caption.textContent='You: '+message;send.disabled=true;mic.disabled=true;add('user',message);gesture(message);text.value='';report(aiMode.checked?'Contacting Claude…':'Preparing guided reply…');let answer='',source='guided',streamed=false,spokenChars=0,streamSpeaking=false;
try{
 if(aiMode.checked){const access=token.value.trim();if(!access){report('Enter the AI demo password under Claude AI access, or turn Claude off for guided replies.');return;}
 const r=await fetch('/api/ai-chat',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','accept':'text/event-stream','x-mgadi-ai-test-token':access},body:JSON.stringify({text:message,history:history.slice(-8)})});let data={};
 if(r.ok&&r.headers.get('content-type')?.includes('text/event-stream')){
   streamed=true;const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',full='',final=false;
   const streamedReply=addStreamingReply();
   while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');let cut;
     while((cut=pending.indexOf('\n\n'))!==-1){const event=pending.slice(0,cut);pending=pending.slice(cut+2);
       const type=event.split('\n').find(x=>x.startsWith('event:'))?.slice(6).trim();
       const payload=event.split('\n').find(x=>x.startsWith('data:'))?.slice(5).trim();let obj={};try{obj=JSON.parse(payload)}catch{}
       if(type==='error')throw Error(obj.error||'stream_interrupted');
       if(type==='done')final=true;
       if(type==='delta'&&typeof obj.text==='string'){
         full+=obj.text;streamedReply.textContent=full;caption.textContent='Mgadi: '+full;chat.scrollTop=chat.scrollHeight;
          if(voice.checked&&'speechSynthesis' in window){
            const remainder=full.slice(spokenChars);const boundary=remainder.search(/[.!?](?=\s|$)/);
            if(boundary>=0){
              const sentence=remainder.slice(0,boundary+1).trim();spokenChars+=boundary+1;
              if(sentence){const u=new SpeechSynthesisUtterance(sentence);u.lang='en-ZA';u.rate=.94;
                u.onstart=()=>{speaking=u;setPhase('Speaking');report('Mgadi is answering aloud…');};
                u.onend=()=>{if(speaking===u)speaking=null;};
                speechSynthesis.speak(u);streamSpeaking=true;stop.hidden=false;
              }
            }
          }
         const match=recognizeGesture(full);if(match)gesture(match.word);
       }
     }
   }
   if(!final||!full.trim())throw Error('stream_interrupted');
   data={reply:full};
   if(streamSpeaking&&spokenChars<full.length&&voice.checked){
     const remainder=full.slice(spokenChars).trim();if(remainder){const u=new SpeechSynthesisUtterance(remainder);u.lang='en-ZA';u.rate=.94;
       u.onstart=()=>{speaking=u;setPhase('Speaking');};u.onend=()=>{if(speaking===u){speaking=null;stop.hidden=true;setPhase('Ready');}};
       speechSynthesis.speak(u);
     }
   }
 }else{try{data=await r.json();}catch{throw Error('The server did not return JSON.');}}
 if(!r.ok){const reasons={operator_required:'AI access password was not accepted. Check MGADI_AI_TEST_TOKEN in Vercel.',ai_not_configured:'Claude is not configured on the production server.',provider_busy:'Anthropic is rate-limited; try again later.',model_unavailable:'Claude model is not available for this account.',provider_auth_failed:'Anthropic rejected the API key; check the provider console.',ai_unavailable:'Claude could not answer. Check Anthropic account credits and model access.',ai_timeout:'Claude took too long; retry.'};throw Error(reasons[data.error]||('Claude returned HTTP '+r.status));}
 if(typeof data.reply!=='string'||!data.reply.trim())throw Error('Claude returned an empty response.');
 answer=data.reply;source='Claude';history.push({role:'user',text:message},{role:'assistant',text:answer});if(history.length>8)history.splice(0,history.length-8);
 }else{answer=guided(message);}
 if(!streamed)add('assistant',answer);gesture(answer);caption.textContent='Mgadi: '+answer;report(source+' replied.');if(streamSpeaking){lastReply=answer;byId('replay').disabled=false;}else speak(answer);
}catch(e){setPhase('Ready');const msg=e instanceof Error?e.message:'Unknown error';report(msg);add('assistant','Connection issue: '+msg+' You can turn off Claude AI to use the built-in guided responses.');}
finally{busy=false;send.disabled=false;mic.disabled=!Recognition;}
}
form.addEventListener('submit',e=>{e.preventDefault();submit(text.value);});
if(!Recognition){mic.disabled=true;mic.title='Voice recognition is not supported in this browser';byId('availability').textContent='Microphone recognition unavailable in this browser. Text chat still works.';}else{byId('availability').textContent='Browser speech recognition requires microphone permission and may use an online speech service.';}
mic.addEventListener('click',()=>{if(busy)return;if(listening){stopMic();return;}endSpeech();let r;try{if(!callActive)startSession();r=new Recognition();r.lang='en-ZA';r.continuous=false;r.interimResults=true;recognizer=r;r.onresult=e=>{let partial='';let done=false;for(let i=e.resultIndex;i<e.results.length;i++){partial+=e.results[i][0].transcript;done=done||e.results[i].isFinal;}text.value=partial;caption.hidden=false;caption.textContent='You: '+partial;gesture(partial);if(done&&partial.trim()){stopMic();submit(partial);}};r.onerror=e=>{stopMic();report('Microphone error: '+e.error+'. You can type your message below.');};r.onend=()=>{if(recognizer===r){stopMic();report('Microphone stopped. Type or tap Speak again.');}};r.start();listening=true;setPhase('Listening');mic.textContent='■ Stop listening';report('Listening… Speak a question.');}catch{stopMic();report('Could not start microphone. Type a message instead.');}});
stop.addEventListener('click',()=>{endSpeech();setPhase('Ready');report('Playback stopped.');});byId('replay').addEventListener('click',()=>{if(lastReply)speak(lastReply);});document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>{text.value=b.dataset.question;text.focus();}));
byId('clear').addEventListener('click',()=>{stopMic();endSpeech();history.length=0;lastReply='';byId('replay').disabled=true;caption.hidden=true;chat.replaceChildren();const p=document.createElement('p');p.id='placeholder';p.className='placeholder';p.textContent='Conversation cleared from this page.';chat.append(p);report('Conversation cleared.');});
document.querySelectorAll('[data-gesture]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.gesture;avatar.setGesture(key);byId('gesture').textContent=key.toUpperCase();}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopMic();avatar.pause();}else if(!reduced.matches)avatar.play();});
window.addEventListener('pagehide',()=>{stopMic();endSpeech();if(gestureTimer)clearTimeout(gestureTimer);avatar.destroy();},{once:true});
setPhase('Ready');report('Start a TalkBack call, then speak or type.');
