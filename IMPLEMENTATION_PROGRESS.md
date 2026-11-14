# Finzi — avance por funcionalidades e interfaces

Registro incremental. Actualización: 14 de noviembre de 2026. Cada entrega sigue: alcance y aceptación → rama dedicada → implementación → pruebas/UX → commit revisable → integración autorizada. No activar costes ni modificar docs/context.md.

## Estado y orden

| Etapa | Entrega | Estado | Criterio para terminar |
| --- | --- | --- | --- |
| 1 | AUTH y rediseño | Integrada en main (345dea9) | Registro, correo, recuperación, sesión y cierres reales; diseño responsive probado |
| 2 | Onboarding del perfil financiero | Implementada en feat/financial-profile-onboarding | Nombre, PEN/USD, zona horaria e idioma español persistidos por usuario; revisar antes de guardar; reintentos y aislamiento probados |
| 3 | Inicio del dashboard | Inicio real A-06; muestra A-03 retirada | Entrada privada, modo de prueba identificado, cálculos exactos, filtros y formularios simulados; sin datos ficticios en cuentas reales |
| 4 | Primera cuenta y listado de cuentas | Implementada — A-04 | Tipo personal, moneda, apertura exacta, RLS, edición/archivo; no integración bancaria |
| 5 | Categorías | Implementada — A-05 | Ingreso/gasto y jerarquía propia, archivo y aislamiento |
| 6 | Ingreso y gasto | Implementada — A-06 | Dinero exacto, fecha/zona, publicación atómica e idempotencia |
| 7 | Transferencias y reemplazos trazables | Siguiente entrega | Una moneda, partidas firmadas, reemplazos y rollback/concurrencia |
| 8 | Historial y dashboard financiero | Pendiente de datos/reglas reales | Filtros, períodos y métricas reconciliadas por moneda; vacío distinto de error |
| 9 | Perfil y seguridad completos | Parcial | Editar preferencias propias y cierres; administración avanzada de dispositivos diferida |
| 10 | Exportación y eliminación | Pendiente | JSON/CSV, reautenticación, retención y proceso de borrado acordados |
| 11 | Endurecimiento y publicación | Pendiente | SMTP/HTTPS, privacidad/edad, backups/restore, cuotas gratuitas; sin SLA inventado |

Los pendientes definen secuencia, no implementación automática de todo el producto. Presupuestos, metas, crédito, FX e IA permanecen fuera del MVP. La primera cuenta se crea desde Inicio/Cuentas; el onboarding actual no solicita saldo, ingresos, documentos o datos bancarios.

## Entrega A-02: perfil y bienvenida

Autorización A-02 del usuario: fusionar el rediseño de AUTH, documentar el avance y continuar con onboarding del perfil financiero como siguiente pantalla del registro. main se actualizó por fast-forward; trabajo nuevo aislado en feat/financial-profile-onboarding.

Flujo: crear cuenta → confirmar correo → configurar perfil (nombre, preferencias, revisión) → guardar en Supabase → dashboard inicial. Login posterior entra al dashboard o vuelve al onboarding si falta completar. Recuperación conserva su flujo de seguridad. /session sigue disponible para gestionar cierres.

```text
[Logo + progreso real]     [Paso activo]
  Tu nombre                Campo / selección
  Tus preferencias         Atrás       Continuar
  Revisa tu perfil         Guardar y continuar
```

Diseño: continúa Manrope local y azul Finzi, panel de progreso de tres pasos reales y formulario claro; móvil concentra paso y campos. No se reutiliza una imagen financiera ficticia. El dashboard empieza con bienvenida y preferencias reales, sin saldos provisionales ni enlaces a módulos inexistentes.

Validación: UI + servidor + RPC; identidad verificada, dueño derivado del request, RLS existente, esquema privado, versión para evitar sobrescritura concurrente y respuesta segura ante fallo. El idioma inicial es español y no se realiza conversión de PEN/USD.

## Evidencia ejecutada

- [x] Migración aplicada localmente sin borrar usuarios existentes.
- [x] Datos propios persistidos, recarga y login retomables.
- [x] Aislamiento A/B/anónimo, validación de moneda/zona, conflicto y reintento.
- [x] E2E del alta completa, edición, error y protección de rutas.
- [x] TypeScript, ESLint, build y revisión visual móvil/tablet/escritorio.

La exclusión general de docs/ se conserva. Desde A-04 se versiona explícitamente docs/product/ROADMAP.md por petición del usuario; este registro en raíz conserva el detalle de entregas.

## Resultado de validación de esta entrega

