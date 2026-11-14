# Finzi — avance por funcionalidades e interfaces

Registro incremental. Actualización: 14 de noviembre de 2026. Cada entrega sigue: alcance y aceptación → rama dedicada → implementación → pruebas/UX → commit revisable → integración autorizada. No activar costes ni modificar docs/context.md.

## Estado y orden

| Etapa | Entrega | Estado | Criterio para terminar |
| --- | --- | --- | --- |
| 1 | AUTH y rediseño | Integrada en main (345dea9) | Registro, correo, recuperación, sesión y cierres reales; diseño responsive probado |
| 2 | Onboarding del perfil financiero | Implementada en feat/financial-profile-onboarding | Nombre, PEN/USD, zona horaria e idioma español persistidos por usuario; revisar antes de guardar; reintentos y aislamiento probados |
| 3 | Inicio del dashboard | Implementada como base vacía | Entrada privada con perfil real y estado sin cuentas/datos, sin cifras inventadas o botones sin destino |
| 4 | Primera cuenta y listado de cuentas | Pendiente | Tipo personal, moneda, apertura exacta, RLS, edición/archivo; no integración bancaria |
| 5 | Categorías | Pendiente | Ingreso/gasto y jerarquía propia, archivo y aislamiento |
| 6 | Ingreso y gasto | Pendiente | Dinero exacto, fecha/zona, publicación atómica e idempotencia |
| 7 | Transferencias y correcciones | Pendiente | Una moneda, partidas firmadas, reemplazos y rollback/concurrencia |
| 8 | Historial y dashboard financiero | Pendiente de datos/reglas reales | Filtros, períodos y métricas reconciliadas por moneda; vacío distinto de error |
| 9 | Perfil y seguridad completos | Parcial | Editar preferencias propias y cierres; administración avanzada de dispositivos diferida |
| 10 | Exportación y eliminación | Pendiente | JSON/CSV, reautenticación, retención y proceso de borrado acordados |
| 11 | Endurecimiento y publicación | Pendiente | SMTP/HTTPS, privacidad/edad, backups/restore, cuotas gratuitas; sin SLA inventado |

Los pendientes definen secuencia, no implementación automática de todo el producto. Presupuestos, metas, crédito, FX e IA permanecen fuera del MVP. La creación de la primera cuenta será una entrega posterior: el onboarding actual no solicita saldo, ingresos, documentos o datos bancarios.

## Entrega actual: perfil y bienvenida

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
