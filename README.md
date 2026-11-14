# Finzi

Autenticación y onboarding real en español con Next.js y Supabase. Identity incluye registro, confirmación por correo, acceso, recuperación, sesión protegida y cierre local/global. El perfil inicial añade nombre, PEN/USD y zona horaria. Inicio permite guardar cuentas personales con saldos iniciales reales y explorar una muestra financiera separada. Incluye categorías propias de ingresos/gastos. No incluye movimientos reales ni servicios de pago.

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

El `.gitignore` conserva las exclusiones originales del usuario, incluidas `docs/`, `AGENTS.md` y las carpetas de agentes. Se versiona explícitamente docs/product/ROADMAP.md por petición del usuario; los demás documentos ignorados permanecen locales y no se publican automáticamente.

## Interfaz AUTH

Rediseño en `feat/auth-ui-redesign`, usando las referencias locales de login y el icono azul con f como logo. Manrope se sirve localmente; su licencia SIL OFL 1.1 está incluida en `src/app/fonts/OFL.txt`. El sistema actual se documenta en [DESIGN.md](DESIGN.md). Los cambios se revisan en esta rama antes de integrar a main.

## Avance por interfaces

[IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) registra la secuencia, alcance y aceptación de cada entrega. AUTH está integrado en main; las entregas posteriores de onboarding, Inicio y cuentas se encadenan en ramas dedicadas. El avance vigente está en [ROADMAP](docs/product/ROADMAP.md).

Después de confirmar el correo, `/onboarding` guía nombre, preferencias y revisión. Guarda en Supabase y abre `/dashboard`. Login posterior retoma la configuración pendiente o entra al inicio. `/onboarding?edit=1` permite editar; `/session` mantiene los cierres. Las cuentas reales se crean desde Inicio; la muestra financiera requiere activar su modo de prueba.

Migración nueva: `supabase/migrations/20261114000100_profile_onboarding.sql`. Tras actualizar un entorno local existente, aplicar con `pnpm exec supabase migration up --local`; no hace falta resetear ni borrar usuarios. Debe aplicarse también antes de desplegar esta versión en otro entorno. La primera migración AUTH es un prerrequisito. Sin variables adicionales ni dependencias nuevas.

## Inicio del dashboard y datos de prueba

Rama `feat/dashboard-home`, basada en la entrega de onboarding. Tras entrar, pulsa **Abrir simulación** en el sidebar o abre `/dashboard?demo=1`. La entrada está solo en el sidebar y su menú móvil. Se requiere identidad verificada y perfil completo en todos los casos.

La muestra muestra PEN/USD separados, saldo reconstruido, ingresos/gastos mensuales, evolución, categorías, cuentas y movimientos. Puedes cambiar período/moneda, buscar, filtrar, ocultar importes, descargar CSV de muestra, añadir ingresos/gastos de prueba y editar aperturas. La muestra usa fechas de junio al 14 de noviembre de 2026. Su banner permanece visible; **recargar la reinicia** y Salir de la muestra vuelve a tus cuentas reales (o al estado vacío si no creaste ninguna). Los importes de apertura no cuentan como ingresos.

Los datos de prueba viven en memoria del componente y no se guardan en Supabase, localStorage o el perfil financiero. No hay pagos, transferencias bancarias, anuncios, IA ni servicios nuevos. Las cuentas y aperturas reales están implementadas por separado; los movimientos reales siguen pendientes. No se incluye un saldo global en profiles. Detalles en [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) y [DESIGN.md](DESIGN.md).

## Cuentas personales y saldos iniciales — A-04

Rama feat/accounts-and-opening-balances. En Inicio o Cuentas puedes registrar efectivo, cuenta bancaria, ahorros u otra cuenta personal. Elige PEN/USD y un saldo inicial, incluido cero o negativo; la fecha de apertura se asigna al guardar. Puedes editar nombre/apertura y archivar/restaurar. La moneda, el tipo y la fecha se conservan. Los totales incluyen archivadas y nunca mezclan monedas. Límite técnico inicial: 100 cuentas por usuario.

Aplicar las tres migraciones nuevas, en orden, con `pnpm exec supabase migration up --local` después de iniciar Supabase. No se requiere resetear ni borrar usuarios, añadir variables o instalar dependencias. Persistencia mediante RPC privadas, RLS, altas idempotentes por usuario, control de versión y auditoría mínima. Una respuesta perdida puede reintentarse sin duplicar cuentas. No se usan claves administrativas en la aplicación.

Los importes actuales representan aperturas, no ingresos o gastos. Antes de implementar movimientos se deberá bloquear en SQL la edición de aperturas con historia. Ver [contrato de cuentas](docs/development/ACCOUNTS.md), [avance](IMPLEMENTATION_PROGRESS.md) y [ROADMAP](docs/product/ROADMAP.md). Validación actual: 129 unitarias, 57 de integración local y 32 E2E contra producción (218 en total), TypeScript, ESLint y build.


## Categorías propias — A-05

En el sidebar abre **Categorías** para organizar ingresos/gastos en dos niveles, buscar, personalizar nombre/descripción/color/icono y archivar/restaurar. Puedes añadir opcionalmente 10 categorías iniciales propias. El tipo y el padre quedan fijos al crear; los nombres son únicos entre hermanas del mismo tipo, incluidas las archivadas. Límite inicial: 200 por usuario. Archivo efectivo por padre sin perder el estado individual de las hijas.

Aplicar la migración aditiva 20261114000500 con `pnpm exec supabase migration up --local`, sin reset. No se añaden dependencias o variables. Sin movimientos reales todavía. Abrir simulación aparece solo en el sidebar/menú móvil; el pie y el enlace dentro de pantallas se eliminaron. [ROADMAP](docs/product/ROADMAP.md), [avance](IMPLEMENTATION_PROGRESS.md) y [contrato local](docs/development/CATEGORIES.md).
