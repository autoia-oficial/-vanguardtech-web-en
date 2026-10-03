# Sistema comercial — Vanguard Tech

Correos comerciales HTML personalizados, con CRM, seguimiento y guardrails.
Python 3 y SQLite, **sin dependencias**.

```
LEAD → INVESTIGACIÓN → OPORTUNIDAD → PERSONALIZACIÓN → PROPUESTA → EMAIL → CRM → SEGUIMIENTO → MÉTRICAS
```

> **Modo simulación por defecto** (`VT_LIVE_MODE=false`). Mientras sea así,
> `despachar` solo escribe `.eml` en `salida/simulacion/` y no conecta con
> ningún servidor de correo.

## Empezar

```bash
cd comercial
cp config.ejemplo.env config.local.env    # y rellénalo; no se sube al repo
python3 cli.py estado                     # qué falta, sin mostrar valores
python3 -m unittest discover -s tests -v  # 27 tests, sin red
```

## Flujo

```bash
python3 cli.py importar leads.json            # añade o completa; nunca borra
python3 cli.py segmentos                      # sin_web / web_antigua / web_problemas / otras
python3 cli.py preparar --campana sin_web     # inicial en borrador + 3 seguimientos simulados
python3 cli.py revisar                        # salida/revision/index.html: cada correo, sus datos y su fuente
python3 cli.py aprobar 12 --por "Ander"       # visto bueno humano, uno a uno
python3 cli.py despachar                      # simulación
python3 cli.py respuesta 12 respondido|baja|rebote
python3 cli.py excluir correo@negocio.es
```

Orden de campañas: **sin web → web antigua → web con problemas → otras**.

## Datos de un lead

Cada frase personalizada sale de un **hecho con fuente** (`facts`). Si un dato
no está, la frase no se escribe.

```json
{
  "external_id": "osm-123", "business_name": "…", "sector": "restaurante",
  "city": "Madrid", "email": "…", "source": "directorio público X",
  "facts": [
    {"key": "sin_web", "value": "true", "source": "comprobado 2026-10-01"},
    {"key": "zona", "value": "Malasaña", "source": "Google Business"},
    {"key": "google_business", "value": "true", "source": "Google Business", "source_url": "…"},
    {"key": "rating", "value": "4.6", "source": "Google Business"},
    {"key": "reviews_count", "value": "312", "source": "Google Business"},
    {"key": "instagram", "value": "true", "source": "instagram.com/…"},
    {"key": "servicios", "value": "su cocina de mercado y la terraza", "source": "Instagram"}
  ]
}
```

Claves que entiende hoy: `sin_web`, `web_antigua`, `web_problema`,
`oportunidad`, `zona`, `google_business`, `rating`, `reviews_count`,
`instagram`, `facebook`, `tiktok`, `servicios`. Sectores con texto propio:
restaurante, peluqueria, clinica_dental, gimnasio, inmobiliaria (el resto usa
uno genérico).

## Qué hay

| Fichero | Para qué |
|---|---|
| `cli.py` | Línea de comandos |
| `vt_mail/config.py` | Variables `VT_*`; `describir()` nunca enseña valores |
| `vt_mail/db.py` | CRM en SQLite: leads, hechos con fuente, correos, exclusiones, eventos |
| `vt_mail/personalize.py` | Segmentación y personalización solo con hechos |
| `vt_mail/templates.py` | Plantilla HTML por componentes + texto plano |
| `vt_mail/followups.py` | Inicial, seguimiento 1 (+4 d), seguimiento 2 (+10 d), cierre (+18 d) |
| `vt_mail/guardrails.py` | Spam, urgencia falsa, marcadores vacíos, baja, logo, peso, destinatario único |
| `vt_mail/mime.py` | `multipart/alternative` (texto + HTML con logo inline) y SMTP |
| `vt_mail/dispatcher.py` | Preparar, aprobar, despachar, respuestas, prueba interna |
| `assets/vt-logo-96.png` | Logo oficial (de `brand/apple-touch-icon.png`), 11 KB |
| `datos/ejemplo/restaurante_ficticio.json` | Negocio **ficticio** para la prueba interna |

Lo que se registra de cada correo (tabla `emails`): segmento, motivo, datos
usados y su fuente, asunto, versión de plantilla, HTML, texto, estado, fechas
de preparación, programación, aprobación y envío, respuesta, baja y notas.

## Guardrails

- `VT_LIVE_MODE=false` por defecto: simulación.
- En real, **bloqueado** si falta SMTP o cualquier dato legal (`VT_LEGAL_NAME`,
  `VT_LEGAL_NIF`, `VT_LEGAL_ADDRESS`, `VT_LEGAL_EMAIL`), el contacto o la
  política de privacidad. Además exige `--confirmar`.
- Solo salen correos **aprobados a mano**. Los seguimientos nunca salen solos.
- Bajas: tabla `exclusions` + fichero `VT_EXCLUSION_FILE` (mismo formato que
  `sistema-de-ventas/correos/bajas.txt`, así que pueden compartir lista).
- Sin duplicados: un paso por lead y campaña, y un mismo correo no entra dos
  veces en la misma campaña.
- Tope diario (`VT_DAILY_LIMIT`) e intervalo (`VT_SEND_INTERVAL_SECONDS`).
- Un único `To`; no existe forma de añadir Cc o Bcc.
- Respuesta o baja: se cancela el resto de la secuencia.
- Todo queda en la tabla `events`.

## Prueba interna

```bash
VT_TEST_RECIPIENT=tu@correo.es python3 cli.py prueba \
  --lead datos/ejemplo/restaurante_ficticio.json --para tu@correo.es
# añade --enviar --confirmar para mandarla por SMTP (una sola)
```

**Envíala por SMTP con este comando, no con otra herramienta.** Comprobado: la
API/conector de Gmail reconstruye el mensaje (quita el `<style>`, elimina las
`<img>` y reescribe los `Content-ID` y los enlaces), así que el resultado ya no
es el que genera el motor y llega sin logo.

`VT_LOGO_URL` permite enlazar el logo por https en vez de incrustarlo (por
defecto va incrustado por `cid:vt-logo`, que es lo más fiable por SMTP).

Solo acepta un negocio marcado `is_fictitious` y el destinatario de
`VT_TEST_RECIPIENT`. Usa el mismo motor que la campaña, con una franja
«PRUEBA INTERNA» y el asunto prefijado.

## Legal

Es comunicación comercial no solicitada: **LSSI-CE art. 21** y **RGPD**.
El correo se identifica como comunicación comercial, dice de dónde salen los
datos y ofrece la baja en el propio texto. Antes de la primera campaña real
hay que completar los datos legales y revisar el texto con un asesor.
