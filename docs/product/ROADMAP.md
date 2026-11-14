# Roadmap de Finzi

Actualizado: 14 de noviembre de 2026. Desarrollo individual, presupuesto cero. D-01–D-10 aprobadas. Las autorizaciones A-01–A-05 permiten las entregas indicadas; no autorizan costes, publicación ni implementación automática de todo el producto.

## Avance por interfaces y funcionalidades

| Paso | Entrega | Estado | Resultado y puerta de salida |
| --- | --- | --- | --- |
| 1 | AUTH y rediseño | Completado; integrado en main, 345dea9 | Registro, correo, acceso, recuperación y cierres local/global |
| 2 | Onboarding financiero | Completado, f86fea4 | Nombre, PEN/USD y zona horaria persistidos; revisión y edición con control de versión |
| 3 | Inicio del dashboard | Completado, 5c8b74f | Muestra explícita e interactiva en memoria, separada de los datos reales |
| 4 | Cuentas y saldos iniciales | Implementado — A-04, feat/accounts-and-opening-balances | Alta, listado, edición, archivo/restauración, aperturas exactas y totales por moneda; RPC, RLS, reintentos y concurrencia probados localmente |
| 5 | Categorías propias | Implementado — A-05, feat/personal-categories | Ingreso/gasto, dos niveles, personalización, plantillas propias opcionales, búsqueda y archivo efectivo; RLS, concurrencia y reintentos probados |
| 6 | Ingresos y gastos reales | Pendiente | Partidas firmadas, fechas/zona, atomicidad, idempotencia y auditoría; bloquear edición de aperturas con historia antes de habilitar escrituras |
| 7 | Transferencias y correcciones | Pendiente | Misma moneda, partidas atómicas, reemplazos trazables; transferencias nunca son ingreso/gasto |
| 8 | Historial e Inicio sobre movimientos reales | Parcial | Aperturas reales disponibles; métricas/períodos y filtros se reconciliarán con el ledger de los pasos 6–7 |
| 9 | Perfil y seguridad completos | Parcial | Preferencias y cierres disponibles; reautenticación y estados pendientes; dispositivos avanzados diferidos |
| 10 | Exportación y eliminación | Pendiente | JSON/CSV reales, confirmación, reautenticación, retención y borrado acordados; el CSV actual pertenece solo a la muestra |
| 11 | Endurecimiento y piloto | Pendiente | HTTPS, correo, requisitos legales/edad, aislamiento en entorno final, cuotas, respaldo y restauración; sin SLA de planes gratuitos |

El avance por etapa requiere una entrega revisable en rama dedicada, pruebas proporcionales y actualización de este archivo. main permanece estable; no se fusiona ni se publica automáticamente por completar una interfaz. [Registro detallado](../../IMPLEMENTATION_PROGRESS.md).

## Entrega actual: cuentas — A-04

Continuación solicitada por el usuario después de Inicio. Permite registrar efectivo, cuenta bancaria, ahorros u otra cuenta personal, con nombre, moneda y saldo de apertura. Moneda, tipo y fecha de apertura son inmutables. La fecha la asigna el servidor al guardar y se muestra en la zona del perfil; no se admiten aperturas retroactivas o futuras desde la interfaz actual.

Las aperturas admiten cero e importes negativos y usan dinero exacto, hasta 16 dígitos enteros y 2 decimales. No son ingresos. PEN/USD nunca se suman entre sí. Archivar oculta la cuenta del listado activo, conserva sus datos y mantiene su importe en el total, como indica la interfaz. Se puede restaurar.

Límite técnico inicial: 100 cuentas por usuario, incluidas las archivadas; el servidor lo comprueba de forma serializada. Es una decisión de implementación revisable, no una capacidad contratada. No se guardan números bancarios, credenciales bancarias o datos de muestra en las cuentas reales. No se añaden dependencias, servicios cloud o variables de entorno.

Ver [contrato y validación de cuentas](../development/ACCOUNTS.md). La apertura puede corregirse ahora porque no existe ledger real. **Antes de habilitar cualquier movimiento, una migración deberá bloquear cambios de apertura cuando exista cualquier historia y coordinar los bloqueos de cuenta dentro de las operaciones financieras.** Ese control no puede quedar solo en UI.

## Puertas de las próximas entregas

1. Siguiente entrega: ingresos y gastos reales. Concretar fecha/zona, publicación, selección de cuentas/categorías activas, partidas y correcciones antes de migrar. No anticipar transferencias o ampliar el MVP.
2. Ledger: precisión, aislamiento A/B con roles efectivos, atomicidad, concurrencia y reintentos reales. Saldos reconstruibles y correcciones por reemplazo. Coordinar bloqueos de cuenta, categoría/ancestro y perfil con los comandos existentes; impedir aperturas editables con cualquier historia.
3. MVP: métricas reconciliadas, exportación/eliminación, accesibilidad y recuperación comprobadas antes del piloto.
4. Lanzamiento: resolver los pendientes N-01–N-06 del [registro de decisiones](../architecture/DECISIONS.md), sin comprometer costes o disponibilidad no garantizada.

## Fuera del MVP

Presupuestos y metas, recurrencias/archivos/reglas/avisos, crédito, FX, bancos, móvil e IA requieren especificación y autorización posteriores. Figurar aquí no autoriza su desarrollo. Finzi seguirá gratuita, sin publicidad, premium, suscripciones ni monetización. Si un recurso gratuito resulta insuficiente, se limita capacidad o se presenta otra opción gratuita; no se activa pago automáticamente.


## Entrega A-05: categorías propias y simulación

Categorías de ingreso/gasto persistidas por usuario, con un nivel de subcategorías. Se puede personalizar nombre, descripción, color e icono, buscar y archivar/restaurar. Se ofrecen 6 categorías iniciales de gasto y 4 de ingreso como copia propia opcional; los reintentos no duplican ni reemplazan personalizaciones.

Concreciones técnicas revisables: 200 categorías por usuario incluyendo archivadas; nombre único entre hermanas del mismo tipo, insensible a mayúsculas y conservando acentos; tipo/padre inmutables desde creación. El archivo del padre vuelve inactivas las hijas sin cambiar su estado individual; restaurar el padre no restaura una hija archivada por separado. No hay eliminación destructiva ni movimientos reales en esta entrega.

Se retiraron home-footer y real-sample-link y la opción de muestra del onboarding. Abrir simulación vive únicamente en el sidebar y su menú móvil. El aviso y la salida de la muestra se conservan para identificar los datos sintéticos. Categorías siempre trabaja con datos propios reales. Ver [contrato](../development/CATEGORIES.md) y [registro](../../IMPLEMENTATION_PROGRESS.md). Sin nuevas dependencias o costes.
