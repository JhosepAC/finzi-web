# Roadmap de Finzi

Actualizado: 15 de noviembre de 2026. Desarrollo individual, presupuesto cero. D-01–D-10 aprobadas. Las autorizaciones A-01–A-12 permiten las entregas indicadas; no autorizan costes, publicación ni implementación automática de todo el producto.

## Avance por interfaces y funcionalidades

| Paso | Entrega | Estado | Resultado y puerta de salida |
| --- | --- | --- | --- |
| 1 | AUTH y rediseño | Completado; integrado en main, 345dea9 | Registro, correo, acceso, recuperación y cierres local/global |
| 2 | Onboarding financiero | Completado, f86fea4 | Nombre, PEN/USD y zona horaria persistidos; revisión y edición con control de versión |
| 3 | Inicio del dashboard | Actualizado — A-06 | Solo saldos y resumen mensual reales; la muestra de 5c8b74f fue retirada por solicitud expresa |
| 4 | Cuentas y saldos iniciales | Implementado — A-04, feat/accounts-and-opening-balances | Alta, listado, edición, archivo/restauración, aperturas exactas y totales por moneda; RPC, RLS, reintentos y concurrencia probados localmente |
| 5 | Categorías propias | Implementado — A-05, feat/personal-categories | Ingreso/gasto, dos niveles, personalización, plantillas propias opcionales, búsqueda y archivo efectivo; RLS, concurrencia y reintentos probados |
| 6 | Ingresos y gastos reales | Implementado — A-06, feat/real-income-expenses | Formulario inline, historial paginado, filtros, partidas firmadas, anulación con motivo, RLS/idempotencia/atomicidad y apertura bloqueada con cualquier historia |
| 7 | Transferencias y reemplazos trazables | Implementado — A-07, feat/transfers-and-replacements | Formulario inline con ambos saldos, anulación atómica, corrección con motivo/versión y cadena navegable fuera de filtros; transferencias excluidas del flujo |
| 8 | Historial e Inicio sobre movimientos reales | Implementado — A-08, feat/history-and-real-overview | Seis períodos, comparación, cierres exactos con tabla, distribución padre/hijos y acceso al historial; filtros/cursor conservados y duplicación explícita |
| 9 | Perfil y seguridad completos | Implementado — A-09, feat/profile-and-security | Perfil directo, preferencias con aviso/auditoría/conflictos; estado, reautenticación de un uso y contraseña; cierres local/global. Dispositivos avanzados diferidos |
| 10 | Exportación y eliminación | Implementado localmente — A-10 | JSON/CSV privados, bloqueo inmediato, proceso reintentable, manifiesto cifrado externo y seguimiento sin identidad; retención pública pendiente antes del lanzamiento |
| A-11 | Deudas — extensión autorizada | Implementado localmente, feat/debt-management | CRUD, resumen y disponible PEN/USD; vencimientos y filtros; pagos como gasto nuevo o existente, sin duplicación; correcciones/anulaciones sincronizadas, RLS y portabilidad |
| A-12 | Estadísticas — extensión autorizada | Implementado localmente, feat/financial-statistics | Cinco indicadores, cuatro gráficos interactivos, seis períodos, comparación/categorías y tabla exacta; solo ledger real, ahorro positivo confirmado |
| 11 | Endurecimiento y piloto | Pendiente | HTTPS, correo, requisitos legales/edad, aislamiento en entorno final, cuotas, respaldo y restauración; sin SLA de planes gratuitos |

El avance por etapa requiere una entrega revisable en rama dedicada, pruebas proporcionales y actualización de este archivo. main permanece estable; no se fusiona ni se publica automáticamente por completar una interfaz. [Registro detallado](../../IMPLEMENTATION_PROGRESS.md).

## Entrega actual: cuentas — A-04

