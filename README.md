# THOP

Frontend web/PWA de THOP conectado a Supabase.

## Arquitectura
- Supabase Auth para sesiones.
- `catalog_products` para catálogo público.
- `profiles` para identidad/rol/tipo de cliente.
- `create_order_atomic` para pedidos transaccionales.
- `orders` para persistencia e historial.
- RLS/PostgreSQL como fuente de verdad.
- Sin contraseñas embebidas y sin `localStorage` como fuente de verdad.

## Vercel
Proyecto estático: `index.html` en la raíz. No requiere build.

## Seguridad
La clave `sb_publishable_*` del frontend es una clave pública de Supabase. La seguridad real debe permanecer en RLS/PostgreSQL; nunca colocar una `service_role` en el navegador.
