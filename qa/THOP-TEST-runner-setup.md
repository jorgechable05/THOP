# Configurar el ejecutor autenticado de THOP-TEST

El flujo `.github/workflows/thop-test-authenticated.yml` es manual y solo debe ejecutarse contra el proyecto de pruebas `xodufvmosjtpbamqnqkw`. No despliega ni modifica código de producción.

## Requisitos previos

1. En GitHub, abre **Settings → Environments** y crea el entorno `THOP-TEST` si todavía no existe.
2. Añade estos **Environment secrets** al entorno `THOP-TEST`:
   - `THOP_TEST_SUPABASE_URL`: URL de Supabase del proyecto de pruebas.
   - `THOP_TEST_SUPABASE_PUBLISHABLE_KEY`: clave pública publishable de ese mismo proyecto.
   - `THOP_TEST_ADMIN_EMAIL`: correo de una cuenta existente en THOP-TEST con perfil de rol `ADMIN`.
   - `THOP_TEST_ADMIN_PASSWORD`: contraseña temporal exclusiva para QA de esa cuenta.
   - `THOP_TEST_CLIENT_EMAIL`: correo reservado para un usuario sintético de pruebas, distinto del administrador y de clientes reales.
   - `THOP_TEST_CLIENT_PASSWORD`: contraseña temporal exclusiva para la cuenta sintética.
3. No uses una clave `service_role` o `sb_secret_*`. No pongas credenciales en el repositorio, en los inputs del workflow ni en los informes.
4. Si Supabase exige confirmación por correo al registrar usuarios, crea/verifica el usuario sintético según la configuración de Auth de THOP-TEST antes de ejecutar, o usa el modo de registro permitido por el proyecto de pruebas. No desactives protecciones de producción.

## Ejecutar

1. Abre **Actions → THOP-TEST authenticated acceptance → Run workflow**.
2. Selecciona la rama `dev/supabase-schema-alignment`.
3. Deja activada la opción de registrar al cliente sintético si debe crearse por primera vez. Si ya existe y su contraseña corresponde al secreto configurado, el runner intentará iniciar sesión cuando el registro no entregue una sesión.
4. Revisa el log y descarga el artefacto `thop-test-acceptance-report`.

## Alcance y límites

Este primer ejecutor cubre inicio de sesión independiente, rol/perfil inicial, autorización de una RPC administrativa y comprobaciones básicas de lectura directa. No ejecuta todavía todos los 25 casos de la matriz; en particular no hace pedidos, cambios de inventario, concurrencia ni rollback. No declara certificada la aplicación. Los casos deben permanecer pendientes hasta que existan pruebas específicas y evidencia real para cada uno.

Si el registro no entrega sesión por confirmación de correo, el resultado debe tratarse como bloqueado; no se debe interpretar como un fallo de RLS ni omitir la confirmación en producción.