- 61 pruebas unitarias pasadas (43 AUTH + 18 de perfil).
- 21 pruebas de integración pasadas con Supabase/PostgreSQL local (10 AUTH + 11 de perfil).
- 18 E2E pasadas contra el build de producción, incluyendo regresión AUTH y onboarding completo.
- TypeScript, ESLint y build de producción correctos.
- Capturas de nombre, preferencias, revisión y dashboard a 320/390/768/1440 px, revisadas sin overflow horizontal.
- Migración aditiva aplicada con migration up --local; usuarios anteriores conservados.

Total: 100 pruebas automatizadas. No despliegue cloud, push o costes. La rama nueva queda lista para revisión; main contiene la entrega AUTH fusionada.

## A-03 — Inicio del dashboard con muestra interactiva

Autorizado por el usuario el 14 de noviembre de 2026. Rama feat/dashboard-home, basada en la entrega de onboarding. Referencias: docs/references/dashboard/interface-1.jpg a interface-5.jpg. Se conserva frontend-design y la identidad Manrope/azul.

Dirección revisada antes de implementar: referencia 4 para la navegación/estructura, referencia 1 para legibilidad y referencia 3 para separar saldo y actividad. Se descartan negro, tarjetas bancarias, logos ajenos, crédito, IA, planes premium, publicidad y transferencias bancarias. Paleta: #1D4ED8 acción/saldo, #F4F7FC fondo, #FFFFFF superficies, #152343 tinta, #16765A ingresos y #B5473D gastos. La única superficie protagonista es saldo; el resto favorece lectura de datos y controles reales.

```text
[ Finzi | navegación ] [ búsqueda        perfil ]
[ Inicio             ] [ saludo  moneda  período ]
[ Movimientos        ] [ saldo ][ ingreso ][ gasto ]
[ Cuentas            ] [ evolución      ][ categorías ]
[ Perfil / Seguridad ] [ movimientos recientes ][ cuentas ]
```

La muestra es opt-in (?demo=1), siempre identificada, con datos sintéticos en memoria. Puede elegirse también al finalizar onboarding. Permite probar filtros, búsquedas, ocultar importes, añadir ingresos/gastos de prueba, editar saldos iniciales de muestra y descargar CSV de prueba. Nunca escribe operaciones ficticias en Supabase ni las presenta como saldo del usuario. Salir vuelve al estado sin cuentas; recargar reinicia la muestra.

PEN/USD separados; cálculos exactos en unidades menores bigint. Apertura no cuenta como ingreso; saldos reconstruidos de apertura + movimientos. Las geometrías de gráficos admiten aproximación, los importes mostrados no. El período de muestra es junio–noviembre de 2026, con corte explícito al 14 de noviembre. La cuenta y apertura reales siguen siendo la siguiente entrega de persistencia, no se introducen en profiles como un saldo global.

Estado: implementado y verificado en feat/dashboard-home. Sin nuevas dependencias, servicios, costes ni migraciones. No hay despliegue/push ni fusión automática con main.

Evidencia A-03:

- 86 pruebas unitarias pasadas: AUTH/perfil y 25 casos del modelo de muestra (dinero exacto, períodos, monedas, apertura, validación y CSV).
- 21 pruebas de integración pasadas con Supabase/Postgres local; sin cambios de esquema o APIs para la muestra.
- 22 E2E pasadas contra producción: regresión AUTH/onboarding y 4 escenarios completos del Inicio.
- Total actual: 129 pruebas automatizadas. TypeScript, ESLint y build de producción correctos.
- Capturas de Inicio a 320/390/768/1024/1440 px, sin overflow horizontal ni errores JavaScript/consola observados en el recorrido visual. Móvil usa navegación modal accesible.
- Los tests verifican que ni los saldos/movimientos simulados ni el cambio de moneda de la muestra escriben en API/perfil.
- Perfil real y muestra separados; recargar descarta cambios simulados, salir devuelve el estado sin cuentas.
- Formularios de muestra sin envío de red incluso en su comportamiento nativo; onboarding usa POST como fallback para no incluir campos en la URL.

## A-04 — Cuentas y saldos de apertura reales

Siguiente paso autorizado por el usuario. Rama feat/accounts-and-opening-balances basada en 5c8b74f. ROADMAP.md actualizado antes de implementar. Crear/listar cuenta propia, editar nombre/apertura, archivar/restaurar, separar PEN/USD y mostrar saldos reales en Inicio. Apertura con timestamp del servidor, nunca ingreso. Operaciones RPC privadas con RLS, idempotencia de alta, versiones y auditoría mínima. Máximo inicial: 100 cuentas por usuario incluyendo archivadas.

Diseño: se mantiene frontend-design, azul/Manrope y navegación Finzi. La interfaz Cuentas tendrá estado vacío accionable, formulario nativo en dialog y tarjetas con saldo, moneda, tipo y fecha real. No se añaden botones bancarios ni datos de ejemplo en la vista real. El saldo de cada moneda incluye archivadas; el estado vacío de ingresos/gastos explica que aún no hay movimientos reales.

