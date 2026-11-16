<p align="center">
  <img src="src/app/icon.svg" alt="Icono de Finzi" width="80" height="80" />
</p>

<h1 align="center">Finzi</h1>

<p align="center">
  Tus cuentas, movimientos y compromisos financieros en un solo lugar.
  <br />
  Finanzas personales gratuitas, sin publicidad ni suscripciones.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&amp;logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&amp;logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&amp;logoColor=white" alt="Supabase y PostgreSQL" />
</p>

<p align="center">
  <a href="#funcionalidades">Funcionalidades</a> ·
  <a href="#tecnologías">Tecnologías</a> ·
  <a href="#instalación-local">Instalación</a> ·
  <a href="#documentación-técnica">Documentación</a>
</p>

---

## Acerca del proyecto

**Finzi** es una aplicación web de finanzas personales para registrar el dinero que entra y sale, consultar saldos y organizar compromisos de pago. Reúne cuentas, categorías, movimientos, estadísticas, deudas y gastos fijos en una interfaz en español adaptada a escritorio y móvil.

Trabaja con **soles peruanos (PEN) y dólares estadounidenses (USD)** por separado. La información financiera proviene de los registros del usuario: la aplicación no incluye un modo de demostración ni saldos ficticios.

> **Estado:** en desarrollo, con ejecución y validación locales. El registro público y el despliegue de producción tienen requisitos de seguridad, operación y privacidad pendientes. Consulta la [hoja de ruta](docs/product/ROADMAP.md).

## Funcionalidades

| Módulo | Qué puedes hacer |
| --- | --- |
| **Inicio** | Consultar saldo actual, ingresos, gastos y flujo del período; explorar evolución, categorías, cuentas, compromisos pendientes y movimientos recientes. |
| **Cuentas** | Registrar efectivo, cuentas bancarias, ahorros y otras cuentas personales; gestionar aperturas, archivar y transferir entre cuentas de la misma moneda. |
| **Movimientos** | Registrar ingresos y gastos en modales, buscar y filtrar automáticamente, consultar el detalle, duplicar, corregir, archivar o eliminar con trazabilidad. |
| **Categorías** | Organizar ingresos y gastos con categorías y subcategorías, iconos, colores e imágenes privadas. |
| **Estadísticas** | Comparar períodos, consultar ingresos, gastos, balance neto y ahorro calculado; explorar gráficos interactivos y variaciones por categoría. |
| **Deudas** | Registrar acreedor, importe y vencimiento; gestionar abonos y consultar el historial de pagos. |
| **Gastos fijos** | Organizar pagos semanales, quincenales, mensuales, trimestrales o anuales; consultar vencimientos en tarjetas, lista o calendario. |
| **Mi perfil** | Editar nombre, moneda preferida y zona horaria, con confirmación del efecto sobre la agrupación del historial. |
| **Sesión y seguridad** | Registrarse, verificar correo, recuperar o cambiar contraseña y cerrar la sesión actual o todas las sesiones. |
| **Telegram opcional** | Registrar ingresos/gastos con confirmación y consultar saldos/reportes desde un chat privado vinculado; permisos de registro y consulta independientes. |
| **Mis datos** | Descargar una copia personal en JSON o movimientos filtrados en CSV; solicitar la eliminación de la cuenta y seguir su estado con un comprobante privado. |

Los pagos de deudas y gastos fijos permiten **crear un gasto o vincular uno existente**, para conservar la relación con Movimientos y evitar descontar el dinero dos veces. La recurrencia genera los siguientes vencimientos; no realiza cargos bancarios automáticos.

La interfaz ofrece **tema claro, oscuro y automático según el sistema**, con la preferencia conservada en este navegador.

## Tecnologías

| Área | Herramientas |
| --- | --- |
| Aplicación web | Next.js 16, React 19 y TypeScript 6 |
| Datos y autenticación | Supabase Auth, PostgreSQL 17, Supabase Storage y SDK/RPC sin ORM |
| Interfaz | CSS, Lucide React y tipografía Manrope servida localmente |
| Validación | Zod |
| Pruebas | Vitest y Playwright |
| Calidad | ESLint y comprobación de tipos con TypeScript |
| Entorno local | Node.js 24, pnpm 12.14.0 y Docker |

