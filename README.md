# Vanguard Tech — web

Sitio estatico de Vanguard Tech, en ingles.

## Que es esto

HTML, CSS y JavaScript escritos a mano. **Cero dependencias y ningun paso de
construccion**: lo que hay en este repositorio es exactamente lo que se sirve.

- No hay `npm install`.
- No hay framework.
- Las tipografias se sirven desde `/fonts/`, no desde Google Fonts: asi la IP
  del visitante no viaja a un tercero antes de que acepte nada.
- El formulario lo procesa Netlify. Los envios llegan al panel del sitio.

## Verlo en local

Al abrir `index.html` con doble clic se vera **sin estilos**, porque las rutas
son absolutas (`/styles.css`). Hace falta servirlo:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Y abrir http://localhost:8000/

## Marca

El logotipo es **un solo fichero**: `brand/logo-mark.svg`. Lo usan la barra
superior, el pie, las paginas legales y `gracias.html`, y se usa **tal cual**:
mismo dibujo, misma separacion entre las dos barras, mismo angulo, mismo grosor
y mismos cantos redondeados. Solo se escala, y proporcionalmente.

**Para cambiar el logotipo se sustituye ese fichero y nada mas.** Si el oficial
llega en PNG, se deja como `brand/logo-mark.png` y se cambia la extension en los
`src` (dos en `index.html`, uno en cada pagina legal y uno en `gracias.html`).
No hay ninguna copia del dibujo en el CSS ni en el JavaScript.

El resto de la marca es **monocroma**: negro, blanco, grafito y plata. Ya no hay
azul de marca; el color solo aparece cuando significa algo — un estado, el
resultado de una comprobacion, el acento de una demo o el haz del precio.

| Donde | Que hay |
|---|---|
| `brand/logo-mark.svg` | **El logotipo.** El unico sitio donde vive el dibujo |
| `brand/simbolo.svg`, `brand/simbolo-blanco.svg` | Isotipo suelto, para fondos claros y oscuros |
| `brand/logo-horizontal.svg`, `-blanco.svg` | Isotipo + nombre |
| `brand/favicon.svg`, `favicon.svg` | Icono de pestana |
| `brand/share-card.png` | Tarjeta de enlace (1200x630) |

## Estructura

| Ruta | Que es |
|---|---|
| `index.html` | La web |
| `gracias.html` | Donde aterriza el formulario |
| `aviso-legal.html`, `privacidad.html`, `cookies.html` | Paginas legales, en castellano |
| `work/` | Seis demos de sector. **Negocios inventados**, cada una lo dice en su cabecera |
| `brand/` | Logotipo, favicon y tarjeta de enlace |
| `fonts/` | Inter y Space Grotesk, con sus licencias OFL |

## De donde sale

Este repositorio se **genera** desde el proyecto principal, donde viven el
motor, el CRM, las plantillas de las demos y los tests:

```bash
npm run vt -- web export
```

No edites estos ficheros a mano: el siguiente export los sobreescribe. Los
cambios se hacen en `VANGUARD TECH/WEBSITE/site/` del proyecto principal.

## Actualizar la web publicada

El export borra esta carpeta entera salvo `.git`, asi que el remoto y el
historial sobreviven. Tras tocar la web en el proyecto principal:

```bash
npm run vt -- web export
cd ../vanguardtech-web-en
git add -A && git commit -m "Actualizar la web" && git push
```

Netlify despliega solo al recibir el push.

## Movimiento

Todo el movimiento vive en `main.js`, sin dependencias, en **un solo bucle**:

- El **scroll** manda en el relato. Cada seccion con historia (hero, las cuatro
  etapas, el proceso, el anillo de sectores, el escaparate y el precio) calcula
  su progreso 0..1 desde la posicion de su contenedor y escribe variables CSS.
  No hay animaciones "disparadas": son funcion directa del scroll, asi que se
  pueden parar a medio camino, volver atras y llegar de un salto desde el menu.
- El **raton** manda en la luz y el relieve, y siempre suma sobre lo que el
  scroll ya decidio.
- El bucle solo pide fotogramas cuando hay algo que mover, y ninguna seccion
  fuera de pantalla se recalcula. Cuando una entra, se fuerza una pasada: si no,
  llegar de un salto la dejaba sin pintar.
- Con `prefers-reduced-motion: reduce` no se anima nada: las historias se
  convierten en listas legibles con el mismo contenido y el haz del precio se
  pinta una sola vez, ya resuelto. Lo mismo por debajo de 560 px de alto, donde
  un panel pegajoso no cabe.

**Las maquetas de web** (`.mock`) son un componente reutilizable: el mismo
sirve para el hero, las cuatro etapas, las seis tarjetas de sector, los tres
escaparates y la vista ampliada. Cada una es una **portada entera** — franja de
aviso, navegacion, cabecera editorial, servicios con precio, tarjetas, mapa,
franja de llamada y pie — medida en `em`, con el tamaño controlado por `--mfs`.
Las "fotos" son composiciones de degradados: **no hay imagenes externas**, asi
que no hay nada que se pueda caer.

**"View demo"** no lleva a un dominio inventado: abre la misma maqueta a tamaño
grande dentro de una ventana, clonada de la tarjeta que se ha pulsado, con su
nota de demo y el enlace a la pagina de ejemplo de `work/` que si existe. Las
barras de direccion de las maquetas ponen `yourbusiness.es`, que es un marcador
y se lee como tal.

**El precio** tiene su propia escena: un lienzo con trazos de color que nacen
juntos, se abren, se separan del todo, se recogen y acaban formando un halo
alrededor del numero. Los trazos nunca entran en el rectangulo que ocupa el
precio — se calcula la distancia del centro al borde de ese rectangulo en cada
direccion — asi que el numero siempre es lo que se lee.

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas canonical,
  og: y en `sitemap.xml`.
- Las paginas legales necesitan los datos fiscales reales.
