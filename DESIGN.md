---
name: Finzi AUTH
description: Identidad personal operativa en español y azul claro.
colors:
  background: "#f8fafc"
  surface: "#ffffff"
  ink: "#0f172a"
  muted: "#475569"
  action: "#1d4ed8"
  action-hover: "#1e40af"
  line: "#cbd5e1"
  control: "#64748b"
  error: "#b91c1c"
  success: "#166534"
  blue-surface: "#eff6ff"
typography:
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 550
  action:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 550
rounded:
  utility: "6px"
  control: "8px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
  panel: "64px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    width: "100%"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "48px"
    width: "100%"
  text-link:
    textColor: "{colors.action}"
  feedback:
    rounded: "{rounded.control}"
    padding: "14px 16px"
---

# Design System: Finzi AUTH

## Overview

**Creative North Star: "Identidad azul clara aprobada"**

Este descriptor resume el contrato existente de [AUTH](.impeccable/surfaces/auth.md), sin introducir una nueva marca o aprobación creativa. Modo **Operate**: reconocer acceso, registro o recuperación, completar el formulario y obtener una respuesta recuperable. Superficies claras, tipografía de sistema y una acción principal sostienen la tarea.

La autoridad de identidad sigue siendo [docs/design/DESIGN_SYSTEM.md](docs/design/DESIGN_SYSTEM.md), D-08. Este registro extrae el sistema de `src/app/globals.css` y `src/modules/identity/presentation`; no aprueba individualmente los tokens ni certifica accesibilidad. El documento fuente conserva propuestas más amplias que todavía no existen en AUTH.

**Key Characteristics:**

- Azul para acción, enlaces y foco; texto oscuro sobre fondos claros.
- Campos con labels persistentes, ayuda y errores asociados.
- Una gramática compartida de controles, feedback y estados.
- Dos columnas en escritorio y una tarea concentrada en móvil.

## Colors

La paleta combina azul de acción, una superficie contextual muy clara y neutros fríos. Los valores extraídos están en el frontmatter; el CSS sigue siendo la fuente de la implementación.

### Primary

- **Azul de acción — action:** botones principales, enlaces, caret, foco e indicadores de estado no erróneo.
- **Azul de respuesta — action-hover:** respuesta al pasar el puntero sobre acciones y enlaces.
- **Azul de contexto — blue-surface:** panel introductorio y hover del control de contraseña.

### Neutral

- **Fondo claro — background:** lienzo de página y hover del botón secundario.
- **Superficie blanca — surface:** controles y panel de escritorio.
- **Tinta — ink:** títulos, labels y contenido principal.
- **Texto secundario — muted:** ayuda, pie, metadatos e icono de contraseña.
- **Línea suave — line:** divisores de identidad, sin sustituir los bordes de campos.
- **Borde de control — control:** campos y botón secundario.

### Named Rules

**The Estado con texto Rule.** Error y éxito combinan color con mensaje e icono; los campos inválidos también exponen su estado semántico. Los tokens error y success se aplican aquí a feedback, no a cifras financieras.

Los colores locales de feedback, foco de campo, selección, disabled y texto introductorio se conservan en el CSS. No constituyen una escala de categorías o un tema oscuro. Las rampas del sidecar son interpolaciones de previsualización, no tokens aprobados ni colores añadidos a la aplicación.

## Typography

**Body Font:** pila del sistema del frontmatter, sin proveedor remoto. Los títulos de tarea y labels comparten familia. No hay un rol display de marketing ni una fuente monoespaciada implementados.

### Hierarchy

- **Headline:** título según el frontmatter; en móvil baja a (30px). La descripción usa cuerpo (16px), interlineado (1.6) y ancho máximo (46ch).
- **Body:** lectura normal según el frontmatter. Ayuda y feedback usan (14px); la ayuda tiene interlineado (1.55).
- **Label:** etiqueta persistente según el frontmatter. La acción usa su rol de (15px).
- **Introducción contextual:** texto (17px), interlineado (1.7). Su título usa (40px), peso (550), interlineado (1.16), tracking (-0.035em) y máximo (14ch); baja a (36px) hasta (1100px).
- **Wordmark:** texto propio «finzi.» de (32px), peso (750), interlineado (1) y tracking (-0.04em); el punto lleva azul de acción.
- **Pie:** metadatos (13px). No reducir labels para acomodar contenido.

## Layout

El contenedor de escritorio usa `min(100% - 96px, 1248px)`, encabezado mínimo (112px) y pie mínimo (88px). El panel es una cuadrícula de dos columnas iguales con altura mínima (648px). Introducción y tarea reciben espacio interior (64px 48px); la tarea termina con (40px) abajo y tiene ancho máximo (536px), con contenido útil de hasta (440px). El formulario separa grupos (24px) y label/control (8px).

Hasta (1100px), el contenedor deja (32px) por lado y ambas zonas usan (48px 32px); el enlace de recuperación pasa debajo del label. Hasta (767px), la página usa margen interno (24px), oculta la introducción y presenta una tarea de hasta (440px) sin panel exterior. Encabezado y pie bajan a mínimos de (104px) y (72px). Hasta (360px), el margen interno baja a (20px), la tarea empieza con (32px) arriba y recuperación vuelve a la línea siguiente. Desde (1500px), la altura mínima se acota con `min(100svh, 1100px)`.