Las versiones exactas y los scripts se encuentran en [package.json](package.json); las dependencias están fijadas en [pnpm-lock.yaml](pnpm-lock.yaml).

## Documentación técnica

### Arquitectura

Finzi es un **monolito modular**. Next.js integra las rutas web y los endpoints HTTP; los módulos separan presentación, lógica de dominio e infraestructura. PostgreSQL mantiene las reglas de integridad y las operaciones financieras atómicas mediante funciones RPC y migraciones SQL versionadas.

```text
finzi/
├── src/
│   ├── app/                  # Rutas, endpoints HTTP, estilos globales y recursos
│   ├── modules/
│   │   ├── accounts/         # Cuentas, aperturas y saldos
│   │   ├── classification/   # Categorías, subcategorías e imágenes
│   │   ├── debts/            # Deudas y abonos
│   │   ├── fixed-expenses/   # Compromisos recurrentes y pagos
│   │   ├── identity/         # Acceso, perfil, seguridad y datos personales
│   │   ├── reporting/        # Inicio, estadísticas y consultas agregadas
│   │   └── transactions/     # Movimientos, transferencias y correcciones
│   └── shared/               # Dinero, fechas y componentes compartidos
├── supabase/                 # Configuración local y migraciones SQL
├── scripts/                  # Entorno local y procesamiento de eliminaciones
├── tests/                    # Pruebas unitarias, de integración y E2E
├── .env.example              # Variables de configuración
└── package.json              # Dependencias y comandos
```

### Reglas financieras y privacidad

- **Importes exactos:** dinero representado con tipos decimales en PostgreSQL y unidades menores enteras con `bigint` en el dominio.
- **Monedas separadas:** los reportes no suman PEN con USD y no existe conversión automática.
- **Transferencias internas:** mueven dinero entre cuentas; no se cuentan como ingresos o gastos.
- **Historia trazable:** las correcciones conservan el registro original y enlazan su reemplazo. Eliminar un movimiento retira su efecto y mantiene el rastro financiero.
- **Operaciones atómicas e idempotentes:** las partidas se confirman juntas y los reintentos técnicos no duplican operaciones.
- **Aislamiento por usuario:** identidad verificada, Row Level Security (RLS), referencias propias y validación en servidor y base de datos.
- **Acciones sensibles:** cambiar contraseña, exportar y eliminar requieren la autorización correspondiente. Las autorizaciones son temporales y de un solo uso.

El ahorro estadístico es el excedente positivo de ingresos menos gastos del período. **No representa el saldo de las cuentas ni dinero reservado.**

## Instalación local

### Requisitos

- **Node.js 24**.
- **pnpm 12.14.0**.
- **Docker** instalado y en ejecución para Supabase local.

No necesitas contratar un proyecto de Supabase para ejecutar el entorno local. La primera ejecución descarga las imágenes de sus servicios.

### Puesta en marcha

Clona este repositorio y abre su carpeta en una terminal. Después ejecuta:

```sh
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm supabase:env
pnpm dev
```

