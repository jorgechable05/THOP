# THOP — matriz de aceptación (THOP-TEST)

**Entorno permitido:** Supabase project `xodufvmosjtpbamqnqkw` (THOP-TEST), rama GitHub `dev/supabase-schema-alignment`.
**Producción:** no ejecutar pruebas ni desplegar.
**Estado actual:** los 25 escenarios de esta matriz se ejecutaron contra datos sintéticos en THOP-TEST. La ejecución #40218852363 tuvo 31 aserciones automatizadas PASS; la prueba inicial de alta nueva y valores por defecto quedó evidenciada en #40218105884. No se usaron clientes ni datos reales.
**Evidencia principal:** [Ejecución autenticada #40218652204](https://github.com/jorgechable05/THOP/actions/runs/40218852363) · [CI estático](https://github.com/jorgechable05/THOP/actions/runs/40218852238) · [Informe JSON (artefacto)](https://github.com/jorgechable05/THOP/actions/runs/40218852363/artifacts/12608344205).

**Nota:** APROBADO significa que el criterio fue observado en la suite automatizada con sesiones JWT separadas y datos sintéticos. La certificación global de liberación permanece pendiente de revisión de seguridad y aprobación del PR.

| # | Caso | Criterio de aceptación | Resultado |
|---:|---|---|---|
| 1 | Registro nuevo | Perfil creado como CLIENTE / PUBLICO / PENDIENTE | APROBADO |
| 2 | Autopromoción a MAYORISTA | Usuario no puede cambiar su propio tipo | APROBADO |
| 3 | Autopromoción a ADMIN | Usuario no puede cambiar su rol | APROBADO |
| 4 | Precio PUBLICO | Se calcula precio público en servidor | APROBADO |
| 5 | Precio MINORISTA | Cliente minorista obtiene su tarifa | APROBADO |
| 6 | Precio MAYORISTA | Cliente mayorista obtiene su tarifa | APROBADO |
| 7 | Precio especial | Precio vigente por cliente/producto tiene prioridad | APROBADO |
| 8 | Leer costo como cliente | Lectura denegada/no se expone columna | APROBADO |
| 9 | Leer lotes como cliente | Lectura denegada | APROBADO |
| 10 | Leer caducidad como cliente | Lectura denegada | APROBADO |
| 11 | Pedido normal | Pedido y movimientos se confirman de forma atómica | APROBADO |
| 12 | Lote caducado | No se utiliza para completar el pedido | APROBADO |
| 13 | Stock insuficiente | Pedido falla y no deja cambios parciales | APROBADO |
| 14 | Dos pedidos simultáneos | Sin sobreventa ni stock negativo | APROBADO |
| 15 | Rollback de compra | Error intermedio no deja compra/lote/movimiento parcial | APROBADO |
| 16 | Cambio de precio | Nuevo precio se aplica a pedidos posteriores | APROBADO |
| 17 | Precio histórico | Detalle conserva el precio unitario original | APROBADO |
| 18 | Recepción de compra | Crea lote con cantidades/costo/caducidad correctos | APROBADO |
| 19 | Movimiento de compra | Recepción registra movimiento de inventario | APROBADO |
| 20 | Reportes administrativos | Solo ADMIN accede a datos administrativos | APROBADO |
| 21 | Editar otro perfil | Cliente no modifica perfil ajeno | APROBADO |
| 22 | Modificar producto como cliente | Escritura denegada | APROBADO |
| 23 | Invocar RPC administrativa | Usuario cliente recibe denegación | APROBADO |
| 24 | Dos pedidos del último lote | Solo una transacción obtiene las últimas unidades | APROBADO |
| 25 | Cambio PUBLICO → MAYORISTA por admin | Solo admin cambia tipo y precio efectivo cambia correctamente | APROBADO |

## Evidencia observada en la ejecución #40218652204
- #1 Alta por Supabase Auth con perfil CLIENTE/PUBLICO/PENDIENTE: primera alta de la cuenta sintética confirmada en #40218105884 y perfil verificado nuevamente en #40218652204.
- #2–#3 Autopromoción de tipo y rol bloqueada; se verificó que el perfil quedó CLIENTE/PUBLICO.
- #4–#7 Precios PUBLICO/MINORISTA/MAYORISTA calculados por servidor y precio especial con prioridad (10.00 / 8.00 / 6.00 / 4.25).
- #8–#10 Lecturas de costo/precio mayorista, existencias de lote, perfiles ajenos y caducidad denegadas o filtradas.
- #11–#13 Pedido atómico, lote caducado y stock insuficiente: las transacciones fallidas no dejaron filas ni cambios parciales.
- #14 y #24 Dos pedidos simultáneos por cuatro unidades contra stock cinco: exactamente uno confirmó y quedó una unidad.
- #15 Compra con segundo artículo inválido: se revirtió todo; los conteos de compras, detalles, lotes y movimientos no cambiaron.
- #16–#17 Precio nuevo aplicado a pedidos posteriores y precio de pedido histórico preservado.
- #18–#19 Recepción de compra creó compra, detalle, lote, stock y movimiento ENTRADA_COMPRA.
- #20 y #23 RPC de reporte administrativa permitido al administrador y denegado al cliente.
- #21–#22 Cliente no pudo modificar otro perfil ni productos.

## Límites
- Los productos, lotes, compras y pedidos de esta ejecución están identificados con el prefijo THOP-QA y pertenecen al entorno de pruebas.
- La suite prueba las rutas de base de datos/RPC y las restricciones de permisos. No sustituye revisión independiente de reglas de negocio no incluidas en la matriz, pruebas de interfaz de usuario ni aprobación de liberación.
- La certificación global permanece pendiente hasta revisar las alertas del asesor de seguridad de Supabase y aprobar deliberadamente el PR.


## Revisión de seguridad adicional — 2026-10-25

**Entorno:** solo THOP-TEST (`xodufvmosjtpbamqnqkw`). No se modificó producción.

### Hallazgos del Security Advisor

- `authenticated_security_definer_function_executable`: 16 funciones en el esquema expuesto `public` tienen `SECURITY DEFINER` y pueden ejecutarse por usuarios autenticados. El aviso es de revisión de exposición, no prueba por sí solo un bypass de autorización.
- `auth_leaked_password_protection`: Supabase Auth indica que la protección de contraseñas filtradas está deshabilitada. Esta opción debe habilitarse desde la configuración de Auth del panel del proyecto; no se afirma que esté habilitada.

### Resultados de inspección SQL

- Las funciones administrativas revisadas (`admin_list_inventory_summary`, `admin_list_lots`, `admin_list_orders`, `admin_list_products`, `admin_list_profiles`, `admin_list_special_prices`, `admin_list_suppliers`, `admin_set_product_visibility`, `admin_update_customer_type`, `admin_update_order_status`, `admin_update_product`, `admin_update_special_prices` y `receive_purchase_atomic`) fijan `search_path` y validan usuario autenticado/administrador con `private.is_admin()` antes de leer o modificar datos administrativos.
- `catalog_price` requiere usuario autenticado, cuenta activa y producto publicado; calcula el precio por tipo de cliente y precio especial. Es una RPC del flujo de catálogo/pedido y no debe revocarse sin reemplazar el contrato y repetir aceptación.
- `create_order_atomic` exige usuario autenticado con perfil CLIENTE activo y crea pedido/transacciones de inventario de forma atómica. Debe seguir disponible para clientes; no se debe quitar `EXECUTE` indiscriminadamente.
- `current_profile` exige una identidad autenticada y devuelve únicamente el perfil cuyo id coincide con `auth.uid()`.
- Las funciones auxiliares de trigger `guard_profile_privileges` y `handle_new_user` no son ejecutables por `authenticated` en la ACL observada; `private_is_admin` tampoco tiene ejecución directa concedida a ese rol. La función privada `private.is_admin()` sí figura en el esquema `private` y no debe exponerse por una revocación/cambio indiscriminado.
- Todas las funciones `SECURITY DEFINER` observadas tenían un `search_path` explícito. Se requiere mantenerlo y revisar de forma manual el contrato de cada función antes de cualquier cambio de permisos.
- No se aplicaron cambios de DDL ni se modificaron ACL durante esta inspección; no se ocultaron avisos cambiando RLS.

### Cierre pendiente

1. Habilitar la protección contra contraseñas filtradas en **Authentication → Settings / Password Security** del panel de THOP-TEST y volver a ejecutar Security Advisor.
2. Ejecutar pruebas negativas de JWT de cliente sobre cada RPC administrativa y confirmar que la suite de pedidos/catálogo sigue pasando antes de alterar cualquier permiso.
3. Después de cualquier corrección, volver a ejecutar la suite autenticada y CI estático, guardar evidencia nueva y revisar el Advisor otra vez.

**Estado:** aceptación funcional automatizada aprobada según las ejecuciones enlazadas arriba; revisión de seguridad incompleta y liberación no certificada. PR #1 continúa abierto y sin fusionar.
