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

El logotipo es **monocromo**: negro, blanco y plata. Ya no hay azul de marca
(`#2f6bff`); el color solo aparece cuando significa algo — un estado, un
resultado de comprobacion, el acento de una demo.

| Donde | Que hay |
|---|---|
| `brand/simbolo.svg`, `brand/simbolo-blanco.svg` | El isotipo, para fondos claros y oscuros |
| `brand/logo-horizontal.svg`, `-blanco.svg` | Isotipo + nombre |
| `brand/favicon.svg`, `favicon.svg` | Icono de pestana |
| `brand/share-card.png` | Tarjeta de enlace (1200x630) |

En `index.html`, `gracias.html` y las paginas legales el isotipo va **en linea**
(dos `path`), para que tome el color del fondo de cada barra sin cargar otro
archivo. Si llega un SVG oficial nuevo, se sustituyen esos dos `path` — hay un
comentario en el sitio exacto — y los archivos de `brand/`. La forma no se
redibuja aqui: se copia del asset.

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
  etapas, el proceso, el anillo de sectores y el escaparate) calcula su
  progreso 0..1 desde la posicion de su contenedor y escribe variables CSS. No
  hay animaciones "disparadas": son funcion directa del scroll, asi que se
  pueden parar a medio camino y volver atras.
- El **raton** manda en la luz y el relieve, y siempre suma sobre lo que el
  scroll ya decidio.
- El bucle solo pide fotogramas cuando hay algo que mover, y ninguna seccion
  fuera de pantalla se recalcula.
- Con `prefers-reduced-motion: reduce` no se anima nada: las historias se
  convierten en listas legibles con el mismo contenido. Lo mismo por debajo de
  560 px de alto, donde un panel pegajoso no cabe.

Las maquetas de web (`.mock`) son un componente reutilizable: el mismo sirve
para el hero, las cuatro etapas, las seis tarjetas de sector y los tres
escaparates. Todo mide en `em` y el tamano se controla con `--mfs`. Las "fotos"
son composiciones de degradados: **no hay imagenes externas**, asi que no hay
nada que se pueda caer.

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas canonical,
  og: y en `sitemap.xml`.
- Las paginas legales necesitan los datos fiscales reales.