Identidad y feedback permiten romper líneas largas. La acción principal ocupa el ancho del formulario; los controles tienen altura mínima (48px), y enlaces y control de contraseña objetivos mínimos (44px). La escala del frontmatter describe el ritmo reutilizado, sin prohibir medidas puntuales de alineación.

## Elevation & Depth

AUTH no implementa sombras. La profundidad procede del fondo de página, el panel blanco y la introducción azul clara. El borde exterior es (1px solid #e2e8f0); los controles tienen borde propio. Esto no establece reglas para capas flotantes aún inexistentes.

**The Foco separado Rule.** El foco general usa contorno (2px) en azul de acción con separación (4px). El campo enfocado usa borde de acción y contorno (2px solid #bfdbfe) con separación (1px). Conservar estos indicadores al extender la superficie.

## Shapes

Controles y mensajes comparten el radio control del frontmatter. El panel usa panel; mostrar contraseña y saltar al contenido usan utility. Bordes finos y rectángulos suaves definen AUTH. No hay escala implementada de pills, tarjetas financieras ni diálogos.

## Components

### Buttons

Acciones directas de ancho completo. Principal usa action con texto surface; secundario usa surface con texto ink y borde control (1px). Espacio interior (12px 20px), separación texto/icono (10px) y altura mínima (48px). Hover cambia fondo y desplaza arriba (1px); active desplaza abajo (1px), con transición (150ms ease). Principal disabled usa fondo (#526da7), texto blanco y cursor de espera. Secundario disabled mantiene sus colores y el atributo disabled.

El envío cambia el texto a una acción en curso, bloquea reenvíos y marca el formulario con `aria-busy`. Se eliminan transiciones y animaciones bajo `prefers-reduced-motion: reduce`.

### Inputs / Fields

Campos blancos con borde control (1px), alto (48px) y espacio interior (10px 14px). Hover oscurece el borde; foco sigue su regla; `aria-invalid` usa borde error. Disabled usa fondo (#f1f5f9) y texto muted.

Labels visibles; ayuda y error enlazados por `aria-describedby`. La validación enfoca el primer inválido. Mostrar/ocultar contraseña usa (44px × 44px), nombre accesible y `aria-pressed`; el input reserva (56px) a su derecha. El fallo de conexión conserva los campos. Se permite autocompletar mediante los valores específicos de `autocomplete`.

### Navigation

Wordmark a la izquierda y navegación de acceso a la derecha. Enlaces azules de peso (550), objetivo mínimo (44px) y subrayado que aparece en hover; foco visible. En móvil se oculta solo la pregunta introductoria del encabezado. «Saltar al contenido» aparece al recibir foco.

### Feedback

Mensajes con icono SVG, texto, espacio interior (14px 16px) y separación (10px). Error combina fondo (#fef2f2) con error; éxito combina (#f0fdf4) con success. La región `aria-live="polite"` anuncia el resultado; los formularios usan también `aria-atomic`. Sin mensaje, no queda banda vacía.

### Identidad y confirmación de enlace

La sesión presenta correo y estado en una lista descriptiva con divisores, y dos acciones reales de cierre local/global. No contiene métricas financieras. El enlace de correo se confirma mediante un botón explícito. Cuando es inválido, título, icono y siguiente acción reflejan ese estado, con acceso a solicitar otro enlace; la recuperación rechazada conserva su ruta de recuperación.

## Do's and Don'ts

### Do:

- **Do** conservar español, labels persistentes y una acción principal reconocible.
- **Do** mantener foco visible, teclado y movimiento reducido.
- **Do** acompañar estados con texto y ofrecer un siguiente paso real.
- **Do** reutilizar tokens implementados y comprobar cada nuevo estado en contexto.

### Don't:

- **Don't** inventar saldos, usuarios, testimonios o confirmaciones de operaciones.
- **Don't** sustituir la tarea por contenido promocional dentro de esta entrega AUTH.
- **Don't** convertir medidas de esta superficie en aprobación de componentes futuros.
- **Don't** afirmar certificación WCAG, validación cloud o aprobación de gates desde este registro.

Límites respecto a marketing/tasteskill: este encargo es **Operate**, restringido a AUTH y sin dashboard. No requiere export estático, hero promocional, fotografías, shaders, secciones adicionales ni momentos de scroll; el backend forma parte de su comportamiento. Esta delimitación no fija una preferencia para futuras landing pages. No se envía fotografía ni raster de producto.

No canonizado ni reparado aquí: el diseño documental previo propone inputs (6px), separación de foco (2px) y una escala tipográfica distinta; el CSS observado usa los valores extraídos arriba. La divergencia se informa y no reescribe la autoridad existente. El gate tasteskill produjo **FAIL (20), ronda 2/3**, por criterios de marketing y contenedor; no se declara PASS. La revisión independiente terminó en disposición **ship** para el alcance inspeccionado tras resolver el enlace inválido, y el detector Impeccable devolvió `[]`; esto no certifica estados no inspeccionados ni elimina el resultado del gate.
