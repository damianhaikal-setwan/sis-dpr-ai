# Cloudflare Worker AI SIS-DPR

- Konfigurasi Supabase URL dan **publishable key publik** telah dipasang di `wrangler.jsonc` **dan** fallback di `src/index.js`. Fallback diperlukan apabila menempel kode melalui editor Cloudflare, yang tidak memakai variabel dari file Wrangler.
- `OPENAI_API_KEY` **tidak ada dalam paket** dan wajib diatur sebagai Secret milik Anda. Jangan menyalinnya ke GitHub atau kode website.
- Binding `AI_RATE_LIMITER` wajib tersedia. Deploy via Wrangler menggunakan `wrangler.jsonc` agar binding tercipta otomatis.
- `GET /health` mengembalikan status konfigurasi (boolean saja), tanpa menampilkan nilai kunci; `ok:true` **tidak membuktikan** autentikasi ataupun panggilan AI sudah berhasil.
- Endpoint POST `/api/ai` hanya untuk pengguna Supabase aktif melalui JWT, dengan RLS dan izin asal `https://sis-dpr.pages.dev`.