Continuación solicitada por el usuario después de Inicio. Permite registrar efectivo, cuenta bancaria, ahorros u otra cuenta personal, con nombre, moneda y saldo de apertura. Moneda, tipo y fecha de apertura son inmutables. La fecha la asigna el servidor al guardar y se muestra en la zona del perfil; no se admiten aperturas retroactivas o futuras desde la interfaz actual.

Las aperturas admiten cero e importes negativos y usan dinero exacto, hasta 16 dígitos enteros y 2 decimales. No son ingresos. PEN/USD nunca se suman entre sí. Archivar oculta la cuenta del listado activo, conserva sus datos y mantiene su importe en el total, como indica la interfaz. Se puede restaurar.

Límite técnico inicial: 100 cuentas por usuario, incluidas las archivadas; el servidor lo comprueba de forma serializada. Es una decisión de implementación revisable, no una capacidad contratada. No se guardan números bancarios, credenciales bancarias o datos de muestra en las cuentas reales. No se añaden dependencias, servicios cloud o variables de entorno.

Ver [contrato y validación de cuentas](../development/ACCOUNTS.md). Desde A-06 existe ledger real: la apertura solo se corrige sin historia. Un trigger SQL bloquea su modificación con cualquier partida, incluso anulada; cuenta/categoría y publicación coordinan sus bloqueos por perfil. La UI recibe la capacidad de edición desde la lectura real.

## Puertas de las próximas entregas

1. Siguiente entrega: paso 10, exportación y eliminación con retención, reautenticación y recuperación acordadas antes de habilitar borrado. Paso 9 completa perfil/seguridad del MVP; dispositivos avanzados/MFA siguen diferidos. No anticipar costes, publicación o funciones fuera del alcance.
2. Ledger: precisión, aislamiento A/B con roles efectivos, atomicidad, concurrencia y reintentos reales. Saldos reconstruibles y correcciones por reemplazo. Coordinar bloqueos de cuenta, categoría/ancestro y perfil con los comandos existentes; impedir aperturas editables con cualquier historia.
3. MVP: métricas reconciliadas, exportación/eliminación, accesibilidad y recuperación comprobadas antes del piloto.
4. Lanzamiento: resolver los pendientes N-01–N-06 del [registro de decisiones](../architecture/DECISIONS.md), sin comprometer costes o disponibilidad no garantizada.

## Fuera del MVP

Presupuestos y metas, recurrencias/archivos/reglas/avisos, crédito, FX, bancos, móvil e IA requieren especificación y autorización posteriores. Figurar aquí no autoriza su desarrollo. Finzi seguirá gratuita, sin publicidad, premium, suscripciones ni monetización. Si un recurso gratuito resulta insuficiente, se limita capacidad o se presenta otra opción gratuita; no se activa pago automáticamente.


## Entrega A-05: categorías propias y simulación

Categorías de ingreso/gasto persistidas por usuario, con un nivel de subcategorías. Se puede personalizar nombre, descripción, color e icono, buscar y archivar/restaurar. Se ofrecen 6 categorías iniciales de gasto y 4 de ingreso como copia propia opcional; los reintentos no duplican ni reemplazan personalizaciones.

Concreciones técnicas revisables: 200 categorías por usuario incluyendo archivadas; nombre único entre hermanas del mismo tipo, insensible a mayúsculas y conservando acentos; tipo/padre inmutables desde creación. El archivo del padre vuelve inactivas las hijas sin cambiar su estado individual; restaurar el padre no restaura una hija archivada por separado. No hay eliminación destructiva ni movimientos reales en esta entrega.

Se retiraron home-footer y real-sample-link y la opción de muestra del onboarding. Registro histórico de A-05, revocado por A-06: Abrir simulación vivía únicamente en el sidebar y su menú móvil. El aviso y la salida de la muestra se conservan para identificar los datos sintéticos. Categorías siempre trabaja con datos propios reales. Ver [contrato](../development/CATEGORIES.md) y [registro](../../IMPLEMENTATION_PROGRESS.md). Sin nuevas dependencias o costes.


## Entrega A-06: retiro de simulación e ingresos/gastos reales

