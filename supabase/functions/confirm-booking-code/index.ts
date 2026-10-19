import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const {requestId,code}=await req.json();
  if(!requestId||!/^\d{4}$/.test(String(code||'')))return json({error:'Introduce el código de 4 cifras.'},400);
  const env=(k:string)=>{const v=Deno.env.get(k);if(!v)throw new Error(`Falta configurar ${k}`);return v;};
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const {data:request,error}=await db.from('booking_codes').select('*').eq('id',requestId).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(error||!request)return json({error:'El código ha caducado. Solicita uno nuevo.'},400);
  if(request.attempts>=5){await db.from('booking_codes').delete().eq('id',requestId);return json({error:'Has agotado los intentos. Solicita un código nuevo.'},429);}
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(code)));
  const entered=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(entered!==request.code_hash){await db.from('booking_codes').update({attempts:request.attempts+1}).eq('id',requestId);return json({error:'El código no es correcto.'},400);}
  const {data:bookingId,error:bookErr}=await db.rpc('confirm_booking',{p_slot_id:request.slot_id,p_customer_name:request.customer_name,p_phone:request.phone,p_email:request.email});
  if(bookErr)return json({error:bookErr.message.includes('duplicate')?'Esta hora ya está reservada. Elige otra.':bookErr.message},409);
  await db.from('booking_codes').delete().eq('id',requestId);
  const pushUrl=`${env('SUPABASE_URL')}/functions/v1/notify-admin`;
  await fetch(pushUrl,{method:'POST',headers:{Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({bookingId})}).catch(()=>{});
  return json({ok:true,bookingId});
 }catch(e){console.error(e);return json({error:e instanceof Error?e.message:'No se pudo confirmar la cita.'},500);}
});
