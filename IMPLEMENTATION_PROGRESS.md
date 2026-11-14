# Finzi — avance por funcionalidades e interfaces

Registro incremental. Actualización: 14 de noviembre de 2026. Cada entrega sigue: alcance y aceptación → rama dedicada → implementación → pruebas/UX → commit revisable → integración autorizada. No activar costes ni modificar docs/context.md.

## Estado y orden

| Etapa | Entrega | Estado | Criterio para terminar |
| --- | --- | --- | --- |
| 1 | AUTH y rediseño | Integrada en main (345dea9) | Registro, correo, recuperación, sesión y cierres reales; diseño responsive probado |
| 2 | Onboarding del perfil financiero | Implementada en feat/financial-profile-onboarding | Nombre, PEN/USD, zona horaria e idioma español persistidos por usuario; revisar antes de guardar; reintentos y aislamiento probados |
| 3 | Inicio del dashboard | Interfaz y muestra opt-in implementadas (A-03) | Entrada privada, modo de prueba identificado, cálculos exactos, filtros y formularios simulados; sin datos ficticios en cuentas reales |
| 4 | Primera cuenta y listado de cuentas | Pendiente | Tipo personal, moneda, apertura exacta, RLS, edición/archivo; no integración bancaria |
| 5 | Categorías | Pendiente | Ingreso/gasto y jerarquía propia, archivo y aislamiento |
| 6 | Ingreso y gasto | Pendiente | Dinero exacto, fecha/zona, publicación atómica e idempotencia |
| 7 | Transferencias y correcciones | Pendiente | Una moneda, partidas firmadas, reemplazos y rollback/concurrencia |
| 8 | Historial y dashboard financiero | Pendiente de datos/reglas reales | Filtros, períodos y métricas reconciliadas por moneda; vacío distinto de error |
| 9 | Perfil y seguridad completos | Parcial | Editar preferencias propias y cierres; administración avanzada de dispositivos diferida |
| 10 | Exportación y eliminación | Pendiente | JSON/CSV, reautenticación, retención y proceso de borrado acordados |
| 11 | Endurecimiento y publicación | Pendiente | SMTP/HTTPS, privacidad/edad, backups/restore, cuotas gratuitas; sin SLA inventado |

Los pendientes definen secuencia, no implementación automática de todo el producto. Presupuestos, metas, crédito, FX e IA permanecen fuera del MVP. La creación de la primera cuenta será una entrega posterior: el onboarding actual no solicita saldo, ingresos, documentos o datos bancarios.

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

Los cambios de docs/ siguen ignorados por la configuración del usuario. Este archivo en raíz registra la secuencia dentro de Git.

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
