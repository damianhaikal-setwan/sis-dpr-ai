// Safe endpoint checker: GET /health and OPTIONS /api/ai ONLY. No credentials or POST.
const bases=process.argv.slice(2);
if(bases.length===0){console.error('Usage: node tools/diagnose-endpoints.mjs https://YOUR-WORKER.workers.dev [https://STAGING.workers.dev]');process.exitCode=1;}
for(const supplied of bases){
 let base;try {const u=new URL(supplied);if(u.protocol!=='https:')throw Error('HTTPS only');base=u.origin;}
 catch {console.error('Alamat tidak valid atau bukan HTTPS');process.exitCode=1;continue;}
 console.log('\nWorker:',base);
 for(const t of [{name:'health',url:base+'/health',init:{method:'GET'}},{name:'preflight',url:base+'/api/ai',init:{method:'OPTIONS',headers:{Origin:'https://sis-dpr.pages.dev','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}}}]) {
  try{const r=await fetch(t.url,{...t.init,signal:AbortSignal.timeout(10000)});let code='';
   if(t.name==='health' && String(r.headers.get('content-type')||'').includes('json')) {
    const data=await r.json();code=String(data.code||'')+' checks='+JSON.stringify(data.checks||{});
   }
   console.log(t.name,'HTTP',r.status,'cors:',r.headers.get('access-control-allow-origin')||'(none)',code);
  }catch(e){console.log(t.name,'request failed:',e.name);}
 }
}