Solicitud explícita: eliminar toda simulación y trabajar con datos reales. El usuario eligió «Formulario dentro de la página». Se retiraron modelo/fixtures del cliente, formularios, accesos, estilos exclusivos y exportación de muestra. Inicio usa datos propios y el parámetro antiguo de muestra no activa ningún comportamiento especial. Categorías iniciales siguen siendo taxonomía propia opcional, no finanzas ficticias.

Ingreso/gasto, partida firmada, auditoría e idempotencia se confirman juntos. Fecha real UTC con zona del perfil, nunca futura ni anterior a apertura; cuenta/categoría/ancestro propios y activos. Anulación explícita con motivo conserva el rastro. Historial con cursor, búsqueda, filtros y totales sobre el filtro completo. PEN/USD independientes y apertura fuera de ingresos. El gasto puede dejar saldo negativo con advertencia. La apertura queda bloqueada con cualquier historia, incluso anulada.

Concreciones técnicas revisables: hasta 10000 movimientos por usuario incluyendo anulados, páginas de 25 (máximo 50), rango de saldo actual por cuenta de ±9999999999999999.99. La selección manual de horas ambiguas por DST se rechaza; Ahora usa un instante inequívoco del servidor. Sin transferencias, reemplazos, exportación completa o análisis avanzados por anticipado. Sin nuevas dependencias, servicios o costes.

Validación funcional: 133 unitarias, 80 integración real y 37 E2E de producción, 250 en total; TypeScript, ESLint y build. Capturas de Inicio/historial/formulario a 320/390/768/1024/1440 px. Ver [contrato](../development/MOVEMENTS.md) y [registro](../../IMPLEMENTATION_PROGRESS.md) para límites de la revisión de diseño y pendientes de lanzamiento.


## Entrega A-07: transferencias y reemplazos trazables — fase 7

Autorización expresa del usuario para toda la fase 7, manteniendo formulario dentro de la página y el sistema visual Finzi. Transferencia entre cuentas propias activas, distintas y de la misma moneda; sin categoría/FX. Dos partidas opuestas, auditoría e idempotencia atómicas. Fecha no futura y posterior o igual a ambas aperturas. Aviso de saldo negativo, no bloqueo. Previsualización de ambos saldos; lectura actualizada antes de abrir el formulario. Se conserva el total de la moneda, incluidas cuentas archivadas; transferencias fuera de ingresos/gastos incluso con filtro de una sola cuenta. Anulación retira ambas partidas del cálculo, conservándolas.

Corregir abre el original y el formulario inline: tipo, origen/destino, importe, categoría, descripción, nota y fecha; motivo obligatorio y revisión explícita. Versión esperada, anulación original, nuevo registro, partidas, vínculo y eventos confirman juntos. Un único sucesor, cadena sin ciclos y sin reescribir historia. Si no se edita la fecha, conserva el instante exacto. Las referencias archivadas exigen selección activa para el reemplazo. Cambiar una moneda equivocada es corrección explícita de registros, sin convertir dinero.

Historial distingue Vigente, Anulado y Reemplazado, filtra transferencias/reemplazados y recorre anterior/sucesor independientemente de filtros o paginación. Inicio integra transferencias recientes sin sumarlas al flujo. Reintentos con clave estable incluso después de anular o volver a corregir; pérdida de confirmación conserva campos, conflicto retiene borrador y exige actualizar. Fallos de partidas/auditoría revierten toda la operación. El límite de 10000 incluye reemplazos: alcanzar cuota rechaza una corrección nueva sin anular el original; un reintento previo sigue permitido.

Migraciones aditivas 20261114000800/00900 aplicadas solo al entorno local. No se añaden dependencias, costes, servicios, secretos o variables. Sin publicación, push o fusión a main. Siguiente puerta: completar paso 8; N-01–N-06 mantienen sus hitos de lanzamiento.

