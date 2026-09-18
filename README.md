# Vanguard Tech — web

Sitio estatico de Vanguard Tech, en ingles.

## Que es esto

HTML, CSS y JavaScript escritos a mano. **Cero dependencias y ningun paso de
construccion**: lo que hay en este repositorio es exactamente lo que se sirve.

- No hay `npm install`.
- No hay framework.
- Las imagenes son webp servidos desde `/photos/`, con `srcset` de tres anchos.
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

## Estructura

| Ruta | Que es |
|---|---|
| `index.html` | La web |
| `gracias.html` | Donde aterriza el formulario |
| `aviso-legal.html`, `privacidad.html`, `cookies.html` | Paginas legales, en castellano |
| `styles.css` | Toda la hoja de estilos de la portada |
| `main.js` | Todo el movimiento de la portada. Va en fichero aparte **porque la CSP del sitio (`script-src 'self'`) bloquea el JavaScript en linea** |
| `work/` | Seis demos de sector. **Negocios inventados**, cada una lo dice en su cabecera |
| `brand/` | Isotipo oficial (`logo-mark.png` y su webp), iconos de pestaña y tarjeta de enlace |
| `photos/` | Las seis fotografias de sector, en webp y en tres anchos (400 / 800 / 1376) |
| `fonts/` | Inter y Space Grotesk, con sus licencias OFL, y `fonts.css` con las cinco `@font-face` |

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

## El isotipo

El logotipo vive en **un solo sitio**: `brand/logo-mark.png` (y `logo-mark.webp`,
que es lo que carga el navegador). La barra de navegacion, el pie, las paginas
legales, la de gracias, los iconos de pestaña y la tarjeta de enlace salen todos
de ese fichero. Se usa **tal cual**: solo se escala, y proporcionalmente.

Para cambiar de logotipo se sustituye ese fichero y se vuelven a generar los
derivados (los tamaños de icono y la tarjeta de enlace). No hay una segunda
version dibujada a mano en ningun sitio.

## Las fotografias

Una por sector, en `photos/<sector>-<ancho>.webp`. El encuadre **no** esta
recortado en el fichero: lo decide `--pos` (y `--pos-sm` por debajo de 700 px)
sobre `object-position`, asi que la misma imagen sirve para la tira apaisada de
la cabecera, para una miniatura y para la vista ampliada. Cambiar un encuadre es
cambiar dos numeros, no reexportar una imagen.

El nombre lleva el ancho, asi que una foto nueva es un fichero nuevo: por eso
`/photos/*` se cachea un año en `netlify.toml`.

## Moneda

La web en ingles cotiza en **dolares**, incluidas las cifras que aparecen dentro
de las maquetas de las demos y en las seis paginas de `work/`. Es a proposito:
mezclar euros y dolares en la misma pagina se lee como un descuido. Si la version
en ingles pasa a dirigirse solo a España, hay que cambiarlo en los tres sitios a
la vez (`index.html`, `work/*/index.html` y los datos estructurados).

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas canonical,
  og: y en `sitemap.xml`.
- Las paginas legales necesitan los datos fiscales reales.
