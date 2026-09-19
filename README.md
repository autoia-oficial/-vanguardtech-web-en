# Vanguard Tech — web

Sitio estatico de Vanguard Tech, en cuatro idiomas.

## Que es esto

**Un solo fichero.** `index.html` lleva dentro el HTML, el CSS y el JavaScript
de toda la web. No hay `styles.css`, no hay `main.js`, no hay framework, no hay
`npm install` y no hay paso de construccion: lo que esta en este repositorio es
exactamente lo que se sirve.

Fuera del HTML solo quedan **datos**, no codigo: las tipografias (`/fonts/`), el
logotipo y la tarjeta de enlace (`/brand/`) y las seis demos de sector
(`/work/`), que son paginas sueltas y autonomas. Todo se sirve desde este mismo
dominio: **la web no pide nada a terceros**, ni tipografias, ni analitica, ni
scripts. La IP de quien la visita no viaja a ninguna parte.

## Verlo en local

Al abrir `index.html` con doble clic se vera **sin tipografias**, porque las
rutas son absolutas (`/fonts/...`). Hace falta servirlo:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Y abrir http://localhost:8000/

## Estructura

| Ruta | Que es |
|---|---|
| `index.html` | **La web entera**: HTML + CSS + JavaScript |
| `gracias.html` | Donde aterriza el formulario |
| `aviso-legal.html`, `privacidad.html`, `cookies.html` | Paginas legales, en castellano |
| `work/` | Seis demos de sector. **Negocios inventados**, cada una lo dice en su cabecera |
| `brand/` | Logotipo, favicon y tarjeta de enlace |
| `fonts/` | Inter y Space Grotesk, con sus licencias OFL |

Las paginas sueltas (legales y gracias) llevan su propia hoja de estilo minima
en linea: no comparten CSS con la portada, asi que tocar una no puede romper la
otra.

## Idiomas

Cuatro: **ingles (por defecto)**, castellano de España, frances y aleman.

- El HTML esta escrito en ingles. Eso es lo que ven los buscadores y quien
  navegue sin JavaScript.
- Las otras tres traducciones viven en el objeto `I18N` del script. Cada clave
  corresponde a un `data-i18n` del HTML y traduce el bloque entero, con su
  marcado.
- El ingles no se guarda en el diccionario: se copia del DOM al arrancar, asi
  que volver a ingles restituye el original exacto.
- Orden de decision: **lo que el visitante eligio y pidio recordar** → **el
  idioma del navegador** si es uno de los cuatro → **ingles**. Nunca cambia solo
  de una visita a otra.
- En la primera visita ese orden solo decide que fila viene marcada: entrar
  exige pasar por la pantalla de idioma y pulsar Continue.
- El selector `EN ▾` de la cabecera sigue estando despues, y cambiar de idioma
  desde ahi no vuelve a abrir la entrada.
- El contenido de las maquetas de demo **no se traduce**: son ilustraciones de
  webs de negocios españoles inventados, van marcadas `aria-hidden` y
  traducirlas seria traducir una fotografia.

Para añadir un idioma: añadir su codigo a `LANGS`, su bloque a `I18N` y un
`<li>` al selector. No hay nada mas que tocar.

## Entrada (cookies -> idioma -> continuar)

Quien llega por primera vez no ve la web hasta contestar dos preguntas. El
overlay es `#onb`, vive fuera de `#main` y lo gobierna `setupOnboarding()`.

    primera visita:  cookies -> idioma -> Continue -> web
    visitas siguientes:  web directa, en el idioma guardado

- **Paso 1, cookies.** Las dos opciones tienen el mismo peso visual y estan una
  al lado de la otra. Hasta contestar no se escribe **nada**.
- **Paso 2, idioma.** Cuatro filas seleccionables, ingles preseleccionado. Al
  marcar una, la web de detras ya se traduce: se ve lo que se elige antes de
  confirmarlo. Hay que pulsar **Continue** para entrar.
- **Mientras esta abierto** el `body` lleva `is-onb` (sin scroll), y `#nav`,
  `#main`, `footer` y `#peek` llevan `inert` + `aria-hidden`. Donde no haya
  `inert`, una trampa de foco devuelve el tabulador al panel.
