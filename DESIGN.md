# Finzi — sistema de interfaz

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

## Onboarding y dashboard inicial — A-02

Se conserva la tipografía local y el azul aprobado. Para una tarea secuencial se cambia el panel decorativo por un rail azul claro de 340 px con tres pasos reales: nombre, preferencias y revisión. Contenido de hasta 540 px, selección de moneda como radios nativos con área completa y resumen en lista descriptiva. Móvil usa cabecera compacta y progreso textual de tres segmentos; hasta 360 px las acciones se apilan para evitar texto comprimido. Foco en el título al cambiar de paso y error de nombre corregido al introducir un valor válido.

El dashboard es una bienvenida privada con nombre, preferencias guardadas y ausencia explícita de cuentas/movimientos. No representa indicadores, ceros provisionales o acciones a pantallas inexistentes. Los únicos enlaces operativos son edición del perfil y gestión de sesión.

Capturas de producción en .impeccable/review/onboarding-*.png y dashboard-empty-*.png; pruebas de escritorio, tablet y móvil desde 320 px. La numeración aquí representa el proceso real; no es decoración.

## Inicio del dashboard — A-03

Referencias dashboard/interface-1 a interface-5. Se toma estructura de sidebar y lectura de datos de 3/4, y claridad de 1, conservando la marca azul; no se copian bancos, tarjetas, retratos, premium o funciones IA de las imágenes. Plan de composición previo a código en IMPLEMENTATION_PROGRESS.md. Paleta #F4F7FC / #FFFFFF / #152343, con #1D4ED8 como superficie principal del saldo, #16765A ingresos y #B5473D gastos. Manrope local y escala de radios 9/10/16 px según control o panel.

Sidebar de 222 px, barra superior con búsqueda real y perfil, saludo y aviso de muestra; saldo/ingresos/gastos en tres columnas; evolución y categorías; recientes y cuentas. Hasta 1000 px la navegación pasa a dialog nativo; debajo de 768 px se apilan los paneles y a 360 px los importes ganan toda la fila. Tipos secundarios 12–14 px, títulos de panel 15 px, saldo 24–38 px. El monograma Finzi continúa como logo y el avatar usa iniciales propias, sin fotografías externas.

Los gráficos se derivan de cuentas/movimientos del escenario. Barras de ingresos/gastos por mes con botones accesibles por teclado; donut acompañado de leyenda textual y porcentajes ajustados para sumar 100. Las geometrías usan proporciones; los importes se calculan con bigint y no pasan por float. El saldo actual no cambia al filtrar el mes; se explica su corte y diferencia de ingresos/gastos.

Modo de prueba opt-in mediante botón, URL o casilla final del onboarding. Banner explícito, salida y reinicio al recargar. Todos los enlaces/controles actuales funcionan: navegación entre vistas, búsqueda, filtros, datos ocultos, CSV, edición de apertura, movimiento simulado, perfil y seguridad. Dialogs nativos para formularios/navegación, Escape, foco visible y bloqueo del scroll del fondo. No hay efectos de entrada ni animaciones de gráficos.

La vista sin muestra conserva estado vacío y no presenta importes de ejemplo como finanzas del usuario. Capturas locales home-final-{1440,1024,768,390,320}.png y home-preview.png; no se incluyen en Git ni se envían al sitio las referencias JPEG.


## Cuentas y aperturas reales — A-04

Se conserva el marco de Inicio. Toolbar con estado de guardado, actualizar y añadir cuenta; totales PEN/USD independientes (la moneda preferida encabeza la composición); listado de cuentas con nombre, tipo, saldo, apertura y archivo. La superficie azul sigue reservada al saldo principal. Archivadas permanecen en los totales; el filtro solo afecta el listado y su texto lo explica.

El estado vacío ofrece crear la primera cuenta. Dialog nativo con nombre, tipo, moneda, saldo y explicación del timestamp del servidor. Al editar se mantienen moneda/tipo visibles e inmutables. Labels de 16 px en inputs, errores anunciados y primer campo inválido enfocado. Se conservan campos ante fallo; un conflicto exige recargar de forma explícita. Al guardar, el foco pasa al título de la cuenta canónica. Durante la petición se bloquea el cierre accidental con timeout de 15 s.

Grid de cuentas de tres, dos y una columna; acciones se apilan en móvil. Capturas real-accounts-{1440,768,390,320}.png en la evidencia local ignorada. La muestra conserva su aviso y nunca sustituye cuentas reales. No se muestran ingresos/gastos como ceros provisionales: una nota explica que todavía no existen movimientos reales.