Estado: implementado y validado localmente. Categorías es la siguiente entrega; el ledger permanece pendiente. Cualquier etapa que introduzca movimientos deberá bloquear la edición de apertura con historia dentro de la misma frontera SQL.


Evidencia A-04:

- 111 pruebas unitarias pasadas (25 nuevas de cuentas/dinero).
- 37 pruebas de integración pasadas contra Supabase/PostgreSQL local (16 nuevas de cuentas): usuarios A/B/anónimo, roles efectivos, inmutabilidad, auditoría, cuota concurrente y reintentos por usuario.
- 26 E2E pasadas contra el build de producción (4 nuevas): alta real, respuesta perdida tras commit y reintento sin duplicados, PEN/USD, recarga, archivo/restauración, conflicto entre pestañas y sesión expirada.
- Total: 174 pruebas automatizadas. TypeScript, ESLint y build de producción correctos.
- Capturas de cuentas reales a 320/390/768/1440 px, sin overflow horizontal. Dialog y foco al confirmar guardado; formulario conserva errores/borrador.
- Tres migraciones aditivas aplicadas localmente sin reset. La tercera separa requestId por usuario del UUID de cuenta generado por servidor y rechaza numeric no finitos.
- Corregida la navegación después de editar perfil para cargar su versión actual, validada en E2E de conflicto del onboarding.
- Sin nuevas dependencias, servicios, variables, cloud, costes, push o integración automática a main. Documentación de cuentas local en docs/development/ACCOUNTS.md; ROADMAP versionado explícitamente.


## A-05 — Categorías propias y entrada de simulación en sidebar

Solicitud explícita: eliminar home-footer y real-sample-link; Abrir simulación solo en sidebar, también en navegación móvil; retirar opción de onboarding. Mantener identificación/salida dentro de la simulación.

Diseño previo: azul #1D4ED8, fondo #F4F7FC, superficie #FFFFFF, tinta #152343, secundario #53617A; Manrope local. Se comparó grid de tarjetas con lista jerárquica: se elige lista con padres e hijas alineados, pestañas Gastos/Ingresos, búsqueda, filtro de archivo y acción Nueva categoría. Colores/iconos comunican identificación, no métricas financieras. Móvil mantiene acciones por fila, dialog y campos apilados. Sin nuevas dependencias.

Alcance: categorías propias reales y plantillas opcionales por usuario, ingreso/gasto y dos niveles, nombre 1–80, descripción hasta 300, colores/iconos permitidos, archivo/restauración, unicidad de nombre insensible a mayúsculas entre hermanas (incluye archivadas). Tipo/padre inmutables como decisión conservadora; archivo efectivo por padre sin alterar estados individuales. Límite técnico inicial de 200 por usuario incluyendo archivadas. Perfil bloqueado por dueño para serializar comandos; alta idempotente, control de versión y auditoría mínima. Antes del ledger coordinar sus bloqueos de categoría/ancestro. Sin movimientos reales o costes.


Resultado A-05: categorías propias implementadas con migración aditiva aplicada localmente. Sin servicios, variables o dependencias nuevas. Se retiraron las clases pedidas, sus estilos y la entrada de simulación del onboarding; Abrir simulación solo en sidebar/menú móvil. Categorías sale de la muestra antes de operar datos reales.

Validación: 129 unitarias, 57 integración y 32 E2E (218 en total). Se probaron creación/personalización, respuesta perdida y reintento, jerarquía y nombres, archivo del padre/individual, restauración, conflictos, sesión expirada, lectura fallida, aislamiento A/B, rol efectivo, cuota concurrente y rollback completo de inicialización. Capturas de lista/dialog a 320/390/768/1440 px. Revisión visual ajustó contraste de hijas y estado sin categorías activas. TypeScript, ESLint y build de producción correctos. Siguiente entrega: ingresos y gastos reales, con las puertas SQL de cuentas/categorías documentadas. Sin push, fusión de main o despliegue.


## A-06 — Ingresos/gastos reales y retirada total de simulación

Autorización explícita: eliminar toda simulación y avanzar con ingresos/gastos reales. Preferencia del usuario confirmada: «Formulario dentro de la página». Rama feat/real-income-expenses, basada en 7de41bc. Operate, extensión de la identidad Finzi, sin nueva marca o imágenes decorativas.

Plan: historial paginado con filtros y formulario inline desplegable; el tipo en selección nativa, importe en moneda de cuenta y vista previa del efecto. Mantener Manrope, azul #1D4ED8, fondo #F4F7FC, tinta #152343 y semántica verde #16765A/gasto #B5473D. Sidebar, encabezado y bordes alineados; móvil apila filtros, formulario y filas. Comparada con formulario modal, se elige la composición dentro de página por preferencia expresa. Copia de tarea directa: Registrar ingreso / Registrar gasto, sin cifras ficticias.

