# Finzi — interfaz AUTH

Revisión: 14 de noviembre de 2026. Rediseño solicitado por el usuario con la skill frontend-design, referencias docs/references/login/login-1.jpg y login-2.jpg y el logo existente de la pestaña. Implementación en rama dedicada `feat/auth-ui-redesign`.

## Dirección

Una entrada personal a Finzi con una marca reconocible antes del formulario. El gesto principal es la propia «f»: el icono exacto en el encabezado y su silueta ampliada en un panel azul. El formulario permanece sobrio, alineado a la izquierda, con una sola acción primaria y estados reales.

Se compararon dos composiciones:

```text
A. Panel a sangre        B. Panel contenido (elegida)
[marca azul | formulario] [ margen [marca azul | formulario] margen ]
                         [       esquinas y respiro común        ]
```

La segunda recoge el encuadre de las referencias y evita repetir el split plano anterior. Se descartaron mockups financieros, cifras, testimonios, botones sociales, pasos de onboarding y adornos independientes de la marca. Las referencias aportan composición y tratamiento de luz; no se copian sus textos, activos o marcas.

## Tokens implementados

| Rol | Valor |
| --- | --- |
| Acción y logo | #1D4ED8 |
| Panel profundo | #102A83 |
| Luz de marca | #B9DBFF (familia celeste; variaciones locales en el SVG) |
| Fondo | #F3F6FC |
| Superficie | #FFFFFF |
| Tinta | #152343 |
| Texto secundario | #53617A |
| Borde de control | #8490A7 |
| Error / éxito | #B91C1C / #166534 |

Fuente CSS: src/app/globals.css. El panel combina azul profundo con luz azul radial; no define un tema oscuro ni una paleta financiera.

## Tipografía y activos

Manrope variable, pesos 200–800, alojada localmente con next/font/local, sin llamadas del navegador a proveedores externos. Fuente: Google Fonts, https://github.com/google/fonts/tree/main/ofl/manrope. Archivo original src/app/fonts/Manrope-Variable.ttf; licencia SIL OFL 1.1 incluida en src/app/fonts/OFL.txt. No se modifica ni se comercializa la fuente.

Títulos de tarea 30 px/1.22, peso 700, tracking -0.045em; texto explicativo 14 px/1.7; labels 13 px, peso 700; inputs 16 px para lectura y evitar zoom automático en móvil. Titular contextual 36–54 px, peso 500. No mayúsculas decorativas ni palabras del titular coloreadas de forma aislada.

FinziMark reproduce el rectángulo azul y path blanco de src/app/icon.svg, sin cambiar el favicon. La ilustración usa ese mismo path, luz celeste y sombra azul; es SVG/CSS propio. Las referencias JPEG no se envían al navegador.

## Composición

Escritorio: lienzo claro, margen 24 px y superficie blanca de radio 28 px. Panel azul interno de radio 20 px; marca arriba, monograma central, texto contextual abajo. Formulario con contenido de hasta 400 px y espacio interior 40 px. Navegación superior y pie discretos dentro de la zona de tarea.

Tablet desde 768 px: margen 16 px, columnas 0.9/1 y espacio interior reducido. Móvil hasta 767 px: fondo blanco, logo y navegación arriba, tarea en una columna, sin panel que desplace el formulario. A 320 px, el enlace de recuperación pasa a su propia línea. El contenido crece en vertical cuando hace falta; nunca se fija la altura del formulario.

## Interacción y accesibilidad

Controles de 52 px, icono de contraseña de 44 px y enlaces con objetivo mínimo de 44 px. Foco de 3 px general y 2 px en campos, ambos con separación y azul de marca. No se eliminan labels, autocomplete, pegado, gestores de contraseña ni validación cliente/servidor. Errores con texto e icono, aria-describedby y foco al primer inválido; mensajes anunciados con aria-live. La carga añade spinner junto al texto; no mueve la composición. Reduced-motion desactiva su animación.

No se cambian endpoints, cookies, CSP, RLS, migraciones ni flujos de identidad. La página privada sigue mostrando identidad real y cierres de sesión, sin módulos financieros.

## Evidencia

Capturas locales en .impeccable/review/redesign-*.png, revisadas en escritorio, tablet y móvil. La evidencia anterior de tasteskill/Impeccable corresponde a la versión previa; no certifica este rediseño. Esta revisión utiliza frontend-design y las comprobaciones funcionales del proyecto.