Validación: 148 unitarias, 105 integración real y 43 E2E de producción aprobadas (296 total); revalidación final proporcional de 13 E2E de Movimientos/fase7 también aprobada. Dos capturas nuevas inspeccionadas por finish-reviewer fresco: escritorio de transferencia y móvil de corrección, disposición ship sin ajustes materiales. Anchos 320/390/768/1024/1440 y teclado comprobados funcionalmente; sin nuevas imágenes de producto. [Contrato](../development/TRANSFERS_REPLACEMENTS.md) y [evidencia](../../IMPLEMENTATION_PROGRESS.md).


## Entrega A-08: Historial e Inicio sobre movimientos reales — paso 8

Solicitud explícita del usuario, manteniendo las tres skills de diseño y ahorrando créditos. Extensión de Finzi sobre datos reales, sin nuevas dependencias, imágenes de producto o servicios. Rama dedicada feat/history-and-real-overview; no fusión automática.

Inicio: moneda PEN/USD y cuenta (incluidas archivadas); día, semana, mes, trimestre, año y personalizado, con navegación entre períodos anteriores. Saldo actual separado de ingresos/gastos/flujo del período. Comparación con período anterior del mismo tipo; personalizado usa igual número de días locales anteriores. Base cero: «Sin base de comparación» y diferencia exacta. Período en curso indica comparación con anterior completo, sin atribuir ventajas financieras a signos/colores.

Evolución por cierres diarios o mensuales reales, tabla exacta con acceso a sus movimientos y huecos previos a apertura sin valores inventados. Cierre de hoy hasta el instante de consulta; aperturas/transferencias afectan saldo, no flujos. Distribución de ingresos/gastos por padre incluye hijos una sola vez y ofrece desglose/acceso al ledger. Cuentas y recientes llevan a los registros de la misma moneda, cuenta y período. Historial conserva filtros, búsqueda, cursor y detalle en memoria al cambiar de vista; limpiar filtros vuelve a primera página sin borrar registros. Duplicación intencional abre formulario con clave nueva, exige revisar importe/fecha y no crea vínculo de reemplazo.

Concreciones técnicas revisables: semana lunes–domingo y trimestres calendario; personalizado hasta 3660 días terminado hoy o antes; series diarias hasta 93 días y mensuales en intervalos mayores, máximo 122 puntos; comparación con períodos completos. La RPC read_overview es STABLE y solo lectura: todas las métricas provienen de la misma instantánea y corte, usa RLS y ejecutor restringido. Migración aditiva 20261114001000 aplicada localmente; no nuevas tablas. Los filtros conservados no se escriben a URL/localStorage. Sin base suficiente se indica un solo cierre; no se fabrican tendencias.

Validación: 162 unitarias, 121 integración real (105 anteriores y 16 nuevas) y 49 E2E de producción aprobadas: 332 casos. TypeScript, ESLint y build correctos. Dos capturas inspeccionadas por finish-reviewer fresco, disposition ship, sin ajustes materiales; cinco anchos/teclado y fallos por pruebas funcionales. DESIGN.md preservado; gate genérico heredado de login sigue documentado sin aprobación ficticia. [Contrato](../development/REAL_REPORTING.md) y [registro](../../IMPLEMENTATION_PROGRESS.md).


## Entrega A-09: perfil y seguridad completos — paso 9

Solicitud explícita: Mi perfil debe ser una interfaz de perfil, sin reutilizar onboarding. /profile edita directamente nombre, moneda preferida PEN/USD y zona IANA; idioma español y correo verificado de Auth en consulta. Menús de Inicio apuntan a /profile y /security; /onboarding queda para configuración inicial y su enlace antiguo de edición redirige a /profile. Conflicto muestra valores guardados frente al borrador, sin sobrescribirlo. Confirmación perdida fija datos y permite reintento idempotente. Cambio de zona exige aviso/confirmación de reagrupación de días/meses; no cambia instantes o saldos. Auditoría atómica mínima de versión/zona/moneda, sin copiar nombres; no se inventan eventos anteriores a la migración.

