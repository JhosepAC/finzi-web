# Finzi · AUTH

Autenticación y onboarding real en español con Next.js y Supabase. Identity incluye registro, confirmación por correo, acceso, recuperación, sesión protegida y cierre local/global. El perfil inicial añade nombre, PEN/USD y zona horaria; el dashboard permite explorar una muestra financiera interactiva y conserva un estado sin cuentas fuera del modo de prueba. No incluye cuentas, movimientos o servicios de pago.

## Ejecutar localmente

Requisitos: Node.js 24 (probado con 24.21.0), pnpm 12.14.0 y Docker en ejecución. Las imágenes de Supabase necesitan descarga inicial y espacio local. No se requiere una cuenta cloud.

```powershell
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm supabase:env
pnpm dev
```

Abrir [Finzi](http://127.0.0.1:3000/login). Los correos de prueba llegan exclusivamente a [Mailpit local](http://127.0.0.1:17324). Usar direcciones sintéticas como `persona@example.test`. Supabase API usa el puerto 17321 y PostgreSQL el 17322. El puerto 3000 debe estar disponible y coincidir con `APP_URL`; si Next elige otro puerto, detenerlo y liberar el 3000 o ajustar todos los orígenes de forma coherente.

`pnpm supabase:env` crea `.env.local` con URL y clave publicable locales; se niega a sobrescribir un archivo existente. Las tres variables están descritas en [.env.example](.env.example). Ninguna clave administrativa es necesaria para la aplicación. Tras cambiar variables, reiniciar Next.

`pnpm supabase:stop` detiene los servicios locales conservando datos. **`pnpm supabase:reset` elimina los datos de prueba de este proyecto local y reaplica sus migraciones**; usarlo solo cuando se quiera reiniciar ese entorno. Los scripts no vinculan ni modifican proyectos cloud.

## Comprobar

Con Supabase local iniciado y `.env.local` configurado:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Playwright usa Edge instalado en Windows. En otro entorno se puede instalar su navegador con `pnpm exec playwright install chromium`; `PLAYWRIGHT_CHANNEL` permite elegir el canal. Las pruebas de integración y navegador crean usuarios sintéticos y correos locales. No ejecutar contra datos personales: integración y E2E rechazan URLs cloud. El test E2E reutiliza el servidor del puerto 3000 fuera de CI; para comprobar producción, detener desarrollo, ejecutar `pnpm build` y `pnpm start`, y luego `pnpm test:e2e` en otra terminal.

## Implementación y siguientes pasos

- [Informe de entrega y configuración cloud](docs/development/AUTH_IMPLEMENTATION.md): archivos, dependencias, migración, comprobaciones y pendientes.
- [Seguridad de AUTH](docs/security/AUTH.md): sesiones, endpoints, RLS y límites.
- [Documentación del producto](docs/README.md) y [decisiones](docs/architecture/DECISIONS.md).
- [Sistema visual implementado](DESIGN.md).

No se ha desplegado la aplicación ni creado infraestructura cloud. Antes de abrir el registro público faltan configuración HTTPS/Supabase/correo, validaciones jurídicas y operativas indicadas en el informe. La gratuidad y la prohibición de activar costes siguen vigentes.

El `.gitignore` conserva las exclusiones originales del usuario, incluidas `docs/`, `AGENTS.md` y las carpetas de agentes. Por ello esos documentos seguirán ignorados si se inicializa Git; conservarlos aquí no implica que vayan a publicarse automáticamente.

## Interfaz AUTH

Rediseño en `feat/auth-ui-redesign`, usando las referencias locales de login y el icono azul con f como logo. Manrope se sirve localmente; su licencia SIL OFL 1.1 está incluida en `src/app/fonts/OFL.txt`. El sistema actual se documenta en [DESIGN.md](DESIGN.md). Los cambios se revisan en esta rama antes de integrar a main.

## Avance por interfaces

[IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) registra la secuencia, alcance y aceptación de cada entrega. AUTH está integrado en main; onboarding se desarrolla en `feat/financial-profile-onboarding`.

Después de confirmar el correo, `/onboarding` guía nombre, preferencias y revisión. Guarda en Supabase y abre `/dashboard`. Login posterior retoma la configuración pendiente o entra al inicio. `/onboarding?edit=1` permite editar; `/session` mantiene los cierres. No hay saldos o movimientos de ejemplo.

Migración nueva: `supabase/migrations/20261114000100_profile_onboarding.sql`. Tras actualizar un entorno local existente, aplicar con `pnpm exec supabase migration up --local`; no hace falta resetear ni borrar usuarios. Debe aplicarse también antes de desplegar esta versión en otro entorno. La primera migración AUTH es un prerrequisito. Sin variables adicionales ni dependencias nuevas.

## Inicio del dashboard y datos de prueba

Rama `feat/dashboard-home`, basada en la entrega de onboarding. Tras entrar, pulsa **Explorar con datos de prueba** o abre `/dashboard?demo=1`. También puedes marcar esa opción al terminar el onboarding. Se requiere identidad verificada y perfil completo en todos los casos.

La muestra muestra PEN/USD separados, saldo reconstruido, ingresos/gastos mensuales, evolución, categorías, cuentas y movimientos. Puedes cambiar período/moneda, buscar, filtrar, ocultar importes, descargar CSV de muestra, añadir ingresos/gastos de prueba y editar aperturas. La muestra usa fechas de junio al 14 de noviembre de 2026. Su banner permanece visible; **recargar la reinicia** y Salir de la muestra vuelve al estado sin cuentas. Los importes de apertura no cuentan como ingresos.

Los datos de prueba viven en memoria del componente y no se guardan en Supabase, localStorage o el perfil financiero. No hay pagos, transferencias bancarias, anuncios, IA ni servicios nuevos. Las cuentas y movimientos reales siguen pendientes de su modelo persistente; no se incluye un saldo global en profiles. Detalles en [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) y [DESIGN.md](DESIGN.md).
