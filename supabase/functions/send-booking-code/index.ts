import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const {slotId,name,phone,email}=await req.json();
    const customerName=String(name||'').trim(), customerPhone=String(phone||'').trim(), customerEmail=String(email||'').trim().toLowerCase();
    if(!slotId||customerName.length<3||!/^\+?[0-9 ()-]{7,18}$/.test(customerPhone)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))return json({error:'Revisa el nombre, el correo y el teléfono.'},400);
    const env=(key:string)=>{const v=Deno.env.get(key);if(!v)throw new Error(`Falta configurar ${key}`);return v;};
    const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
    const {count}=await db.from('booking_codes').select('id',{count:'exact',head:true}).eq('email',customerEmail).gt('created_at',new Date(Date.now()-15*60*1000).toISOString());
    if((count||0)>=3)return json({error:'Has solicitado varios códigos. Espera 15 minutos antes de volver a intentarlo.'},429);
    const {data:slot,error:slotErr}=await db.from('slots').select('id,starts_at').eq('id',slotId).gt('starts_at',new Date().toISOString()).maybeSingle();
    if(slotErr||!slot)return json({error:'Esta hora ya no está disponible.'},409);
    const {data:booking}=await db.from('bookings').select('id').eq('slot_id',slotId).maybeSingle();
    if(booking)return json({error:'Esta hora acaba de ser reservada. Elige otra.'},409);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%10000).padStart(4,'0');
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
    const codeHash=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data:request,error:saveErr}=await db.from('booking_codes').insert({slot_id:slotId,customer_name:customerName,phone:customerPhone,email:customerEmail,code_hash:codeHash,expires_at:new Date(Date.now()+10*60*1000).toISOString()}).select('id').single();
    if(saveErr)throw saveErr;
    const resendKey=env('RESEND_API_KEY'), from=env('EMAIL_FROM');
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[customerEmail],subject:'Tu código para reservar en CMH Barbers',text:`Hola ${customerName},\n\nTu código para confirmar la cita es ${code}.\nCaduca en 10 minutos.\n\nSi no has solicitado esta cita, puedes ignorar este correo.`})});
    if(!sent.ok){await db.from('booking_codes').delete().eq('id',request.id);const detail=await sent.text();console.error('Resend error',detail);throw new Error('No se pudo enviar el correo de verificación. Comprueba la API key y el dominio remitente de Resend.');}
    return json({requestId:request.id});
  }catch(e){console.error(e);return json({error:e instanceof Error?e.message:'No se pudo enviar el código.'},500);}
});
