# Vanguard Tech — web

Sitio oficial de Vanguard Tech, en ingles, con las paginas legales y las demos
de sector en castellano.

## Que es esto

**Once ficheros HTML y nada mas.** Cada pagina se basta a si misma: el CSS, el
JavaScript, las tipografias, el isotipo y las fotografias viajan dentro del
propio documento como `data:` URI.

- No hay `npm install`, ni framework, ni paso de construccion.
- No hay `styles.css` ni `main.js`: estan dentro de cada pagina.
- No se carga **nada** de terceros. Abrir cualquier pagina hace **una sola
  peticion de red**: la del propio documento.
- Lo que hay en este repositorio es exactamente lo que se sirve.

## Verlo en local

Un doble clic sobre `index.html` funciona: no hay rutas relativas que resolver.
Para probar los enlaces entre paginas hace falta servirlo:

```bash
python3 -m http.server 8000
# y abrir http://localhost:8000/
```

## Estructura

| Ruta | Que es |
|---|---|
| `index.html` | La web. Autocontenida |
| `gracias.html` | Donde aterriza el formulario |
| `aviso-legal.html`, `privacidad.html`, `cookies.html` | Paginas legales, en castellano |
| `work/<sector>/index.html` | Seis demos de sector. **Negocios inventados**, cada una lo dice en su cabecera |
| `brand/logo-mark.png` | El isotipo oficial. Original del que salen todos los tamaños |
| `brand/share-card.png` | Tarjeta de enlace para redes (`og:image`) |
| `fonts/OFL-*.txt` | Licencias de Inter y Space Grotesk |
| `netlify.toml` | Cabeceras y politica de seguridad |
| `robots.txt`, `sitemap.xml` | Indexacion |

### Por que estos cuatro ficheros no estan empotrados

- **`brand/share-card.png`** — WhatsApp, LinkedIn y X no leen un `data:` URI en
  la tarjeta de enlace. Tiene que ser una URL de verdad.
- **`brand/logo-mark.png`** — es el original del isotipo y la URL a la que
  apuntan los datos estructurados (`"logo"` del JSON-LD). Para cambiar de
  logotipo se sustituye **este** fichero y se regeneran los tamaños.
- **`fonts/OFL-*.txt`** — Inter y Space Grotesk se distribuyen bajo SIL Open
  Font License 1.1, que **obliga** a que la licencia viaje con la tipografia.
  Van empotradas en cada pagina, asi que la licencia tiene que estar aqui.

## Publicacion

Netlify, sitio estatico, sin compilar nada:

| Ajuste | Valor |
|---|---|
| Production branch | `main` |
| Base directory | *(vacio)* |
| Build command | *(vacio)* |
| Publish directory | `.` |
| Functions directory | *(vacio)* |
| Environment variables | *(ninguna)* |

Netlify despliega solo al recibir un push a `main`.

## Politica de seguridad — leer antes de tocar el HTML

`netlify.toml` no usa `script-src 'unsafe-inline'`: el unico script ejecutable
del sitio se autoriza **por su huella SHA-256**, y es el mismo en las cuatro
paginas que lo llevan (portada, aviso legal, privacidad y cookies).

**Si se edita ese JavaScript, la huella deja de coincidir y el navegador bloquea
el script en silencio: la web se ve pero no se mueve.** Hay que recalcularla y
actualizar `netlify.toml`:

```bash
python3 - <<'EOF'
import base64, hashlib, io, re
s = io.open('index.html', encoding='utf-8').read()
m = re.search(r'<script(?![^>]*\btype=)[^>]*>(.*?)</script>', s, re.S)
print('sha256-' + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())
EOF
```

## Formulario

Lo procesa **Netlify Forms**. El markup ya lleva lo que Netlify necesita:
`name="propuesta"`, `data-netlify="true"`, el campo oculto `form-name` y un
honeypot (`netlify-honeypot="empresa-web"`). Los envios llegan al panel del
sitio y el visitante aterriza en `/gracias.html`.

**No añadas JavaScript que cancele el `submit`**: eso deja el formulario muerto.

## Las fotografias

Seis, una por sector, empotradas en las paginas que las usan. El encuadre **no**
esta recortado en el fichero: lo deciden `--pos` y `--pos-sm` sobre
`background-position`. Cambiar un encuadre es cambiar dos numeros.

Dentro de cada pagina cada foto se declara **una sola vez** como variable CSS en
`:root` y los `<img>` la pintan de fondo. Sin eso, la portada pesaria cuatro
veces mas: la foto del restaurante aparece treinta veces entre la cabecera, el
anillo, el escaparate y las miniaturas.

## Moneda

Toda la web cotiza en **dolares**, incluidas las cifras dentro de las maquetas y
de las seis demos. Mezclar euros y dolares se lee como un descuido.

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas `canonical`,
  `og:` y en `sitemap.xml`. Hay que cambiarlo por el definitivo.
- Las paginas legales necesitan los datos fiscales reales.
- En los datos estructurados de `index.html` quedan dos `"priceCurrency": "EUR"`
  que deberian decir `"USD"`, para que Google no lea una moneda distinta de la
  que muestra la pagina.
