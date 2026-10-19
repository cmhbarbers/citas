import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS' };
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const env=(k:string)=>{const v=Deno.env.get(k);if(!v)throw new Error(`Falta configurar ${k}`);return v;};
  if(req.headers.get('Authorization')!==`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`)return new Response('Unauthorized',{status:401,headers:cors});
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const {bookingId}=await req.json();
  const [{data:b},{data:subs}]=await Promise.all([db.from('bookings').select('customer_name,phone,slot:slots(starts_at)').eq('id',bookingId).single(),db.from('push_subscriptions').select('subscription')]);
  if(!b)return new Response('Booking missing',{status:404,headers:cors});
  webpush.setVapidDetails(env('VAPID_SUBJECT'),env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'));
  const start=(b.slot as {starts_at:string}).starts_at;
  const payload=JSON.stringify({title:'Nueva cita · CMH Barbers',body:`${b.customer_name} · ${new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}).format(new Date(start))}`,url:'/#admin'});
  await Promise.all((subs||[]).map(async row=>{try{await webpush.sendNotification(row.subscription,payload);}catch(e){if((e as {statusCode?:number}).statusCode===404||(e as {statusCode?:number}).statusCode===410)await db.from('push_subscriptions').delete().eq('endpoint',(row.subscription as {endpoint:string}).endpoint);}}));
  return new Response(JSON.stringify({ok:true}),{headers:{...cors,'Content-Type':'application/json'}});
 }catch(e){console.error(e);return new Response(JSON.stringify({error:e instanceof Error?e.message:'Push failed'}),{status:500,headers:{...cors,'Content-Type':'application/json'}});}
});