Frontera financiera: movimiento+partida firmada+auditoría+clave propia atómicos, importes exactos y positivos, PEN/USD separados, fecha UTC no futura ni anterior a apertura, categoría/cuenta propias y activas (incluye padre), saldos reconstruidos. Serialización por perfil antes de cuentas/categorías para coordinar archivo y apertura. Apertura bloqueada con cualquier historia, incluida anulación. Anulación explícita con motivo, sin borrar partidas o reabrir apertura; reemplazos y transferencias siguen posteriores. Límite técnico inicial revisable: 10000 movimientos por usuario, incluyendo anulados; página máxima 50. No nuevas dependencias o servicios.


### Verificación de diseño A-06 — alcance y límites

GATE: OPEN 22 (rounds used up). El gate de design-taste-frontend se ejecutó sobre /dashboard con un navegador sin sesión y fue redirigido al login. No certifica el ledger privado. Se conservaron sus 22 hallazgos abiertos, sin waivers ni cambios para ocultarlos. El script de layout no pudo ejecutarse: no Chrome found (set CHROME_PATH). No se declara aprobación de layout/perf de esa herramienta para la pantalla financiera.

La identidad y el sistema Finzi existentes se mantienen: Manrope local, azul aprobado, logo de pestaña. Modo Operate, formulario dentro de página confirmado por el usuario, sin hero promocional, efectos o activos raster nuevos. Voz: español directo de tarea, términos estables cuenta/categoría/ingreso/gasto, sin hechos comerciales inventados. No hay fotos, contactos, nombres nuevos o precios supuestos. El sistema visual existente se preserva; no se reparan sidecars de skills no solicitados.

Los 7 WARN del gate se conservaron: copy-buttons, copy-actions, section-gaps, link-styles y empty-area entre los identificados por la salida; corresponden al login inspeccionado. Ver el registro local .taste-skill/gate.json para el resultado completo de la herramienta. La verificación autenticada se realiza con E2E real y revisión visual independiente, con sus alcances propios.

| # | Check abierto | Elemento inspeccionado | Hallazgo del gate |
| --- | --- | --- | --- |
| 1 | hero-fill | main#main > div.auth-content > header.auth-header "¿Primera vez en Finzi? Crear cuenta" | the next section shows on the first screen: it starts at 66px on a 900px screen (the hero ends at 866px) |
| 2 | flush | main#main > aside.auth-intro > p.intro-foot "Siempre gratis. Sin publicidad." | aside.auth-intro and header.auth-header run together: -760px between their content, on one ground |
| 3 | cta | main#main > aside.auth-intro | the hero has no button (the nav's does not count) |
| 4 | copy-headline | div.auth-content > div.auth-task > div.form-heading > h1 "Iniciar sesión" | "Iniciar sesión" does not name what is sold (finanzas personales, finanzas, personales, from flags) |
| 5 | copy-fact | div.auth-content > div.auth-task > div.form-heading > h1 "Iniciar sesión" | the first screen holds no number, price, date, place, platform or genre |
| 6 | tilt | main#main > aside.auth-intro > div.brand-art > svg | rotated -11.0° |
| 7 | focus-ring | .setup-main h1:focus | ".setup-main h1:focus" in 154i62c0ox6dd.css removes the focus outline and sets nothing in its place |
| 8 | focus-ring | .home-title-row h1:focus | ".home-title-row h1:focus" in 154i62c0ox6dd.css removes the focus outline and sets nothing in its place |
| 9 | moment-none | (the page) | a software page (--type) deals no moment: every kind carries one, two on a long page (moments.md) |
| 10 | hero-screen | main#main > aside.auth-intro "finziDale espacioa tus finanzas.Un comie" | the hero ends at 866px on a 900px screen, 34px above the fold: it ends at the fold, 1px either way (SR-1) |
| 11 | hero-screen | main#main > div.auth-content "finzi¿Primera vez en Finzi?Crear cuentaI" | 866px of the next section shows on the first screen (from 34px on a 900px screen): nothing below the hero shows at load (SR-1) |
| 12 | section-height | main#main > div.auth-content "finzi¿Primera vez en Finzi?Crear cuentaI" | the section is 832px tall (0.9 screens), 68px short of one screen (900px): every section after the hero is one screen or two, 2px either way (SR-2) |
| 13 | one-section | div.auth-content > div.auth-task > div.form-heading > h1 "Iniciar sesión" | the screen at scroll 0px (stride 0) shows 832px of section 2 and the heading of section 2 whole and the content of 2 sections, over 24px each beside section 1: a screen shows one section (another may peek 8px, 24px WARN) (SR-4) |
| 14 | one-section | main#main > aside.auth-intro "finziDale espacioa tus finanzas.Un comie" | a <aside> sits directly in <main>: every part of <main> is a <section> (SR-4) |
| 15 | one-heading | div.auth-content > div.auth-task > div.form-heading > h1 "Iniciar sesión" | headings of two sections show whole on one screen at 1 of 1 scroll positions (100%; at scroll 0px), here with "Dale espacioa tus finanzas.": at most 3% on a desktop (SR-5) |
| 16 | container-edges | div.auth-page "Saltar al contenidofinziDale espacioa tu" | a <div> at the top of the page, outside header.nav, main, footer.closing and nav.actionbar (SR-6) |
| 17 | container-edges | main#main > aside.auth-intro "finziDale espacioa tus finanzas.Un comie" | the section needs exactly one in-flow child .wrap (it has 4 in-flow children, 0 .wrap) (SR-6) |
| 18 | container-edges | main#main > div.auth-content "finzi¿Primera vez en Finzi?Crear cuentaI" | the section needs exactly one in-flow child .wrap (it has 3 in-flow children, 0 .wrap) (SR-6) |
| 19 | container-edges | div.auth-content > header.auth-header > nav > span "¿Primera vez en Finzi?" | 1 text block starts on a left line at x 1152, 1152px from the container's left: text starts on the container's left, or on one split line (x 610, 732, 854) (SR-6) |
| 20 | container-edges | div.auth-content > div.auth-task > div.form-bottom > p "¿Todavía no tienes cuenta? Crear cuenta" | 1 text block starts on a left line at x 939, 939px from the container's left: text starts on the container's left, or on one split line (x 610, 732, 854) (SR-6) |
| 21 | container-edges | div.auth-content > div.auth-task > div.form-heading > h1 "Iniciar sesión" | 4 text blocks start on a left line at x 863, 863px from the container's left: text starts on the container's left, or on one split line (x 610, 732, 854) (also "Escribe tus datos para entrar a ", "Correo electrónico", "Contraseña") (and 2 more like it: "Iniciar sesión", x 76) (SR-6) |
| 22 | text-only | main#main > div.auth-content > div.auth-task "Iniciar sesión" | the closing section is only text: no picture, icon, mock or effect in it |


