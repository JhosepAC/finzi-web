# Changelog

## 1.0.0 — 2026-11-18

Primera versión de Finzi para uso personal y portafolio.

- Cuentas y categorías personalizables; ingresos, gastos y transferencias con trazabilidad.
- Estadísticas, deudas, gastos fijos y exportación de datos.
- Autenticación con confirmación por correo y recuperación de contraseña.
- Next.js SSR/API en Vercel Hobby, PostgreSQL/Auth/Storage en Supabase y Workers en Cloudflare.
- Telegram con webhook durable, idempotencia y procesamiento programado.
- Deletion Worker y custodia D1 desplegados, con eliminación estrictamente deshabilitada.

### Estado operacional

Web: https://finzi-beta.vercel.app · Bot: https://t.me/FinziAssistantBot

El backend operativo conserva el nombre finzi-staging. DELETION_ENABLED=false y cloud_enabled=false; esta release no habilita purgas ni pruebas de carga remotas. Los despliegues automáticos por Git permanecen desactivados.
