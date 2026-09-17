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

## Pendiente

- El dominio es un marcador (`vanguardtech.es`) en las etiquetas canonical,
  og: y en `sitemap.xml`.
- Las paginas legales necesitan los datos fiscales reales.
