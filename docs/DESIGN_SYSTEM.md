# Design system de alloxentric

Estilo SaaS / startup / IA: limpio, mucho aire, un solo color de marca. Aplicado al front en la semana 10.

## Marca
- **Logo:** wordmark `alloxentric.` en minúsculas, peso medio, con la **x** y el **punto** en cherry (`Logo.tsx` → `Wordmark`).
- **Icono:** la **x** en cherry, dos trazos redondeados (`public/favicon.svg`, `LogoIsotype`). Va en el favicon, marcas de agua y detalles.

## Colores
| Token | Hex | Uso |
|---|---|---|
| Cherry | `#D20A2E` | Botones primarios, logo, enlaces activos, foco |
| Cherry oscuro | `#B00825` / `#8F0720` | Hover, texto sobre tinte cherry |
| Cherry medio | `#E8405F` | Iconos de IA / agente, acentos secundarios |
| Cherry tinte | `#FCEDEF` · `#FCE3E7` · `#F9D9DE` · `#F6BFC9` | Fondos suaves, chips, bordes de acento |
| Blanco roto | `#F2F0EF` | Fondo de la app |
| Blanco | `#FFFFFF` | Tarjetas y modales |
| Tinta | `#1F1B1A` | Texto principal |
| Gris cálido | `#6B6562` · `#9A938F` | Texto secundario / terciario |
| Bordes | `#E4DFDC` · `#D6D1CE` · `#ECE8E5` | Líneas, divisores, fondos de apoyo |
| Tinta suave | `#3A3532` | Estado "escalado" (antes violeta) |

Semánticos que se mantienen: verde `#22C55E` (éxito/en línea), ámbar `#F59E0B` (pendiente) y rojo `#EF4444` (error/urgente). El rojo de error es más claro y frío que el cherry para no confundirse con la marca.

El color de cada empresa (`brandColor`/`brandBg`) sigue siendo por tenant (widget y chat público); el valor por defecto para empresas nuevas es cherry.

## Tipografía
- **Inter** (400–700) para la interfaz; **JetBrains Mono** para números de ticket y código.
- Títulos con peso 600 y tracking ajustado; el wordmark usa `tracking-[-0.04em]`.

## Forma y componentes
- Tarjetas y modales: blancos, `rounded-xl`/`2xl`, borde `#E4DFDC`, sombra casi nula.
- Botón primario: fondo cherry, texto blanco, `rounded-lg`, hover cherry oscuro. Secundarios: borde gris cálido.
- Foco e inputs: anillo cherry. Selección de texto: tinte cherry.

## Dónde vive
`frontend/src/components/Logo.tsx`, `frontend/index.html` (fuente, favicon, color base) y los colores como clases de Tailwind con hex (`bg-[#D20A2E]`) en los componentes. Para cambiar un color de marca hay que reemplazarlo en todo `frontend/src` y en `public/widget.min.js`.

## Movimiento y personalidad (semana 10)
- **Tokens** en `src/index.css` (`@theme`): escala `cherry-50…700`, `canvas`, `ink` y animaciones (`animate-fade-up`, `animate-pop`, `animate-float`, `animate-spin-slow`).
- **Lienzo:** blanco roto con un resplandor cherry y una trama de puntos; barra superior con acento cherry de 3 px.
- **Navegación:** el indicador activo de la barra lateral se desliza entre vistas (`motion`, `layoutId`); las vistas entran con `fade-up`.
- **Tarjetas:** `lift` (se elevan al pasar el cursor) y entrada escalonada en la lista de tickets; las métricas cuentan hasta su valor y la primera es una tarjeta cherry.
- **Botones primarios cherry:** relieve, elevación al pasar el cursor y "press" al hacer clic (reglas globales en `index.css`).
- **Modales y avisos:** entran con fundido y `pop`. Se respeta `prefers-reduced-motion`.
- **Iconos:** `lucide-react`. **Animación:** `motion` (`motion/react`).

## Modo oscuro
- Botón sol/luna junto al perfil (y en el login); la elección se guarda en `localStorage` (`alloxentric-theme`). Sin elección se usa el tema del sistema; el chat público (`/chat/...`) arranca siempre en claro.
- Los componentes usan variables CSS (`text-[color:var(--c-ink)]`, `border-[color:var(--c-line)]`, tintes cherry `--c-ch*`, semánticos `--c-r*/--c-a*/--c-g*`) definidas en `index.css` para `:root` y `.dark`. Para cambiar un color de tema se edita ahí, en un solo lugar.
- `bg-white` y el cherry como texto tienen overrides en `.dark` dentro de `index.css`. El cherry de marca (`#D20A2E`) es el mismo en ambos temas.
- Los chips de cada empresa se tiñen con `color-mix` sobre su color de marca, para que funcionen en claro y oscuro.

## Menús desplegables
- `components/Select.tsx` reemplaza al `<select>` nativo en toda la app: botón con anillo cherry al abrir, chevron que gira, menú animado (resorte + aparición escalonada de opciones), opción activa en tinte cherry y marca de selección. Admite icono o logo y una línea de ayuda por opción.
- Teclado completo (flechas, Inicio/Fin, Enter, Esc) y atributos `combobox`/`listbox`. El menú va en un portal con posición fija, así tablas y modales con scroll no lo recortan; se abre hacia arriba si abajo no hay espacio.
- Ids de prueba: `testId` en el botón y `${testId}-option-${valor}` en cada opción.
