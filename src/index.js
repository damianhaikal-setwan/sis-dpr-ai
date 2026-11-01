import { generateAIResponse, DEFAULT_MODEL } from './ai-provider.js';

/* Contoh Worker mandiri: uji di staging sebelum mengganti Worker SIS-DPR produksi.
 * Endpoint: POST /api/ai, GET /health
 * Autentikasi: access_token Supabase pada header Authorization: Bearer ...
 */
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || 'https://sis-dpr.pages.dev')
    .split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

async function validateSupabaseUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(auth)) return false;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    const e = new Error('Konfigurasi validasi Supabase belum tersedia.');
    e.code = 'SUPABASE_NOT_CONFIGURED';
    throw e;
  }
  const endpoint = `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1/user`;
  const response = await fetch(endpoint, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
    signal: AbortSignal.timeout(8000),
  });
  return response.ok;
}

function pickText(body) {
  const v = [body?.message, body?.question, body?.prompt, body?.text, body?.input]
    .find((x) => typeof x === 'string' && x.trim());
  if (v) return v;
  const last = Array.isArray(body?.messages)
    ? body.messages.filter((m) => m?.role === 'user' && typeof m.content === 'string').at(-1)
    : null;
  return last?.content || '';
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get('origin');
    const allowOrigin = Object.hasOwn(cors, 'Access-Control-Allow-Origin');
    if (origin && !allowOrigin) return json({ ok: false, error: 'Origin tidak diizinkan.' }, 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    const { pathname } = new URL(request.url);
    if (pathname === '/health' && request.method === 'GET') {
      return json({ ok: Boolean(env.AI), provider: 'cloudflare-workers-ai', model: env.AI_MODEL || DEFAULT_MODEL }, 200, cors);
    }
    if (pathname !== '/api/ai') return json({ ok: false, error: 'Endpoint tidak ditemukan.' }, 404, cors);
    if (request.method !== 'POST') return json({ ok: false, error: 'Metode tidak diperbolehkan.' }, 405, cors);
    if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'Kirim body sebagai application/json.' }, 415, cors);
    }
    if (Number(request.headers.get('content-length') || 0) > 12000) {
      return json({ ok: false, error: 'Permintaan terlalu panjang.' }, 413, cors);
    }
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'JSON tidak valid.' }, 400, cors); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 12000) {
      return json({ ok: false, error: 'Format permintaan tidak valid atau terlalu panjang.' }, 400, cors);
    }
    const question = pickText(body);
    if (!String(question).trim() || String(question).length > 4000) {
      return json({ ok: false, error: 'Pertanyaan wajib diisi (maksimal 4000 karakter).' }, 400, cors);
    }
    try {
      const authenticated = await validateSupabaseUser(request, env);
      if (!authenticated) return json({ ok: false, error: 'Harap login SIS-DPR terlebih dahulu.' }, 401, cors);
      const answer = await generateAIResponse(env, question, body.messages || body.history || [], body.context || '');
      // Multiple field aliases help adapters, but response shape MUST be checked against current frontend.
      return json({ ok: true, provider: 'cloudflare-workers-ai', answer, reply: answer, response: answer, text: answer, data: { answer } }, 200, cors);
    } catch (error) {
      if (error?.code === 'AI_BINDING_MISSING' || error?.code === 'SUPABASE_NOT_CONFIGURED') {
        return json({ ok: false, error: error.message, code: error.code }, 503, cors);
      }
      console.error('Workers AI request failed:', error?.name || 'Error');
      return json({ ok: false, error: 'Layanan AI belum tersedia. Periksa Workers AI, kuota, dan Worker logs.' }, 502, cors);
    }
  },
};