### Resultado A-06

Implementado y validado localmente. 133 pruebas unitarias, 80 integración y 37 E2E de producción aprobadas (250 total). Después de añadir verificación de foco de fecha servidor, se corrigió el foco para ejecutarse tras reactivar campos y se repitieron los tres escenarios afectados, también aprobados. TypeScript, ESLint y build de producción correctos. Las regresiones de Categorías/onboarding vistas con servidor de desarrollo no se reprodujeron en producción; la suite completa pasa sin ampliar timeouts. El recorrido de sesión expirada de Cuentas se ajustó a la nueva entrada de primera cuenta.

Revisión visual independiente de Impeccable: disposition ship, cinco secciones completas, sin correcciones materiales en el alcance inspeccionado. 19 capturas válidas: Inicio/historial/formulario a 1440/1024/768/390/320 px y cuatro estados complementarios (fecha inválida, guardado incierto, lectura fallida y anulación) a 1280. Se validaron capturas desde el inicio del documento para evitar artefactos de screenshot en elementos sticky/fixed. La revisión no es una auditoría de seguridad o certificación de rendimiento.

Se conserva DESIGN.md y el sistema Finzi por ser extensión Operate; ningún activo raster nuevo. Registro local del contrato en .impeccable/surfaces/src-app-dashboard-page-tsx.md. El gate genérico queda OPEN 22 con el alcance de login y las limitaciones descritas arriba, sin waivers; no se presenta como aprobado. Simulación retirada del producto, incluyendo modelo, fixtures, acceso, formularios y exportación. Transferencias y reemplazos siguen pendientes. Sin dependencias, servicios, claves, costes, push o fusión a main.


WARN conservados del gate (login):

- copy-buttons: div.auth-content > div.auth-task > form.auth-form > button.button.button-primary "Iniciar sesión" — "Iniciar sesión" does not start with a verb (book, buy, try, start, get, see...) Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- copy-actions: (the page) — the main action "Registrar movimiento" does not read word for word the same in the nav or hero and the closing section Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- section-gaps: main#main > aside.auth-intro / main#main > div.auth-content > header.auth-header — the sections overlap by 760px Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- link-styles: main#main > aside.auth-intro > a.wordmark "finzi" — text links in 3 looks: no line, bold (1, like "finzi"); underline, bold (2, like "¿Olvidaste tu contra"); underline, regular (1, like "Reenviar correo de c") Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- empty-area: main#main > div.auth-content "Iniciar sesión" — 42% of the section is empty: 112px of empty rows between its content, 29% beside content that covers under half the container, in its 832px of rows (WARN over 35%, FAIL over 50%) Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- share-meta: head — the head lacks og:image: a shared link shows no picture or title of its own Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.
- link-styles: main#main > div.auth-content > header.auth-header > a.wordmark.mobile-brand "finzi" — text links in 3 looks: no line, bold (1, like "finzi"); underline, bold (2, like "¿Olvidaste tu contra"); underline, regular (1, like "Reenviar correo de c") Motivo de conservación: login heredado fuera del alcance de la interfaz financiera actual.