- El overlay se sirve con `hidden` y lo quita el script. Sin JavaScript no
  aparece: si no, seria un panel imposible de cerrar.

## Almacenamiento

La web no pone **ni una cookie**. Como mucho guarda tres datos:

| Clave | Cuando | Para que |
|---|---|---|
| `vt.consent` | siempre, al contestar | `all` o `essential` |
| `vt.onboarded` | siempre, al contestar | no repetir la entrada |
| `vt.lang` | solo con `all` | el idioma elegido |

Los dos primeros se escriben con cualquiera de las dos respuestas porque son
**estrictamente necesarios para cumplirla**: sin ellos habria que volver a
preguntar en cada carga, que es justo lo que el visitante ha contestado.

La diferencia real entre las dos opciones es la tercera clave: quien rechaza lo
no esencial entra igual en el idioma que elija, pero esa eleccion no sobrevive
a la pestaña; en la visita siguiente se vuelve a deducir del navegador. No hay
ninguna otra diferencia, porque no hay analitica, ni publicidad, ni
seguimiento. `cookies.html` lo explica igual.

## Tipografia

Tres papeles, y todo el texto de la web pertenece a uno de los tres:

| Variable | Donde | Como |
|---|---|---|
| `--font-display` | Titulares y cifras grandes | Space Grotesk 700 |
| `--font-label` | Rotulos, numeros de paso, metadatos | La MISMA familia, pequeña, en versalitas y con tracking |
| `--font-body` | Parrafos, botones, formularios, interfaz | Inter 400/500/600 |

Solo hay cinco ficheros de tipografia: Inter 400/500/600 y Space Grotesk
500/700. **Ningun elemento usa un peso que no exista**, porque un peso que falta
lo falsifica el navegador engordando el trazo, y eso es lo que hacia que unas
secciones pareciesen de otra web.

## Radios

Tres, y todo lo que es imagen, pantalla o contenedor visual usa uno:
`--radius-sm` (12 px), `--radius-md` (18 px) y `--radius-lg` (26 px). En movil
bajan un punto.

## Movimiento

Todo el movimiento va en **un solo bucle**:

- El **scroll** manda en el relato. Cada seccion con historia calcula su
  progreso 0..1 y escribe variables CSS. No son animaciones "disparadas": son
  funcion directa de la posicion, asi que se pueden parar a medio camino,
  volver atras y llegar de un salto desde el menu.
- Los giros pasan por un **muelle**: el objeto persigue a su objetivo un 18 %
  por fotograma. Es lo que le da peso — sigue al scroll, no esta clavado a el.
- El **raton** manda en la luz y el relieve, y siempre suma sobre lo que el
  scroll ya decidio.
- La geometria se mide **una vez** (al cargar, al cambiar de tamaño, al entrar
  las tipografias y al cambiar de idioma), no en cada fotograma.
- Solo se escriben variables CSS **cuando cambian de verdad**: escribir una en
  una tarjeta invalida el estilo de todo lo que lleva dentro.
- Nada fuera de pantalla se recalcula. Cuando una seccion entra, se fuerza una
  pasada: si no, llegar de un salto la dejaba sin pintar.
- Con `prefers-reduced-motion: reduce` no se anima nada: las historias se
  convierten en listas legibles con el mismo contenido.

## Cabeceras y despliegue

Netlify, con `netlify.toml`: rama `main`, sin comando de construccion,
directorio publicado `.`.

La politica de seguridad autoriza el script en linea **por huella**
(`'sha256-...'`), no con `'unsafe-inline'`. **Si se toca el JavaScript hay que
regenerar las huellas**:

```bash
python3 - <<'PY'
import re, hashlib, base64, io
h = io.open('index.html', encoding='utf-8').read()
for m in re.finditer(r'<script([^>]*)>(.*?)</script>', h, re.S):
    if 'src=' in m.group(1): continue
    print("'sha256-" + base64.b64encode(
        hashlib.sha256(m.group(2).encode()).digest()).decode() + "'")
PY
```

y pegarlas en `script-src` dentro de `netlify.toml`.

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas canonical,
  og: y en `sitemap.xml`.
- Las paginas legales necesitan los datos fiscales reales.
- El formulario todavia no envia: el JavaScript cancela el envio y lo dice.
  Falta conectar el buzon.
