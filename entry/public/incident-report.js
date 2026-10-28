// A portable readable companion to the original JSON integrity record.
export function downloadReadableReport(pack){
 const doc=document.implementation.createHTMLDocument('Mgadi incident report');doc.documentElement.lang='en';
 const meta=doc.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';doc.head.append(meta);
 const style=doc.createElement('style');style.textContent='body{font:16px/1.6 system-ui,sans-serif;color:#123954;max-width:760px;margin:0 auto;padding:24px}h1{line-height:1.2}h2{margin-top:28px;border-bottom:2px solid #008b89}article{padding:14px;border:1px solid #d4e4ea;border-radius:12px;margin:12px 0}code{display:block;overflow-wrap:anywhere;font-size:12px}p{white-space:pre-wrap;overflow-wrap:anywhere}.tag{color:#008b89;font-weight:700}@media print{body{padding:0}article{break-inside:avoid}}';doc.head.append(style);
 const add=(tag,text,parent=doc.body)=>{const node=doc.createElement(tag);node.textContent=text??'';parent.append(node);return node;};
 add('p','MGADI · INCIDENT RECORD').className='tag';add('h1','Your incident report');add('p',pack.incidentId);add('p','Created: '+new Date(pack.generatedAt).toLocaleString('en-ZA'));
 add('h2','What happened');add('p',pack.description);add('p','Working assessment: '+(pack.assessment?.title||pack.assessment?.label||'Not recorded'));
 add('h2','Bank feedback');add('p',pack.bank?.name||'Not selected');
 const states={not_reported:'Bank contact not confirmed',contacted:'You reported speaking to the bank',unreachable:'You reported being unable to reach the bank',not_applicable:'You reported that bank contact does not apply'};
 add('p',states[pack.bank?.contactStatus]||pack.bank?.contactStatus||'Not recorded');add('p','Reference: '+(pack.bank?.reference||'Not recorded'));add('p',pack.bank?.feedback||'No feedback recorded');
 add('h2','Evidence inventory');add('p','Original files are kept separately. This report contains their names and fingerprints.');
 for(const file of pack.evidence||[]){const item=add('article','');add('strong',file.name,item);add('p',Math.ceil(file.size/1024)+' KB · '+(file.type||'Unknown type'),item);add('code','SHA-256: '+file.sha256,item);}
 if(!pack.evidence?.length)add('p','No files recorded.');
 if(pack.missingEvidence){add('h2','Missing evidence / notes');add('p',pack.missingEvidence);}
 add('h2','Incident timeline');for(const item of pack.timeline||[])add('p',new Date(item.at).toLocaleString('en-ZA')+' — '+item.text);
 add('h2','Record integrity');add('code','JSON pack SHA-256: '+pack.fingerprint);add('p','This checksum belongs to the companion JSON pack. Keep that original JSON for verification. This readable report is not digitally signed. SHA-256 does not prove authenticity or confirm recovery.');add('p','Actions are user reported. Guide status: draft, practitioner review pending.');
 const url=URL.createObjectURL(new Blob(['<!doctype html>\n'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='mgadi-'+pack.incidentId+'-report.html';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
