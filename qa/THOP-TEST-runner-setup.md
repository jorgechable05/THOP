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
4. El proyecto de pruebas debe estar realmente vacío o usar correos sintéticos nuevos. El runner valida que SUPABASE_URL sea exactamente el proyecto THOP-TEST autorizado.
5. Si Supabase exige confirmación por correo al registrar usuarios, confirma esas cuentas de prueba antes de repetir la validación. No desactives protecciones de producción.

## Ejecutar

1. Abre **Actions → THOP-TEST authenticated acceptance → Run workflow**.
2. Selecciona la rama `dev/supabase-schema-alignment`.
3. Para credenciales nuevas, usa correos sintéticos distintos y contraseñas temporales exclusivas de QA. Activa `create_client_if_missing` y `create_admin_if_missing`. El signup del candidato de administrador crea deliberadamente un perfil CLIENTE; **no lo eleva automáticamente**. Después de confirmar la cuenta y revisar el ID generado, un operador autorizado debe promover solo ese perfil sintético a ADMIN dentro de THOP-TEST.
4. El runner distingue entre un registro aceptado sin sesión (posible confirmación de correo), errores de registro y errores de inicio de sesión. Nunca añadas contraseñas al repositorio ni al reporte.
5. Revisa el log y descarga el artefacto `thop-test-acceptance-report`.

## Alcance y límites

Este primer ejecutor cubre inicio de sesión independiente, rol/perfil inicial, autorización de una RPC administrativa y comprobaciones básicas de lectura directa. No ejecuta todavía todos los 25 casos de la matriz; en particular no hace pedidos, cambios de inventario, concurrencia ni rollback. No declara certificada la aplicación. Los casos deben permanecer pendientes hasta que existan pruebas específicas y evidencia real para cada uno.

Si el registro no entrega sesión por confirmación de correo, el resultado debe tratarse como bloqueado; no se debe interpretar como un fallo de RLS ni omitir la confirmación en producción.