Seguridad muestra correo confirmado, vencimiento del token actual y última autenticación por contraseña según claims verificados; permite actualizar estado. Cambio de contraseña exige confirmar la actual ante Auth y un comprobante aleatorio de un solo uso, hash SHA-256, usuario/sesión/finalidad vinculados y caducidad de cinco minutos. Cookie HttpOnly/SameSite Strict/Secure fuera de local; el secreto no se devuelve a JS. SQL comprueba AMR password reciente, no iat. Refresh oficial con AMR antiguo sigue rechazado. Autorización consumida atómicamente antes del cambio; nueva contraseña/confirmación, límites 12–128 y cierre global posterior. Contraseñas se borran de memoria de formularios después del intento y no se persisten en Finzi.

Cierres local/global disponibles; global con confirmación explícita, errores recuperables y alcance de revocación explicado: otros access tokens pueden conservar TTL residual. Estado incierto de cambio no se reenvía automáticamente; ofrece comprobar acceso/recuperación. Si contraseña cambió y falla cierre, informa del cambio y permite completar cierre global. /session permanece como acceso compatible de AUTH; la interfaz principal es /security.

Migración aditiva local 20261114001100, tablas privadas/FORCE RLS y ejecutor restringido. Sin dependencias/servicios, nuevos correos, costes o publicación. Comprobante protege API Finzi, no redefine permisos de Supabase Auth directo: su política/configuración debe validarse en entorno final; no se promete revocación instantánea ni protección comercial de contraseñas filtradas. N-01–N-06 y endurecimiento de paso11 siguen pendientes.

Validación: 178 unitarias, 134 integración real (121 previas y 13 nuevas), 56 E2E de producción aprobadas (368 casos). Últimos ajustes de estado, cuota, servicio de aplicación y formularios POST: siete E2E afectados repetidos y aprobados. TypeScript, ESLint y build correctos. Dos capturas inspeccionadas, disposition ship sin ajustes materiales; resto por DOM/teclado/pruebas. [Contrato y límites](../development/PROFILE_SECURITY.md) y [evidencia](../../IMPLEMENTATION_PROGRESS.md).


## A-10 — Exportación y eliminación

Autorización expresa del usuario. Implementación local en feat/data-export-and-deletion. [Contrato y límites](../development/DATA_PORTABILITY.md). Sin costes o servicios/dependencias nuevos. La aprobación de esta entrega no aprueba plazos legales o caducidad de respaldos: N-04/N-05 siguen bloqueando lanzamiento. Siguiente entrega11: endurecimiento/piloto y cierre de pendientes.197 unitarias y143 integración aprobadas, dos E2E nuevos aprobados; regresión: 56/58 pasaron en corrida completa; categoría pasó al repetir. El otro fallo fue colisión de artefactos por ejecución concurrente de Playwright; repetición aislada aprobada. Total: 197 unitarias +143 integración +58 escenarios E2E comprobados =398.


## A-11 — Deudas sobre movimientos reales

Solicitud y confirmación explícitas autorizan esta extensión antes diferida: gasto nuevo o existente y estados calculados, sin intereses/desembolsos automáticos. [Contrato](../development/DEBTS.md). Crear/eliminar compromiso no mueve dinero; eliminación lógica conserva historia exportable, desvincular conserva gasto y anularlo revierte saldo. Disponible solo de cuentas activas de la misma moneda, sin reservas ni conversiones. CRUD inline, vencimientos locales, filtros por estado/fecha/categoría/importe y resumen no alterado por filtros de lista. Límites iniciales revisables 200 deudas/2000 pagos incluida historia; no cambia monetización o gratuidad.

El paso11 de endurecimiento/piloto, pendientes N-01–N-06 y límites legales/respaldos A-10 siguen vigentes. Rama dedicada desde 8a720b7; sin integración a main, costes, publicación o paquetes nuevos. docs/context.md intacto.

