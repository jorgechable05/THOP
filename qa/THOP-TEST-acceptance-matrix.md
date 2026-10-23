# THOP — matriz de aceptación (THOP-TEST)

**Entorno permitido:** Supabase project `xodufvmosjtpbamqnqkw` (THOP-TEST), rama GitHub `dev/supabase-schema-alignment`.
**Producción:** no ejecutar pruebas ni desplegar.
**Estado inicial:** todos los casos quedan PENDIENTES hasta ser ejecutados con sesiones autenticadas reales. No se usan cuentas ni datos de clientes reales.

| # | Caso | Criterio de aceptación | Resultado |
|---:|---|---|---|
| 1 | Registro nuevo | Perfil creado como CLIENTE / PUBLICO / PENDIENTE | PENDIENTE |
| 2 | Autopromoción a MAYORISTA | Usuario no puede cambiar su propio tipo | PENDIENTE |
| 3 | Autopromoción a ADMIN | Usuario no puede cambiar su rol | PENDIENTE |
| 4 | Precio PUBLICO | Se calcula precio público en servidor | PENDIENTE |
| 5 | Precio MINORISTA | Cliente minorista obtiene su tarifa | PENDIENTE |
| 6 | Precio MAYORISTA | Cliente mayorista obtiene su tarifa | PENDIENTE |
| 7 | Precio especial | Precio vigente por cliente/producto tiene prioridad | PENDIENTE |
| 8 | Leer costo como cliente | Lectura denegada/no se expone columna | PENDIENTE |
| 9 | Leer lotes como cliente | Lectura denegada | PENDIENTE |
| 10 | Leer caducidad como cliente | Lectura denegada | PENDIENTE |
| 11 | Pedido normal | Pedido y movimientos se confirman de forma atómica | PENDIENTE |
| 12 | Lote caducado | No se utiliza para completar el pedido | PENDIENTE |
| 13 | Stock insuficiente | Pedido falla y no deja cambios parciales | PENDIENTE |
| 14 | Dos pedidos simultáneos | Sin sobreventa ni stock negativo | PENDIENTE |
| 15 | Rollback de compra | Error intermedio no deja compra/lote/movimiento parcial | PENDIENTE |
| 16 | Cambio de precio | Nuevo precio se aplica a pedidos posteriores | PENDIENTE |
| 17 | Precio histórico | Detalle conserva el precio unitario original | PENDIENTE |
| 18 | Recepción de compra | Crea lote con cantidades/costo/caducidad correctos | PENDIENTE |
| 19 | Movimiento de compra | Recepción registra movimiento de inventario | PENDIENTE |
| 20 | Reportes administrativos | Solo ADMIN accede a datos administrativos | PENDIENTE |
| 21 | Editar otro perfil | Cliente no modifica perfil ajeno | PENDIENTE |
| 22 | Modificar producto como cliente | Escritura denegada | PENDIENTE |
| 23 | Invocar RPC administrativa | Usuario cliente recibe denegación | PENDIENTE |
| 24 | Dos pedidos del último lote | Solo una transacción obtiene las últimas unidades | PENDIENTE |
| 25 | Cambio PUBLICO → MAYORISTA por admin | Solo admin cambia tipo y precio efectivo cambia correctamente | PENDIENTE |

## Reglas de ejecución
- Usar dos sesiones independientes (dos usuarios de prueba con tokens separados) para los casos 14 y 24.
- Usar solo productos, lotes, perfiles y pedidos sintéticos creados en THOP-TEST.
- Registrar salida observada, error SQL/API, fecha y evidencia por caso antes de cambiar PENDIENTE por APROBADO o FALLIDO.
- Un error de permisos desde el contexto SQL de servicio no sustituye una prueba real con JWT de cliente.
- No certificar la aplicación mientras queden casos críticos pendientes.
