import { generateAIResponse, DEFAULT_MODEL } from './ai-provider.js';
// Staging-only example. Integrasikan ke Worker produksi yang asli setelah audit.
const MAX_BODY_BYTES = 16000;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' };
const answer = (body, status, cors, requestId) => new Response(JSON.stringify({ ...body, request_id:requestId }), {
  status, headers:{ ...JSON_HEADERS, ...cors, 'x-request-id':requestId },
});
function allowedCors(request, env) {
  const origin = request.headers.get('Origin');
  const list = String(env.ALLOWED_ORIGIN || 'https://sis-dpr.pages.dev')
    .split(',').map(x=>x.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return null;
  return {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Access-Control-Max-Age':'600',
    'Vary':'Origin'};
}
function log(code, requestId, status) {
  // Never log Authorization headers, user prompts, Supabase keys, responses, or user details.
  console.info(JSON.stringify({ component:'sis-dpr-ai', request_id:requestId, code, status }));
}
async function boundedJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw Object.assign(new Error('TOO_LARGE'), {code:'TOO_LARGE'});
  if (!request.body) throw Object.assign(new Error('BAD_JSON'),{code:'BAD_JSON'});
  const reader = request.body.getReader();
  const chunks=[];let size=0;
  try {
    while(true) {
      const {value,done} = await reader.read();if(done)break;
      size += value.byteLength;
      if(size>MAX_BODY_BYTES) {await reader.cancel();throw Object.assign(new Error('TOO_LARGE'),{code:'TOO_LARGE'});}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw Object.assign(new Error('BAD_JSON'),{code:'BAD_JSON'});}
}
function questionFromBody(body) {
  for (const prop of ['message','question','prompt','text','input']) {
    if (typeof body?.[prop]==='string' && body[prop].trim())return body[prop].trim();
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = messages.filter(m=>m?.role==='user' && typeof m.content==='string').at(-1);
  return last?.content?.trim() || '';
}
async function validateUser(request,env) {
  const auth = request.headers.get('Authorization')||'';
  if (!/^Bearer\s+\S+$/i.test(auth)) return {code:'AUTH_MISSING'};
  if(!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || String(env.SUPABASE_URL).includes('GANTI_PROJECT'))return {code:'SUPABASE_NOT_CONFIGURED'};
  try {
    const res = await fetch(String(env.SUPABASE_URL).replace(/\/+$/,'')+'/auth/v1/user', {
      method:'GET', headers:{'apikey':env.SUPABASE_ANON_KEY,'Authorization':auth},
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401 || res.status===403) return {code:'AUTH_INVALID'};
    if(!res.ok)return {code:'SUPABASE_UNAVAILABLE'};
    const user = await res.json();
    if(!user?.id || typeof user.id!=='string')return {code:'AUTH_INVALID'};
    return {code:'OK', user_id:user.id};
  }catch {return {code:'SUPABASE_UNAVAILABLE'};}
}
function modelStatus(e) {
  const s=Number(e?.status ?? e?.statusCode ?? e?.response?.status);
  const errCode=String(e?.code || e?.cause?.code || '');
  if(s===429 || ['3036','3040'].includes(errCode))return [429,'AI_RATE_LIMIT'];
  if (e?.code==='AI_BINDING_MISSING')return [503,'AI_BINDING_MISSING'];
  return [502,'AI_PROVIDER_ERROR'];
}
export default {
  async fetch(request,env) {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get('Origin');
    const cors = allowedCors(request,env) || {};
    if(origin && !cors['Access-Control-Allow-Origin']) {
      log('ORIGIN_DENIED',requestId,403);return answer({ok:false,code:'ORIGIN_DENIED',error:'Origin tidak diizinkan'},403,{},requestId);
    }
    const url=new URL(request.url);
    if(url.pathname==='/health') {
      if(request.method!=='GET')return answer({ok:false,code:'METHOD_NOT_ALLOWED'},405,cors,requestId);
      // No test AI inference and no secret values in health checks.
      const aiReady=Boolean(env.AI && typeof env.AI.run==='function');
      const authReady=Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && !String(env.SUPABASE_URL).includes('GANTI_PROJECT'));
      const limiterReady=Boolean(env.AI_RATE_LIMITER && typeof env.AI_RATE_LIMITER.limit==='function');
      return answer({ok:aiReady&&authReady&&limiterReady, provider:'cloudflare-workers-ai',
        model:env.AI_MODEL||DEFAULT_MODEL, checks:{AI:aiReady, Supabase:authReady, AI_RATE_LIMITER:limiterReady}},
        aiReady&&authReady&&limiterReady?200:503,cors,requestId);
    }
    if(url.pathname!=='/api/ai')return answer({ok:false,code:'NOT_FOUND'},404,cors,requestId);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors, 'x-request-id':requestId}});
    if(request.method!=='POST')return answer({ok:false,code:'METHOD_NOT_ALLOWED'},405,cors,requestId);
    if(!String(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json'))
      return answer({ok:false,code:'CONTENT_TYPE_INVALID'},415,cors,requestId);
    const auth=await validateUser(request,env);
    if(auth.code!=='OK') {
      const status=auth.code==='SUPABASE_NOT_CONFIGURED'?503:auth.code==='SUPABASE_UNAVAILABLE'?502:401;
      log(auth.code,requestId,status);return answer({ok:false,code:auth.code,error:status===401?'Login SIS-DPR diperlukan.':'Layanan autentikasi belum siap.'},status,cors,requestId);
    }
    if(!env.AI || typeof env.AI.run!=='function') {
      log('AI_BINDING_MISSING',requestId,503);
      return answer({ok:false,code:'AI_BINDING_MISSING',error:'Workers AI binding belum tersedia.'},503,cors,requestId);
    }
    if(!env.AI_RATE_LIMITER || typeof env.AI_RATE_LIMITER.limit!=='function') {
      log('RATE_BINDING_MISSING',requestId,503);
      return answer({ok:false,code:'RATE_BINDING_MISSING',error:'AI rate limiter belum tersedia.'},503,cors,requestId);
    }
    let body;
    try {body=await boundedJson(request);}
    catch(e) {const tooLarge=e?.code==='TOO_LARGE';return answer({ok:false,code:tooLarge?'TOO_LARGE':'BAD_JSON'},tooLarge?413:400,cors,requestId);}
    if(!body || typeof body!=='object' || Array.isArray(body))return answer({ok:false,code:'BAD_JSON'},400,cors,requestId);
    const q=questionFromBody(body);
    if(!q || q.length>4000)return answer({ok:false,code:'INVALID_QUESTION',error:'Pertanyaan harus 1-4000 karakter.'},400,cors,requestId);
    try {
      const { success } = await env.AI_RATE_LIMITER.limit({key:'ai:'+auth.user_id});
      if(!success) {log('RATE_LIMIT',requestId,429);return answer({ok:false,code:'RATE_LIMIT',error:'Terlalu banyak permintaan. Coba lagi nanti.'},429,cors,requestId);}
      const output=await generateAIResponse(env,q,body.messages ?? body.history ?? []);
      log('OK',requestId,200);
      // Multiple aliases for compatibility, but VERIFY with the actual production frontend before rollout.
      return answer({ok:true,provider:'cloudflare-workers-ai',answer:output,reply:output,response:output,text:output,data:{answer:output}},200,cors,requestId);
    } catch(e) {
      const [status,code]=modelStatus(e);
      log(code,requestId,status);
      return answer({ok:false,code,error:status===429?'Kuota atau kapasitas AI sedang dibatasi.':'Layanan AI gagal memproses permintaan.'},status,cors,requestId);
    }
  }
};
