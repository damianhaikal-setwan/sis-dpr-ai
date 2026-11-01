# SIS-DPR AI — Diagnosis staging/produksi aman

## Apa yang terbukti dan belum

- Screenshot terakhir menunjukkan **HTTP 503** pada `https://sis-dpr-ai.damianhai.workers.dev/api/ai` dan pesan `OPENAI_API_KEY` tidak tersedia sebagai secret.
- ZIP `SIS-DPR-main.zip` yang ada di proyek **tidak berisi implementasi Asisten AI yang terlihat di screenshot**. Frontend produksi lebih baru dari ZIP, jadi format API nyata belum diverifikasi.
- Contoh Worker patch terdahulu memakai nama **`sis-dpr-ai-staging`**, bukan `sis-dpr-ai`; deployment staging **tidak** memperbarui produksi.
- Kode Worker produksi terbaru dan log Cloudflare belum tersedia. Karena itu diagnosis 503 **belum terkonfirmasi sepenuhnya**.

## Tidak ada perubahan yang dilakukan otomatis

Paket ini **hanya contoh Worker staging**. Tidak mengubah Supabase, aplikasi utama, atau Worker `sis-dpr-ai` produksi. Jangan mengganti Worker produksi utuh dengan contoh ini bila ada fitur, keamanan, atau API lain di Worker lama.

## Langkah 1 — Audit produksi terlebih dahulu (read-only)

1. Cloudflare dashboard → Workers & Pages → pilih `sis-dpr-ai` → **Deployments**: catat versi aktif dan sumber deploy GitHub/manual.
2. **Logs → Live**: kirim satu pertanyaan uji nonrahasia melalui SIS-DPR, lihat HTTP status, exception, pesan error; jangan kirim token/kunci atau isi prompt pegawai.
3. **Settings → Bindings**: pastikan Workers AI bernama `AI`. Jika Worker lama masih meminta `OPENAI_API_KEY`, kode produksi **masih memakai provider OpenAI**; memasang AI binding saja belum mengubah kode.
4. **Settings → Variables and Secrets**: periksa nama `SUPABASE_URL` dan `SUPABASE_ANON_KEY`/publishable key yang sesuai dengan kode; jangan pernah memakai `service_role` untuk memverifikasi user.
5. Periksa binding rate limiter `AI_RATE_LIMITER`, atau jika fungsi rate limiting ada di kode produksi, jangan hapus fungsi tersebut.
6. Buka aplikasi dengan DevTools → Network → filter `api/ai` → periksa **Request URL, method, Origin, Content-Type, keberadaan Authorization**, serta response status/code. **Jangan mengirim screenshot berisi nilai Authorization, key, cookie, atau isi data internal**.

## Langkah 2 — Uji endpoint diagnostik TANPA token

Periksa `GET /health` pada staging setelah deployed. Contoh Worker ini mengembalikan:

- `200` dan `checks: {"AI":true,"Supabase":true,"AI_RATE_LIMITER":true}` → binding dan variabel *terpasang* (bukan bukti AI generation berhasil).
- `503` + checks false → ada binding atau variabel yang hilang.
- `404` pada Worker produksi lama → /health belum diimplementasikan; bukan otomatis bukti Worker mati.
- `503` pada `/api/ai` dengan pesan OpenAI → kode lama masih active.
- `401` pada `/api/ai` tanpa token → endpoint hidup dan menolak pengguna yang tidak login (hasil yang benar).

Uji preflight:

```bash
curl -i -X OPTIONS 'https://ALAMAT_STAGING.workers.dev/api/ai' \
  -H 'Origin: https://sis-dpr.pages.dev' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Harus `204` dengan `Access-Control-Allow-Origin: https://sis-dpr.pages.dev`.

## Langkah 3 — Jalankan testing lokal

Dari folder ini (Node 20+), jalankan:

```bash
npm test
```

Test memalsukan respons Supabase dan Workers AI; **tidak menguji Cloudflare produksi/akun Anda**.

## Langkah 4 — Deploy staging SAJA