## A-07 — Fase 7: transferencias y reemplazos trazables

Autorización explícita del usuario (14/11/2026): implementar la fase completa con buena interfaz, usando frontend-design, impeccable y design-taste-frontend y limitando visualización de imágenes. Rama dedicada feat/transfers-and-replacements creada desde 503d528; main no se modifica. Conserva preferencia «Formulario dentro de la página», identidad azul Finzi/Manrope, logo existente y gratuidad. No simulación ni ampliación a módulos posteriores.

### Funcionalidades entregadas

- Transferir: origen/destino propios, distintos, activos y de la misma moneda PEN o USD; importe exacto positivo y fecha no futura ni anterior a ambas aperturas. Sin categoría o FX. Selector filtra destinos; explica falta de otra cuenta. Preview de saldos actual/resultante por cuenta y aviso de negativos. Dos partidas opuestas confirman juntas; saldo total de la moneda conservado.
- Corregir: original visible y formulario inline para tipo, cuentas, importe, categoría, descripción, nota y fecha. Motivo obligatorio y revisión explícita que se desmarca al editar. El instante exacto original se conserva si no se toca fecha, sin truncarlo a los minutos mostrados. Referencias archivadas se conservan identificadas y exigen selección activa.
- Un solo comando anula original y crea sucesor con partidas, vínculos, versión y eventos. Original y partidas inmutables; un sucesor como máximo por registro; cadena navegable. Corregir una divisa equivocada retira un registro y crea otro explícitamente en su cuenta, sin conversión.
- Historial distingue Anulado/Reemplazado/Vigente y permite filtrar transferencia/reemplazados. Una transferencia aparece una vez al consultar cualquiera de sus cuentas. Ingresos/gastos/flujo excluyen transferencias incluso por cuenta. Inicio integra movimientos recientes y saldos reales sin inflar flujo. El detalle recorre anterior/sucesor fuera de filtros/página y conserva los filtros.
- Anular una transferencia retira ambos efectos atómicamente; anular un original ya reemplazado no revierte su sucesor. Anular un sucesor conserva la cadena. Formularios de anulación tienen una sola instancia por superficie activa; filtros/paginación y navegación no desmontan una operación pendiente.
- Clave por usuario y payload canónico para reintentos, incluso tras anular/corregir de nuevo. Incertidumbre fija campos; conflicto conserva borrador y exige actualizar. Lectura de saldos actualizada antes de abrir formulario y después de confirmar. Límite previo de 10000 incluye sucesores: un reemplazo nuevo a cuota falla sin anular original, reintento confirmado sigue funcionando.

### Persistencia, contratos y seguridad

Migraciones aditivas locales 20261114000800_transfers_replacements.sql y 20261114000900_replacement_constraint_alias.sql. La segunda resuelve una colisión del alias old con OLD implícito del trigger detectada en la primera integración; no se reescribe una migración aplicada. No reset ni borrado de usuarios existentes.

transactions admite transfer/category_id nula solo para ese tipo, referencia al predecesor/versión/motivo inmutables y sucesor único con FK compuesta de dueño. Unicidad de entradas pasa a usuario/movimiento/cuenta. Restricción diferida valida una partida para ingreso/gasto o dos cuentas/partidas opuestas y divisa/fechas coherentes para transferencias; valida predecesor anulado con motivo/versión. Eventos posted/voided/replaced append-only. Vista privada security_invoker devuelve una fila por operación y respeta FORCE RLS. APIs nuevas post_transfer/replace_movement/read_movement y extensión de read/void; sin permisos DML directos a authenticated/anon. RPC públicas poseen el mismo app_executor restringido y sin bypass; escritor interno invoker no expuesto.

Bloqueo de perfil verificado/completo primero, luego cuentas ordenadas por UUID incluyendo anteriores archivadas, categoría/ancestro. Cambios coordinados con comandos anteriores. Valida el saldo final sobre retirar efecto original + aplicar nuevo juntos, sin exponer/rechazar estados intermedios. SQL numeric y TS bigint; no float, claves administrativas o payloads en logs. API mantiene sesión verificada, origen/CSRF, cuerpo acotado, esquema estricto, errores recuperables/no enumeradores y private/no-store. GET detalle por id no combina filtros y omite dueño/requestId. Cambios preservan docs/context.md y .gitignore.

### Validación y diseño

