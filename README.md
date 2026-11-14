# Finzi · AUTH

Autenticación real en español con Next.js y Supabase. Esta entrega implementa exclusivamente identidad: registro, confirmación por correo, acceso, recuperación, sesión protegida y cierre local/global. No incluye módulos financieros ni servicios de pago.

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