1. Ganti `SUPABASE_URL` dalam `wrangler.jsonc` dengan URL proyek Supabase asli (ini URL publik). Jangan memasukkan token rahasia ke file.
2. Periksa namespace ID `9382611` agar tidak berbagi counter rate limiting dengan Worker lain di akun yang sama, lalu ganti bila perlu.
3. Jalankan `npm install` (ketika ada koneksi ke registri npm) dan `npx wrangler login` jika belum login.
4. Jalankan `npx wrangler deploy` dari folder ini agar Worker staging dibuat. **PERIKSA nama Worker** yang tercetak sebelum deploy. Harus `sis-dpr-ai-staging`, bukan `sis-dpr-ai`.
5. Pasang publishable/anon key ke secret staging melalui `npx wrangler secret put SUPABASE_ANON_KEY --name sis-dpr-ai-staging`. Ini dapat membuat deployment versi baru secara otomatis; nama staging wajib diperiksa.
6. Buka `https://<SUBDOMAIN_AKUN>.workers.dev/health` berdasarkan alamat yang dicetak Wrangler; kemudian lakukan tes dari sesi login aplikasi melalui `frontend-integration-example.js` setelah disesuaikan dengan frontend asli.
7. Lihat log staging: `npx wrangler tail sis-dpr-ai-staging` atau Dashboard → Logs → Live.

Catatan: jika `wrangler secret put` membuat deploy Worker secara otomatis, lakukan itu hanya pada **nama staging**. Jangan menjalankan perintah yang mengarah ke `sis-dpr-ai` sebelum ada backup dan persetujuan rollout.

## Langkah 5 — Integrasi frontend produksi

Perlu periksa kode frontend TERBARU (bukan ZIP lama). Worker contoh menerima body `{"mode":"chat","message":"..."}` maupun field `question`, `prompt`, `text` dan menuntut header `Authorization: Bearer <access_token pengguna Supabase>`. Kode contoh frontend ada di `src/frontend-integration-example.js`. **Jangan menggunakan service-role key di frontend maupun token statis bersama.**

Setelah staging berhasil dengan akun uji, **baru** bandingkan route, format respons, dan autentikasi dengan Worker produksi yang sebenarnya. Merge bagian provider AI saja ke Worker asli (jangan overwrite seluruh file), test lagi dalam staging, backup versi produksi, lalu promote via deployment terkendali dan simpan opsi rollback. Karena kita belum memiliki Worker produksi yang sebenarnya, **tidak ada perintah promote produksi dalam paket ini**.

## Interpretasi error

| Kode/status | Arti | Tindakan |
|---|---|---|
| 401 AUTH_MISSING/AUTH_INVALID | Token Supabase belum dikirim atau kedaluwarsa | Periksa `supabase.auth.getSession()` pada frontend terkini |
| 403 ORIGIN_DENIED | Origin di luar allowlist | Cocokkan URL Pages tepat (scheme + hostname) |
| 429 RATE_LIMIT/AI_RATE_LIMIT | Limit rate atau kuota model AI | Lihat Analytics, kuota, dan error code |
| 503 AI_BINDING_MISSING | Binding `AI` hilang | Konfigurasi AI di Worker yang sama |
| 503 RATE_BINDING_MISSING | Binding rate limit hilang | Tambah di Wrangler/Dashboard sesuai namespace |
| 503 SUPABASE_NOT_CONFIGURED | URL/key Supabase tidak ada | Periksa Settings > Variables and Secrets |
| 502 SUPABASE_UNAVAILABLE | Layanan otentikasi tidak membalas atau error | Periksa Supabase Auth/logs dan URL |
| 502 AI_PROVIDER_ERROR | Cloudflare AI gagal / error upstream | Periksa Logs → Live tanpa mengungkap data sensitif |

## Sumber resmi
- https://developers.cloudflare.com/workers-ai/configuration/bindings/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/observability/logs/real-time-logs/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers-ai/platform/errors/

## Langkah tambahan: bandingkan staging dan produksi secara aman

Script read-only berikut hanya melakukan `GET /health` dan preflight `OPTIONS`. Tidak mengirim kredensial atau prompt:

```bash
node tools/diagnose-endpoints.mjs https://sis-dpr-ai.damianhai.workers.dev https://SUBDOMAIN_STAGING.workers.dev
```

Tidak adanya `/health` pada Worker lama dapat menghasilkan 404. Script tidak menggantikan log dashboard dan tidak pernah menyimpan token.
