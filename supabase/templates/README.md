# Correos de autenticación de Finzi

Tres documentos HTML independientes para Supabase Auth. No requieren proveedor de fuentes, imágenes remotas, JavaScript, React Email ni dependencias adicionales. Tablas e inline CSS para email; variantes móvil y dark como mejora progresiva. Deben revisarse en clientes reales antes de activar envíos públicos.

| Tipo en Supabase | Asunto | Archivo |
| --- | --- | --- |
| Confirm sign up | Confirma tu cuenta en Finzi | confirmation.html |
| Reset password | Recupera tu acceso a Finzi | recovery.html |
| Change email address | Confirma el cambio de correo en Finzi | email-change.html |

Copiar el HTML completo, no una versión ya renderizada con tokens de pruebas. Las variables `{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .ConfirmationURL }}` y `{{ .NewEmail }}` las sustituye Supabase, no Vercel ni el proveedor SMTP. No incluir claves SMTP en las plantillas.

Confirmación y recuperación conservan `/auth/confirm#token_hash=…&type=signup|recovery`: fragmento retirado por la web y consumo mediante POST tras acción explícita. Configurar Site URL como origen exacto, sin barra final; Redirect URLs solo al callback exacto del mismo entorno. Desactivar click/open tracking del proveedor para evitar reescritura del enlace o píxeles.

Cambio de correo usa la URL nativa `{{ .ConfirmationURL }}` para respetar ambas confirmaciones de Supabase. **No** enviarlo al callback de Finzi con `type=email_change`: la aplicación actualmente solo admite signup/recovery y no expone un editor de correo. Esta entrega valida la plantilla y el protocolo del proveedor, no añade esa funcionalidad web. El enlace nativo verifica al abrirse y tiene el riesgo habitual de consumo por escáneres; no se afirma la protección del fragmento para esta plantilla. Revisar esa experiencia antes de exponer cambio de correo en la aplicación. Mantener Secure email change activado.

Local: `supabase/config.toml` referencia los tres archivos; SMTP fake integrado en `http://127.0.0.1:17324`. Si Auth ya estaba encendido, reiniciar el stack local conservando los datos para recargar las plantillas; no ejecutar db reset.

```sh
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/auth-email-templates.test.ts --bail=1
```

Ese control usa solo usuarios @example.test y endpoints loopback; comprueba renderizado real, sesión sin confirmar, un solo uso, caducidad y doble confirmación. No envía correos reales ni crea movimientos.

Inventario SMTP sin credenciales: infrastructure/supabase/smtp.plan.json. El usuario confirmó que aplicó Gmail SMTP y pegó estas tres plantillas en staging. Ese estado es una declaración del usuario, con entrega real todavía pendiente de validar; el inventario no aplica cambios automáticamente. El informe actualizado y el plan de pruebas están en los documentos privados docs/deployment/28-SMTP-AUTHENTICATION-PREPARATION.md y29-PHASE7-INTEGRAL-TEST-PLAN.md. Gate paused, sin publicaciones.
