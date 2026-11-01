/** EXAMPLE ONLY. Adapt to the currently deployed frontend. Never include service-role key. */
export async function askSisDprAI(supabase, question, endpoint='https://sis-dpr-ai-staging.<YOUR_SUBDOMAIN>.workers.dev/api/ai') {
  const { data, error } = await supabase.auth.getSession();
  if(error || !data?.session?.access_token)throw new Error('Silakan login ke SIS-DPR terlebih dahulu.');
  const res=await fetch(endpoint, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
    body:JSON.stringify({mode:'chat',message:question}),
  });
  const body=await res.json().catch(()=>({code:'INVALID_RESPONSE'}));
  if(!res.ok)throw new Error(`${body.code||'HTTP_'+res.status}: ${body.error||'Layanan AI tidak tersedia.'}`);
  return body.answer;
}
