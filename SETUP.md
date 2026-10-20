# CMH Barbers · puesta en marcha

Web de reservas: `index.html` (clientes) y `admin.html` (peluquero). Funciona con
GitHub Pages + Supabase. Sigue los pasos en orden.

## 1. Crear el proyecto en Supabase
1. Entra en https://supabase.com → **New project** (apunta la contraseña de la base de datos).
2. Cuando esté listo: **SQL Editor → New query**, pega TODO el contenido de `supabase/setup.sql` y pulsa **Run**.

## 2. Crear el usuario del peluquero
**Authentication → Users → Add user → Create new user**
- Email: `admin@cmhbarbers.com`  (en la web se entra escribiendo el usuario `admin`)
- Password: la contraseña de acceso que elegiste
- Marca **Auto Confirm User** y crea el usuario.

## 3. Conectar la web con Supabase
En Supabase: **Project Settings → API**. Copia **Project URL** y la clave **anon public**
y pégalas en `config.js` (`SUPABASE_URL` y `SUPABASE_ANON_KEY`).
Nunca uses la clave `service_role` en la web.

## 4. Subir a GitHub
1. Crea un repositorio nuevo en https://github.com/new (por ejemplo `cmh-barbers`).
2. Sube TODO el contenido de esta carpeta (arrastra los archivos a la página del repositorio → **Commit changes**),
   o por terminal:
   ```
   git init && git add . && git commit -m "CMH Barbers"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/cmh-barbers.git
   git push -u origin main
   ```
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos tendrás la web en `https://TU_USUARIO.github.io/cmh-barbers/`
   y el panel en `https://TU_USUARIO.github.io/cmh-barbers/admin.html`.

## 5. Permitir la web en Supabase
**Authentication → URL Configuration → Site URL** = la URL de tu GitHub Pages.

## 6. Notificaciones push (opcional pero recomendado)
1. En tu ordenador (con Node instalado): `npx web-push generate-vapid-keys`.
   Te da una clave **pública** y una **privada**.
2. Pega la clave **pública** en `config.js` (`VAPID_PUBLIC_KEY`) y vuelve a subir el archivo a GitHub.
3. En Supabase: **Edge Functions → Deploy a new function** (editor del navegador), nombre **`notify`**,
   pega el contenido de `supabase/notify.ts`, **desactiva "Verify JWT"** y despliega.
4. **Edge Functions → Secrets** (Manage secrets) y añade:
   - `VAPID_PUBLIC_KEY` = la clave pública
   - `VAPID_PRIVATE_KEY` = la clave privada (solo aquí, nunca en GitHub)
   - `VAPID_SUBJECT` = `mailto:tu-correo@ejemplo.com`
5. Abre `admin.html` en el móvil del peluquero, entra y pulsa **Activar notificaciones**.
   - **Android**: Chrome → menú → «Instalar aplicación» (recomendado).
   - **iPhone**: Safari → Compartir → «Añadir a pantalla de inicio», abre el panel desde ese icono y activa los avisos.

## Ajustes rápidos (`config.js`)
- `OPEN_HOUR`, `CLOSE_HOUR`, `STEP_MIN`: horas y duración de cada hueco del calendario admin.
- `DAYS_AHEAD`: días vista para los clientes.

## Si no llegan las notificaciones
1. En `admin.html` (con sesión iniciada) pulsa **Enviar prueba** (aparece cuando las notificaciones están activadas). El mensaje te dice qué falla:
   - *No se pudo llamar a la función «notify»* → la función no está desplegada con ese nombre, o tiene **Verify JWT activado** (desactívalo).
   - *Faltan los secretos / claves VAPID no válidos* → revisa los 3 secretos. `VAPID_SUBJECT` debe empezar por `mailto:` (ej. `mailto:tucorreo@gmail.com`). La pública y la privada deben ser la pareja generada junta.
   - *No hay ningún dispositivo suscrito* → pulsa «Activar notificaciones».
   - *El servicio push respondió 401/403* → la clave pública de `config.js` no coincide con la de Supabase. Corrígela, sube `config.js`, y en el panel pulsa **Desactivar** y luego **Activar** otra vez.
2. Si la prueba llega pero las de citas no: Supabase > Edge Functions > notify > Logs, mientras haces una reserva de prueba.
3. Revisa que el navegador/sistema permita notificaciones para esa web (en Android: Ajustes > Apps > Chrome > Notificaciones).

## Sedes (Badajoz / Barcarrota)
- Si ya tenías la base de datos creada, ejecuta `supabase/migracion-sedes.sql` en el SQL Editor (las horas antiguas quedan en Badajoz).
- Si la creas desde cero, `supabase/setup.sql` ya incluye las sedes.
- Vuelve a desplegar la función `notify` con el nuevo `supabase/notify.ts` (el aviso incluye la sede).