148 unitarias y 105 integración real aprobadas. Conservación por moneda, exactitud/negativos, rangos al crear/anular/reemplazar, cuentas/divisas/fechas, archivo concurrente y transferencias inversas; motivo/versión/único sucesor, cadenas e inmutabilidad; carreras reemplazar/reemplazar y anular/reemplazar; rollback inducido de segunda partida y auditoría que restaura original y libera clave; cuota/reintentos y aislamiento de usuarios/roles efectivos, incluido escritor privado.

Suite E2E completa de producción: 43 aprobadas. Comprueba módulos anteriores y seis recorridos nuevos de fase 7: transferencia/anulación con total conservado, corrección e instante exacto, trazabilidad fuera de filtro, confirmación perdida, conflicto, seguridad y falta de destino; teclado y layout a 320/390/768/1024/1440. Durante pruebas se detectó una previsualización con saldo previo después de otra escritura; se corrigió actualizando antes de abrir. Revisión final separó la instancia de anulación del historial de la del detalle para evitar duplicación de formulario/IDs al consultar el mismo registro en ambas superficies. Revalidación proporcional final de 13 E2E de Movimientos/fase7 aprobada después de esos ajustes, incluida la anulación desde trazabilidad con una única instancia de formulario.

TypeScript, ESLint y build de producción correctos. Dos imágenes nuevas inspeccionadas exclusivamente por finish-reviewer fresco de Impeccable (sin fork del contexto), por petición del usuario: transferencia desktop y corrección móvil. disposition ship: persistence pass; fidelity match en tipografía/material/fondo, inline, saldos, comparación, confirmación, responsive y foco visibles; ceiling adecuado a extensión Operate; material_fixes ninguno; keep: formulario inline, separación de saldos y original visible. No tarjeta QUALITY BAR externa aportada. Revisión visual no prueba seguridad, contraste medido o rendimiento. No se abrieron más imágenes para esta fase; las capturas de regresiones anteriores que genera la suite no se inspeccionaron.

DESIGN.md preservado; contrato de superficie local ampliado para A-07. Sin nuevos raster o assets que requieran procedencia. Gate genérico anterior permanece OPEN22 sobre login y controles de marketing, con hallazgos/limitaciones ya registrados en A-06; no se reinicia, no se usan waivers ni se lo presenta como aprobado para la UI privada. Las tres skills se aplican sobre la identidad existente.

ROADMAP fase7 implementada, paso8 siguiente. Contrato detallado local docs/development/TRANSFERS_REPLACEMENTS.md; decisiones/índice/modelo/diccionario/reglas/guía actualizados localmente. El .gitignore del usuario mantiene docs/ y solo ROADMAP está versionado por la excepción previamente autorizada; este registro y README conservan el contrato/revisión esenciales en Git. Sin dependencias, servicios, variables/credenciales, costes, push, fusión o despliegue. N-01–N-06 y fases restantes mantienen sus puertas antes de lanzamiento.


## A-08 — Paso 8: Historial e Inicio sobre movimientos reales

Autorización explícita del usuario: desarrollar funcionalidades necesarias del paso 8 usando frontend-design, impeccable y design-taste-frontend, ahorrando créditos. Rama dedicada feat/history-and-real-overview desde c179b79; main intacto. Concreciones técnicas de esta entrega son revisables, no nuevas decisiones expresas del usuario. Identidad Finzi/Manrope/azul y formulario inline conservados, sin simulación ni capacidades de fases futuras.

### Resultado funcional

- Inicio usa moneda y cuenta (también archivadas), día, semana, mes, trimestre, año o personalizado. Navegación entre períodos sin adelantar futuros. Saldo actual separado de ingresos/gastos/flujo del intervalo, actualizados con la misma instantánea/corte. Comparación anterior completa del mismo tipo; custom compara igual número de días. Período en curso y base cero identificados, diferencia monetaria exacta y sin sugerir que subir/bajar implica mejora financiera.
- Evolución de saldo reconstruido por cierres locales, diaria hasta 93 días inclusivos y mensual después. Antes de apertura null, no cero; días sin operaciones con flujos cero y saldo real si había cuenta. Sin futuros; cierre de hoy hasta ahora. Un cierre único se identifica como datos insuficientes, sin curva ficticia. Tabla de cifras exactas y acceso al ledger por cada cierre.
- Distribución de ingresos/gastos agrupa padre+hijos una sola vez, ofrece desglose y acceso a movimientos de la categoría. Aperturas/transferencias excluidas del flujo incluso al filtrar cuenta; transferencias sí afectan evolución de la cuenta. Cuentas y recientes navegables, con moneda/período coherentes y detalle por UUID propio. Totales calculados sobre todo el conjunto, no primeras páginas o cinco recientes.
- Historial conserva en memoria filtros aplicados, borrador de filtros, búsqueda, cursor/páginas anteriores y trazabilidad al cambiar de vista. Inicio conserva selección al volver. Limpiar filtros conserva moneda, vuelve a todo el historial/primera página y no modifica registros. Sin resultados distinto de sin movimientos de la moneda. No se almacenan búsquedas en URL/localStorage.
- Duplicación intencional disponible desde vigente/anulado/reemplazado: prellena formulario inline con clave nueva y Ahora por defecto, exige confirmar importe/fecha y permite cambiar referencias archivadas por activas. No guarda automáticamente, altera original o crea enlace de reemplazo. Reintentos de cada duplicado siguen usando su propia clave.
- Loading/error no inventan ceros; datos previos solo se mantienen para mismos filtros. Cambio de moneda/período/cuenta oculta resultados de la consulta anterior. Mensajes de recuperación y navegación/teclado mantienen acciones reales.

