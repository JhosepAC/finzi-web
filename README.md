# Finzi

Finanzas personales gratuitas con Next.js y Supabase. Incluye registro/verificación, recuperación y sesiones, onboarding, cuentas personales, categorías propias e **ingresos, gastos, transferencias y correcciones trazables reales**. Inicio muestra saldos reconstruidos, seis períodos, comparación, evolución y distribución con acceso al historial, separado en PEN/USD. No existe modo de simulación ni datos financieros de ejemplo en la aplicación.

## Ejecutar localmente

Requisitos: Node.js 24 (probado con 24.21.0), pnpm 12.14.0 y Docker. Las imágenes de Supabase requieren descarga inicial y espacio local. No hace falta cuenta cloud.

```powershell
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm supabase:env
pnpm dev
```

Abrir [Finzi](http://127.0.0.1:3000/login). El correo de prueba llega a [Mailpit local](http://127.0.0.1:17324); usar direcciones sintéticas example.test. API Supabase: 17321; PostgreSQL: 17322. Mantener el puerto 3000 coherente con APP_URL. Las pruebas rechazan URLs cloud y no deben ejecutarse contra información personal.

`pnpm supabase:env` crea `.env.local` con configuración publicable local y se niega a sobrescribirla. Variables en [.env.example](.env.example). No se requiere clave administrativa para solicitudes de la aplicación. Reiniciar Next al cambiar variables.

`pnpm supabase:stop` conserva datos. **`pnpm supabase:reset` elimina los datos de prueba locales y reaplica migraciones**; no es necesario para actualizar. Los scripts no vinculan ni modifican proyectos cloud.

## Actualizar un entorno existente

Con Supabase local iniciado, aplicar las migraciones pendientes:

```powershell
pnpm exec supabase migration up --local
```

A-06 añade las migraciones 20261114000600 y 20261114000700 para ledger y comprobación al commit bajo ejecutor restringido. A-07 añade 20261114000800 y 20261114000900 para transferencias, reemplazos y validación diferida de sus referencias. Son aditivas; no se reescriben migraciones anteriores ni se borran usuarios. A-08 añade 20261114001000, RPC de reporting de solo lectura con instantánea coherente. No hay nuevas dependencias, servicios, claves o variables.

## Recorrido actual

Crear identidad → confirmar correo → configurar nombre/PEN/USD/zona → Inicio. Crear cuenta con moneda y saldo inicial; organizar categorías propias, opcionalmente copiar categorías iniciales; abrir Movimientos y registrar ingresos/gastos desde un formulario dentro de la página. Solo cuentas/categorías propias y activas; importes positivos y exactos; fecha ya ocurrida y no anterior a apertura.

El historial permite búsqueda, filtros, detalle y paginación. Los totales corresponden al filtro completo y excluyen anulados, reemplazados, aperturas y transferencias. Anular exige motivo y conserva el rastro. La apertura queda bloqueada con cualquier historia, incluida anulación. Archivo de cuentas/categorías conserva información; no habilita nuevos registros sobre referencias inactivas.

Ingreso/gasto, partida firmada y auditoría se confirman atómicamente; los reintentos no duplican operaciones, incluso tras perder la respuesta. RLS, FKs propias, control de versiones y bloqueos coordinados protegen aislamiento y concurrencia. Nunca se suman PEN y USD entre sí ni se convierte moneda automáticamente.

Transferir mueve dinero entre dos cuentas propias, activas y distintas de la misma moneda. La interfaz anticipa ambos saldos y advierte negativos; dos partidas opuestas se confirman juntas. El flujo neto excluye transferencias incluso al filtrar una sola cuenta. Anular una transferencia retira ambos efectos al mismo tiempo.

Corregir permite cambiar tipo, cuentas, importe, categoría, descripción, nota y fecha; exige motivo, revisión y versión vigente. Anula el original y publica su reemplazo en una sola transacción. El original y sus partidas permanecen intactos; cada registro admite un sucesor y cada sucesor puede corregirse. Ver trazabilidad recorre registros anteriores/reemplazos aunque estén fuera del filtro o página. Una fecha que no se edita conserva su instante exacto. No hay FX: corregir una moneda equivocada retira un registro y crea otro explícitamente en la cuenta elegida.

Límite inicial compartido: 10000 registros por usuario, incluyendo anulados y reemplazos. Al llegar al límite, una corrección nueva se rechaza sin anular el original; los reintentos ya confirmados siguen funcionando. Cuentas/categorías archivadas se conservan en la historia; para corregir hay que seleccionar referencias activas.

Inicio permite elegir día, semana (lunes–domingo), mes, trimestre, año y personalizado (hasta 3660 días, terminado hoy o antes). Compara con período anterior completo; rango personalizado con igual cantidad de días. Período en curso y base cero quedan señalados; no inventa porcentajes sin base. Saldo actual se etiqueta aparte de ingresos/gastos/flujo. Evolución muestra cierres diarios o mensuales con tabla exacta y sin saldos anteriores a aperturas. Distribución padre/hijos cuenta cada movimiento una vez. Los accesos desde métricas, categorías, cierres, cuentas y recientes conservan moneda/período al abrir su historial. Filtros/cursor/detalle sobreviven cambios de vista en memoria, sin URL o almacenamiento persistente de búsquedas. Duplicación explícita requiere revisar importe/fecha, usa clave nueva y conserva el original.

Exportación personal, eliminación, perfil/seguridad completos y endurecimiento siguen pendientes según [ROADMAP](docs/product/ROADMAP.md). La simulación previa, sus fixtures, formularios, exportación y accesos se retiraron en A-06.

## Comprobar

Con Supabase local y `.env.local` configurado:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm start
# En otra terminal:
pnpm test:e2e
```

Para comprobar producción, detener desarrollo antes de build/start. Playwright reutiliza el servidor local fuera de CI y usa Edge en Windows. `PLAYWRIGHT_CHANNEL` cambia el canal; en otro entorno puede instalarse Chromium con `pnpm exec playwright install chromium`. Las pruebas crean usuarios y registros sintéticos aislados para verificar rutas reales; no son un modo de producto ni semillas de datos para usuarios.

## Documentación y estado

- [ROADMAP](docs/product/ROADMAP.md) y [avance incremental](IMPLEMENTATION_PROGRESS.md).
- [Reporting real](docs/development/REAL_REPORTING.md), [Transferencias/reemplazos](docs/development/TRANSFERS_REPLACEMENTS.md), [contrato de movimientos](docs/development/MOVEMENTS.md), [cuentas](docs/development/ACCOUNTS.md) y [categorías](docs/development/CATEGORIES.md).
- [Índice documental](docs/README.md), [decisiones](docs/architecture/DECISIONS.md) y [sistema visual](DESIGN.md).

Se conserva el `.gitignore` original, incluidas docs/, AGENTS.md y carpetas de agentes. Solo docs/product/ROADMAP.md está versionado explícitamente por petición del usuario; los demás documentos ignorados son locales. Nunca incluir `.env`, cachés, capturas o logs con información personal en commits.

No hay despliegue ni infraestructura cloud contratada. Antes del registro público siguen pendientes HTTPS/correo, requisitos jurídicos/edad, capacidad gratuita, retención, respaldo y recuperación. Finzi continúa sin monetización, publicidad o servicios de pago. Manrope se sirve localmente con licencia SIL OFL en src/app/fonts/OFL.txt; el logo es el icono azul con f existente.
