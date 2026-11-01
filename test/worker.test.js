import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const origin='https://sis-dpr.pages.dev';
const base={
 ALLOWED_ORIGIN:origin,
 SUPABASE_URL:'https://sisdpr-test.supabase.co', SUPABASE_ANON_KEY:'public-test-key',
 AI:{run: async () => ({response:'Renstra → Renja → DPA'})},
 AI_RATE_LIMITER:{limit: async ()=>({success:true})}
};
const req=(body,headers={})=>new Request('https://sis-dpr-ai-staging.test/api/ai',{
 method:'POST',headers:{'Origin':origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const auth={'Authorization':'Bearer valid-test-token'};
const realFetch=globalThis.fetch;
function mockAuth(t,ret={status:200,body:{id:'test-user'}}) {
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  assert.match(url,/auth\/v1\/user$/);assert.equal(opts.headers.apikey,'public-test-key');
  assert.equal(opts.headers.Authorization,'Bearer valid-test-token');
  return Response.json(ret.body,{status:ret.status});
 };
 t.after(()=>{globalThis.fetch=original});
}
test('health ready when bindings and auth variables exist',async()=>{
 const r=await worker.fetch(new Request('https://stage.test/health'),base); const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.ok,true);assert.equal(d.checks.AI,true);
});
test('health 503 if limiter is missing, and does not expose secrets',async()=>{
 const r=await worker.fetch(new Request('https://stage.test/health'),{...base,AI_RATE_LIMITER:null});
 assert.equal(r.status,503);const t=await r.text();assert.doesNotMatch(t,/public-test-key/);
});
test('CORS preflight allowed, no token required',async()=>{
 const r=await worker.fetch(new Request('https://stage.test/api/ai',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Headers':'authorization,content-type'}}),base);
 assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
});
test('CORS rejects unrelated origins',async()=>{
 const r=await worker.fetch(req({message:'Test'},{Origin:'https://evil.example',...auth}),base);assert.equal(r.status,403);
});
test('missing token => 401 (not 503)',async()=>{
 const r=await worker.fetch(req({message:'Apa itu Renja?'}),base);assert.equal(r.status,401);assert.equal((await r.json()).code,'AUTH_MISSING');
});
test('expired token => 401',async(t)=>{
 mockAuth(t,{status:401,body:{error:'JWT expired'}});
 const r=await worker.fetch(req({message:'Apa itu Renja?'},auth),base);
 assert.equal(r.status,401);assert.equal((await r.json()).code,'AUTH_INVALID');
});
test('missing Supabase configuration => 503',async()=>{
 const r=await worker.fetch(req({message:'Apa itu DPA?'},auth),{...base,SUPABASE_URL:''});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'SUPABASE_NOT_CONFIGURED');
});
test('AI binding absent => 503 after auth',async(t)=>{
 mockAuth(t);
 const r=await worker.fetch(req({message:'Apa itu DPA?'},auth),{...base,AI:null});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'AI_BINDING_MISSING');
});
test('AI_RATE_LIMITER absent => 503 after auth',async(t)=>{
 mockAuth(t);const r=await worker.fetch(req({message:'Apa itu DPA?'},auth),{...base,AI_RATE_LIMITER:null});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'RATE_BINDING_MISSING');
});
test('rate limited => 429',async(t)=>{
 mockAuth(t);
 const r=await worker.fetch(req({message:'Apa itu DPA?'},auth),{...base,AI_RATE_LIMITER:{limit:async()=>({success:false})}});
 assert.equal(r.status,429);assert.equal((await r.json()).code,'RATE_LIMIT');
});
test('valid authenticated request => JSON answer',async(t)=>{
 mockAuth(t);
 const r=await worker.fetch(req({mode:'chat',message:'Hubungan Renstra, Renja dan DPA'},auth),base);
 const d=await r.json();assert.equal(r.status,200);assert.equal(d.answer,'Renstra → Renja → DPA');assert.equal(d.ok,true);
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
});
test('Workers AI upstream outage => 502 and no raw exception',async(t)=>{
 mockAuth(t);
 const r=await worker.fetch(req({message:'Sapa'},auth),{...base,AI:{run:async()=>{throw new Error('upstream_secret_or_internal_detail')}}});
 assert.equal(r.status,502);const txt=await r.text();assert.doesNotMatch(txt,/upstream_secret_or_internal_detail/);
});
test('bad JSON input => 400',async(t)=>{
 mockAuth(t);
 const r=await worker.fetch(new Request('https://stage.test/api/ai',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...auth},body:'{bad'}),base);
 assert.equal(r.status,400);
});
