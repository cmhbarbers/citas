# CMH Barbers · Reservas

Aplicación en español para publicar horas, reservar citas con código de verificación por correo y gestionar la agenda. Está hecha con React + Vite, Supabase y Resend. El cliente proporciona correo y teléfono: el código llega al correo y el peluquero ve ambos datos. Sin credenciales de Supabase, la web permite ver el diseño en modo demostración; en ese modo el código de prueba es `1234`, las citas se guardan solo en el navegador actual y el acceso de administrador permanece desactivado.

## 1. Crear el proyecto de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) y guarda su URL y la clave `anon` (publishable). La clave `service_role` es privada: nunca la pongas en `.env`, el código web o GitHub.
2. En **SQL Editor**, ejecuta los archivos `supabase/migrations/001_booking.sql`, `supabase/migrations/002_full_hour_slots.sql` y `supabase/migrations/003_email_verification.sql` en ese orden. Si ya ejecutaste las migraciones anteriores, ejecuta al menos la `003` para añadir el correo y actualizar la confirmación.
3. En **Authentication → Users**, crea el usuario administrador con correo `admin@cmhbarbers.local` y la contraseña que elegiste para el usuario `admin`.
4. En SQL Editor asigna el rol privado al usuario creado:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@cmhbarbers.local';
   ```

   El formulario de la web pide `admin` como usuario y lo convierte internamente en ese correo. Cambia la contraseña inicial por una propia y segura antes de poner la web en producción.

## 2. Configurar correo de verificación (Resend)

Resend es el servicio que enviará los correos desde la función segura de Supabase. **No hace falta instalar un programa ni poner la clave de Resend en la web.**

### A. Crear la cuenta y añadir tu dominio

1. Regístrate en [Resend](https://resend.com) y abre la sección **Domains**.
2. Pulsa **Add Domain** y escribe un dominio que sea tuyo, por ejemplo `cmhbarbers.es`. Si ya tienes dominio para la web, usa ese. Si todavía no tienes ninguno, tendrás que comprar uno para enviar correos desde una dirección propia; el plan gratis de Resend no incluye el registro del dominio.
3. Resend mostrará varios registros DNS (normalmente TXT y/o CNAME) con valores específicos para tu dominio. Déjala abierta: tendrás que copiarlos tal cual en el panel de la empresa donde compraste/gestionas el dominio.

### B. Añadir los registros DNS y verificar

1. Entra en la web de tu proveedor de dominio y busca **DNS**, **DNS records** o **Zona DNS**.
2. Añade cada registro que Resend te muestra: elige el mismo tipo (TXT/CNAME), copia el **Name/Host** y el **Value/Target**, y guarda los cambios. No inventes los valores ni copies los de otra guía: son únicos para tu dominio.
3. Si ya usas ese dominio para recibir correo, no borres ni sustituyas sus registros MX existentes. Añade solo lo que Resend te pide para el envío.
4. Vuelve a Resend y pulsa **Verify** (o el botón equivalente que aparece junto al dominio). Puede tardar un rato en detectar los cambios DNS. La meta es que el dominio figure como **Verified** y habilitado para enviar.

La [guía de dominios de Resend](https://resend.com/docs/dashboard/domains/introduction) explica la pantalla y los registros. Resend también ofrece verificación DNS automática con algunos proveedores compatibles.

### C. Crear la clave de envío

1. En Resend abre **API Keys** y pulsa **Create API Key**.
2. Ponle un nombre, por ejemplo `CMH Supabase`.
3. Si aparece la opción de permisos, selecciona **Sending access** y limita la clave al dominio que acabas de verificar.
4. Crea la clave y cópiala cuando Resend la muestre. Suele empezar por `re_`. Trátala como una contraseña: si cierras esa pantalla quizá no puedas volver a ver el mismo valor; puedes crear otra si la pierdes.

### D. Guardar la clave en Supabase

1. Abre tu proyecto en el [panel de Supabase](https://supabase.com/dashboard) y selecciona **Edge Functions → Secrets**. También puedes abrir directamente la página de secretos de Edge Functions de tu proyecto.
2. En **Add new secret**, escribe `RESEND_API_KEY` en **Key** y pega la clave que copiaste de Resend en **Value**.
3. Pulsa **Add another** y crea el segundo secreto:

   - **Key:** `EMAIL_FROM`
   - **Value:** `CMH Barbers <reservas@tudominio.com>` (cambia `tudominio.com` por el dominio que hayas verificado en Resend).

4. Pulsa **Save** para guardar los dos secretos. `EMAIL_FROM` es el remitente que verá el cliente; puedes cambiar `reservas` por otro nombre.

No pongas `RESEND_API_KEY` en `.env`, en variables `VITE_...`, ni en GitHub: queda guardada solo como secreto de Supabase. La [guía oficial de Supabase](https://supabase.com/docs/guides/functions/secrets) tiene los pasos para esta pantalla.

El plan gratuito actual de Resend tiene límite mensual y diario; consulta el [límite vigente](https://resend.com/pricing). El dominio puede tener un coste de registro independiente.

## 3. Ejecutar la web en tu ordenador

En PowerShell, abre la carpeta `cmh-barbers` y ejecuta:

```powershell
npm install
Copy-Item .env.example .env
```

Edita `.env` con la URL y clave `anon` de Supabase. Después instala Supabase CLI (o usa `npx supabase`) e inicia sesión y vincula el proyecto:

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase secrets set RESEND_API_KEY=re_... 'EMAIL_FROM=CMH Barbers <reservas@tudominio.com>'
npx supabase functions deploy send-booking-code
npx supabase functions deploy confirm-booking-code
npx supabase functions deploy notify-admin
npm run dev
```