| Servicio | Dirección local |
| --- | --- |
| Aplicación | [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login) |
| Buzón de correo de desarrollo | [http://127.0.0.1:17324](http://127.0.0.1:17324) |
| API de Supabase | `http://127.0.0.1:17321` |
| PostgreSQL | Puerto `17322` |

Registra una identidad de prueba, confirma el correo desde el buzón local, configura tus preferencias y crea tu primera cuenta. Para desarrollo y pruebas utiliza datos sintéticos, por ejemplo direcciones `example.test`.

### Variables de entorno

`pnpm supabase:env` genera `.env.local` a partir del entorno local iniciado y **no sobrescribe un archivo existente**. La plantilla disponible es [.env.example](.env.example).

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | URL de la API de Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto; no una clave administrativa. |
| `APP_URL` | Origen canónico de la aplicación. En local: `http://127.0.0.1:3000`. |

La aplicación consume estas variables en el servidor. Mantén `APP_URL` coherente con el puerto de Next.js y reinicia el servidor cuando cambies la configuración. No publiques `.env.local` ni credenciales privadas.

### Actualizar o detener Supabase

Con el entorno local iniciado, aplica las migraciones pendientes:

```sh
pnpm exec supabase migration up --local
```

Para detenerlo conservando los datos:

```sh
pnpm supabase:stop
```

`pnpm supabase:reset` **borra los datos locales y reaplica las migraciones**. No es necesario para una actualización normal.

## Comandos de desarrollo

| Comando | Propósito |
| --- | --- |
| `pnpm dev` | Iniciar Next.js en desarrollo. |
| `pnpm typecheck` | Generar tipos de rutas y comprobar TypeScript. |
| `pnpm lint` | Comprobar ESLint sin advertencias permitidas. |
| `pnpm test` | Ejecutar pruebas unitarias. |
| `pnpm test:integration` | Ejecutar pruebas de integración contra los servicios locales. |
| `pnpm test:e2e` | Ejecutar pruebas de navegador con Playwright. |
| `pnpm build` | Compilar para producción. |
| `pnpm start` | Servir la compilación de producción. |

Las pruebas de integración y E2E necesitan Supabase local y `.env.local`. Crean usuarios sintéticos para comprobar los flujos reales y rechazan entornos cloud.

Playwright utiliza Edge por defecto en Windows. Para usar Chromium:

```sh
pnpm exec playwright install chromium
```

Configura `PLAYWRIGHT_CHANNEL=chromium` en el entorno antes de ejecutar los E2E. Para revisar una compilación de producción, detén `pnpm dev` antes de ejecutar `pnpm build` y `pnpm start`.

### Procesamiento de eliminaciones

Las solicitudes de eliminación necesitan el worker local en ejecución:

```sh
pnpm deletion:worker --watch
```

Si el worker está detenido, la solicitud permanece pendiente y la cuenta bloqueada. El comprobante privado permite consultar el estado en `/deletion`. El borrado de la instancia activa y la caducidad de las copias de seguridad son etapas distintas.

### Bot de Telegram local

El bot se ejecuta por separado y necesita Supabase local, internet y el equipo encendido. Las credenciales se guardan únicamente en `.env.telegram.local`; el almacén cifrado y su clave permanecen separados y fuera del repositorio. Los mensajes y respuestas pasan por Telegram.

```sh
pnpm telegram:check
pnpm telegram:bot
```

`telegram:check` verifica configuración, identidad, custodia y permisos sin consumir mensajes. Para detener el bot usa **Ctrl+C**; reinicia con la misma configuración y custodia. La vinculación y los permisos se gestionan en **Mi perfil → Telegram**. Los borradores vencen a los 15 minutos y ningún movimiento se registra sin confirmación explícita.

`pnpm telegram:setup` es solo para una instalación nueva: conserva y rechaza una configuración existente. `pnpm telegram:recovery` muestra conteos sin cambiar datos; la invalidación tras restaurar copias requiere mantenimiento con el gateway deshabilitado y confirmación explícita. No ofrece disponibilidad continua ni requiere servicios de pago.

## Estado y alcance

La funcionalidad actual incluye autenticación, cuentas, categorías, movimientos, transferencias, correcciones trazables, reporting, deudas, gastos fijos y gestión de datos personales. El desarrollo sigue una estrategia de integración frecuente con **Conventional Commits**.

La aplicación no incluye conexión bancaria, cambio de divisas, cobros automáticos, OCR ni funciones de IA. Los próximos pasos de endurecimiento, recuperación, capacidad y preparación del registro público están recogidos en la [hoja de ruta](docs/product/ROADMAP.md).

## Autor

Desarrollado por [Jhosep Argomedo](https://jhosep-ac.pages.dev/).

---

<p align="center">Finzi · Finanzas personales gratuitas, con control sobre tus datos.</p>