Validación A-11:212 unitarias/160 integración aprobadas y64 escenarios E2E comprobados entre corrida y repeticiones; seis nuevos de Deudas y17 SQL repetidos en stack aislado por incompatibilidad ajena posterior en Supabase compartido. Build/TypeScript/ESLint correctos. Review inicial fix y verdict pass ship limitado al enlace accesible corregido; tres imágenes inspeccionadas contando verificación. [Detalle y límites](../../IMPLEMENTATION_PROGRESS.md).


## A-12 — Estadísticas con datos reales

Solicitud expresa y definición de ahorro confirmada: excedente positivo; balance firmado y tasa no calculable sin ingresos. Indicadores, gráficos ingreso/gasto, distribución, balance acumulado y ahorro por intervalo, con comparación/categorías, filtros globales automáticos, datos exactos y acceso al ledger. Solo posted income/expense; PEN/USD separados, aperturas/transferencias/anulaciones/reemplazados excluidos. Ahorro no equivale a reserva y menor gasto de categoría no demuestra ahorro causal. [Contrato](../development/STATISTICS.md).

Comparación consecutiva de igual duración local visible;3/6meses incluyen actual+2/5previos, personalizado hasta3660d, series hasta122puntos. Sin nuevas tablas/dependencias/servicios/costes; paso11 y pendientes N-01–N-06 no cambian. Migración aditiva20261115150000 aplicada sin revertir versión ajena del Supabase compartido. Rama dedicada, sin integración a main o publicación automática. docs/context.md intacto.

Validación:228 unitarias,22 integración reales nuevas y5 E2E nuevos aprobados;31 E2E de regresión aprobados. Build/TypeScript/ESLint correctos. Review inicial fix puntual de nota móvil, corregida fuera del scroll con verificación DOM; se registra dictamen final en [avance](../../IMPLEMENTATION_PROGRESS.md). Sin afirmar regresión completa de suites operacionales sobre entorno compartido incompatible.

Revisión cerrada: ship limitado al ajuste de notas, resuelto por DOM sin nuevas vistas de imagen; dos imágenes inspeccionadas en total. E2E afectado repetido y aprobado. [Evidencia](../../IMPLEMENTATION_PROGRESS.md).


Integración solicitada15/11/2026: Estadísticas y Categorías avanzadas (b25fb35) fusionadas en main. Categorías incorpora eliminación protegida, catálogo de iconos e imágenes privadas; migración20261115160000 conserva exportación conjunta de categorías/imágenes y deudas. No publicación ni costes nuevos.

## A-13 — Gastos Fijos (15/11/2026)
Extensión solicitada y ejecutada localmente: compromisos periódicos, vencimientos derivados, pagos nuevos/vinculados y resumen mensual por moneda. [Contrato y validación](../development/FIXED_EXPENSES.md). No completa ni autoriza despliegue; pendientes de lanzamiento conservados.

Rediseño Deudas15/11/2026: modales nativos de alta/edición/pago, resumen pendiente/disponible, filtros compactos y vistas tarjetas/lista con avance real. Seis E2E y revisión visual aprobados. [Contrato](../development/DEBTS.md). No cambia reglas financieras ni habilita cobros/crédito.

Rediseño Gastos Fijos15/11/2026: resumen mensual con avance real, agenda de próximos pagos, filtros automáticos compactos y vistas tarjetas/lista/calendario; símbolos originales de categorías y modales protegidos. Tres E2E, TypeScript y ESLint aprobados; revisión responsive de escritorio/móvil. [Contrato](../development/FIXED_EXPENSES.md). Se conserva la semántica financiera de A-13.

Rediseño Estadísticas15/11/2026: composición basada en la referencia aportada, cuatro indicadores, períodos compactos, gráficos barras/líneas con series seleccionables y detalle lateral de categoría. Comparativa adaptada a móvil; cálculos y datos exactos conservados. Cinco E2E aprobados y repetición del afectado tras ajustes visuales. [Contrato](../development/STATISTICS.md).