El `project-ref` aparece en la URL del proyecto de Supabase. Las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están disponibles para las Edge Functions desde Supabase. `RESEND_API_KEY` y `EMAIL_FROM` se configuran como secretos de Supabase y solo los usa la función que envía el código.

## 4. Activar notificaciones push

Las notificaciones push requieren HTTPS, permiso del navegador y claves VAPID. Genera un par de claves con `npx web-push generate-vapid-keys`. En **Project Settings → Edge Functions → Secrets** (o con `npx supabase secrets set`) guarda `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT=mailto:tu-correo@ejemplo.com`. Pon solo la clave pública en `VITE_VAPID_PUBLIC_KEY` del `.env` local y en las variables del hosting. Abre la web desde el navegador del peluquero, inicia sesión en Admin y pulsa **Activar avisos**. El navegador puede suspender avisos si el usuario bloquea permisos o el dispositivo no tiene conexión.

## 5. Subir a GitHub

Puedes publicarla con **GitHub Desktop**, sin escribir comandos:

1. Instala [GitHub Desktop](https://desktop.github.com/) y entra con tu cuenta de GitHub.
2. En GitHub Desktop, abre **File → New repository**. Pon `cmh-barbers` como nombre y elige una carpeta local donde quieras guardar repositorios, por ejemplo `Documents\GitHub`. Pulsa **Create repository**.
3. En GitHub Desktop pulsa **Show in Explorer**. Se abrirá la carpeta nueva del repositorio.
4. En otra ventana del Explorador, abre la carpeta de esta web: `outputs\cmh-barbers`. Copia **todo lo que hay dentro** (incluidas las carpetas `public`, `src`, `supabase` y los archivos que empiezan por punto) y pégalo en la carpeta que abrió GitHub Desktop. Si pregunta si quieres reemplazar el README creado automáticamente, elige reemplazarlo por el README de CMH Barbers.
5. Vuelve a GitHub Desktop. Revisa la lista de cambios: debería incluir los archivos de la web. Confirma que `.env` **no** esté en la lista. El archivo `.env.example` sí puede subirse porque solo contiene nombres y valores de ejemplo.
6. En **Summary**, escribe `Crear reservas web CMH Barbers` y pulsa **Commit to main**.
7. Pulsa **Publish repository**. Elige si quieres que el repositorio sea privado. Para esta web puedes dejarlo privado; si más adelante quieres alojarla gratis con GitHub Pages, consulta primero las condiciones de visibilidad de GitHub Pages para tu plan.
8. Pulsa **Publish repository** otra vez. Cuando termine, usa **View on GitHub** para abrir la página del repositorio y comprobar que están `src`, `public`, `supabase` y `README.md`.

`.gitignore` excluye `.env`, `node_modules` y `dist`. No subas nunca la clave de Resend, la clave `service_role` de Supabase ni un archivo `.env`.

## 6. Publicar la web

Conecta el repositorio GitHub a Vercel o Netlify. Configura el comando de build `npm run build` y el directorio de salida `dist`. Añade `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_VAPID_PUBLIC_KEY` en la configuración de variables de entorno del hosting; vuelve a desplegar tras añadirlas. En Supabase, configura **Authentication → URL Configuration → Site URL** y las URLs permitidas del dominio publicado. La clave `anon` está diseñada para uso público con RLS; no configures la clave `service_role` en el hosting.

## Notas

- Las horas de la interfaz se muestran en la zona horaria local del dispositivo; el navegador guarda y transmite los instantes en UTC.
- Se ofrecen las 24 horas en punto, de 00:00 a 23:00. Empiezan todas desactivadas y el peluquero activa solo las horas que quiera para cada fecha desde el calendario.
- La política RLS solo expone horas futuras no reservadas. Las reservas se crean desde una Edge Function tras verificar el código enviado por Resend; una restricción única en `slot_id` evita doble reserva concurrente.
- Antes de abrir reservas al público, prueba la entrega del correo de verificación, el inicio de sesión admin y una notificación push desde el dominio HTTPS.