### Contrato, seguridad y límites

Migración aditiva local 20261114001000_real_reporting.sql; ninguna tabla nueva, cambio de reglas de escritura o permiso DML adicional. api.read_overview STABLE SECURITY DEFINER, owner app_executor sin bypass, FORCE RLS de fuentes y vista security_invoker; misma instantánea MVCC y as_of=statement_timestamp. No bloquea escrituras ni usa caché de saldo mutable. GET /api/v1/overview con esquema estricto, identidad verificada/perfil completo, no-store, cuenta ajena/inexistente indistinguible y sin exponer user_id. Ninguna clave administrativa en aplicación; SQL de fixtures exclusivamente en pruebas locales sintéticas con roles efectivos.

Calendario en zona del perfil, semana lunes–domingo, trimestre calendario; preset conserva período completo y avisa comparación anterior completa cuando actual está en curso. Custom desde 1900, hasta 3660 días inclusivos terminado hoy o antes; comparación de igual duración local. Hasta 122 puntos de serie. Dinero siempre numeric/cadenas/bigint; SVG/proporciones convierten solo ratios enteros acotados, no dinero completo a Number. Saldo de cuentas archivadas incluido; correcciones cambian historia vigente, sin promesa de reconstrucción de lo que se veía antes. Estado de filtros dura navegación del documento; recargar lo reinicia.

### Validación

162 unitarias aprobadas. 105 pruebas de integración anteriores pasaron en la corrida completa; 16 nuevas de reporting aprobadas tras corregir el cast de metadatos del test (provolatile char), sin cambiar aplicación por esa falla. Total integración: 121. Reconcilian tarjeta/ledger/cuentas/distribución, más de una página, últimos cinco vs agregado completo, precisión sobre Number, negativos, archivos, reemplazos entre períodos y anulación, series/huecos/aperturas, períodos anteriores y custom, corte actual, monedas/RLS/roles y días DST de 23/25 horas. Un primer esperado de apertura se corrigió porque 01/01 UTC pertenece al 31/12 local de Lima; la implementación ya aplicaba el calendario correcto.

49 E2E completos de producción aprobados, incluidos seis nuevos de paso8: consulta/subyacentes, retorno/selección/filtros/cursor, todos los períodos y tabla, recientes/trazabilidad, duplicación explícita y confirmación, sesión/parametrización/lectura fallida, cinco anchos y teclado. Se corrigieron selectores de alertas del test para excluir el anunciador interno de rutas Next, sin alterar producto. Total de casos: 332. TypeScript, ESLint y build de producción correctos.

Finish-reviewer fresco inspeccionó exclusivamente dos capturas nuevas (Inicio desktop e historial móvil), sin abrir más imágenes: disposition ship, fidelity match en tipografía/material/fondo, separación saldo/flujos, períodos/comparación, punto real con aviso y acceso a tabla, distribución y ledger, historial móvil. material_fixes ninguno. QUALITY BAR externo no aportado; PRODUCT/DESIGN no inspeccionados independientemente por el revisor por alcance restringido, preservación verificada en Git. La revisión visual no acredita seguridad ni accesibilidad programática: se verifican funcionalmente aparte. Capturas previas producidas por suites de regresión no se inspeccionaron. Sin raster nuevo, assets o llamadas de generación de imágenes. DESIGN.md preservado y contrato local de superficie A-08 guardado. Gate genérico heredado permanece OPEN22 sobre login/marketing con límites ya registrados; sin reiniciar, waivers o aprobación ficticia de UI privada.

ROADMAP actualizado: paso8 implementado, siguiente paso9 perfil/seguridad. README conserva contrato/alcance básico versionado; contrato local detallado docs/development/REAL_REPORTING.md y decisiones/índice/MVP/reglas/pantallas/guía/modelo documentados. Se respeta .gitignore del usuario: solo ROADMAP se versiona dentro de docs/ según excepción existente; este registro incluye evidencia/decisiones esenciales. docs/context.md intacto. Sin nuevas dependencias, servicios, variables/secretos, costes, publicación, push o fusión. Pendientes N-01–N-06 mantienen hitos de lanzamiento.
