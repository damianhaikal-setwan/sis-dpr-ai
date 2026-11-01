import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const origin = 'https://sis-dpr.pages.dev';
const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-publishable-key',
  AI: { run: async (_model, _args) => ({ response: 'Renstra menetapkan arah strategis; Renja merinci kegiatan tahunan; DPA mengesahkan pelaksanaan anggaran.' }) },
};
const request = (body, headers = {}) => new Request('https://sis-dpr-ai-staging.workers.dev/api/ai', {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('GET /health reports AI binding', async () => {
  const r = await worker.fetch(new Request('https://example.workers.dev/health'), env);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.provider, 'cloudflare-workers-ai');
  assert.equal(d.ok, true);
});

test('CORS preflight allows SIS-DPR', async () => {
  const r = await worker.fetch(new Request('https://example.workers.dev/api/ai', {method:'OPTIONS', headers: {origin}}),env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), origin);
});

test('Foreign origin is rejected', async () => {
  const r = await worker.fetch(request({message:'Hi'},{origin:'https://evil.example'}),env);
  assert.equal(r.status, 403);
});

test('Unauthenticated user is rejected', async () => {
  const r = await worker.fetch(request({message:'Apa itu DPA?'}),env);
  assert.equal(r.status, 401);
});

test('Authenticated AI request returns answer', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    assert.equal(opts.headers.apikey, 'test-publishable-key');
    assert.equal(opts.headers.Authorization, 'Bearer mock-user-token');
    return new Response(JSON.stringify({id:'user-1'}),{status:200});
  };
  try {
    const r = await worker.fetch(request({mode:'chat',message:'Jelaskan Renstra, Renja dan DPA'},{authorization:'Bearer mock-user-token'}),env);
    const d = await r.json();
    assert.equal(r.status,200);
    assert.match(d.answer,/Renstra/);
    assert.equal(d.response,d.answer);
    assert.equal(r.headers.get('access-control-allow-origin'),origin);
  } finally { globalThis.fetch = original; }
});

test('Missing AI binding returns explicit configuration error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}',{status:200});
  try {
    const r = await worker.fetch(request({question:'test'},{authorization:'Bearer valid'}), {...env,AI:undefined});
    assert.equal(r.status,503);
    assert.equal((await r.json()).code,'AI_BINDING_MISSING');
  } finally { globalThis.fetch = original; }
});
