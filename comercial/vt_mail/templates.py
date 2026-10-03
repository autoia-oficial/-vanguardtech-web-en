"""Plantilla de correo HTML + texto plano, por componentes.

Pensada para Gmail, Outlook (escritorio y web) y Apple Mail:
  * maquetacion con tablas, estilos en linea y una sola regla @media para movil
  * ancho fijo 600 px con fallback MSO para Outlook
  * sin JavaScript, sin tipografias externas, sin imagenes de fondo
  * una unica imagen (el logo), referenciada por Content-ID y con alt
  * cada componente tiene su equivalente en texto plano

Todo valor que viene del lead pasa por html.escape.
"""
from __future__ import annotations

from html import escape
from urllib.parse import quote

from .config import Config
from .personalize import Brief

TEMPLATE_VERSION = "vt-email-v1.0"
LOGO_CID = "vt-logo"


def logo_src(cfg: Config) -> str:
    return escape(cfg.logo_url, quote=True) if cfg.logo_url else f"cid:{LOGO_CID}"

TINTA = "#08090b"
TEXTO = "#2b2f36"
SUAVE = "#656d7a"
LINEA = "#e6e8ec"
FONDO = "#f5f6f8"
FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


# --------------------------------------------------------------- componentes --
def _parrafo(texto: str, *, margen: int = 16, color: str = TEXTO) -> str:
    return (f'<p style="margin:0 0 {margen}px 0;font-family:{FUENTE};font-size:16px;'
            f'line-height:1.6;color:{color};">{escape(texto)}</p>')


def banner_prueba(nota: str) -> str:
    return (f'<tr><td bgcolor="#fff7d6" style="background-color:#fff7d6;border-bottom:1px solid #f0e2a8;padding:12px 32px;'
            f'font-family:{FUENTE};font-size:13px;line-height:1.5;color:#5c4a00;" class="vt-pad">'
            f'<strong>PRUEBA INTERNA.</strong> {escape(nota)}</td></tr>')


def cabecera(cfg: Config) -> str:
    return (f'<tr><td class="vt-pad" style="padding:28px 40px 20px 40px;border-bottom:1px solid {LINEA};">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td style="vertical-align:middle;padding-right:12px;">'
            f'<img src="{logo_src(cfg)}" width="36" height="36" alt="{escape(cfg.brand_name)}" '
            f'style="display:block;width:36px;height:36px;border:0;border-radius:18px;"></td>'
            f'<td style="vertical-align:middle;font-family:{FUENTE};font-size:15px;font-weight:700;'
            f'letter-spacing:.06em;text-transform:uppercase;color:{TINTA};">{escape(cfg.brand_name)}</td>'
            f'</tr></table></td></tr>')


def cuerpo(brief: Brief) -> str:
    bloques = [
        _parrafo(brief.greeting, margen=18),
        _parrafo(brief.observation),
        _parrafo(brief.opportunity),
        _parrafo(brief.proposal),
        _parrafo(brief.cta, margen=24),
    ]
    return f'<tr><td class="vt-pad" style="padding:30px 40px 6px 40px;">{"".join(bloques)}</td></tr>'


def boton(cfg: Config, brief: Brief) -> str:
    destino = cfg.reply_to or cfg.contact_email
    if not destino:
        return ""  # sin direccion configurada no hay boton: la CTA en texto basta
    href = escape(f"mailto:{destino}?subject={quote(f'Propuesta para {brief.business_name}')}", quote=True)
    return (f'<tr><td class="vt-pad" style="padding:0 40px 30px 40px;">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td bgcolor="{TINTA}" style="border-radius:10px;">'
            f'<a href="{href}" style="display:inline-block;padding:13px 22px;font-family:{FUENTE};'
            f'font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">'
            f'Quiero ver la propuesta</a></td></tr></table></td></tr>')


def firma(cfg: Config) -> str:
    lineas = []
    if cfg.sender_name:
        lineas.append(f'<div style="font-weight:600;color:{TINTA};">{escape(cfg.sender_name)}</div>')
    rol = " · ".join(x for x in (cfg.sender_role, cfg.brand_name) if x)
    lineas.append(f'<div style="color:{SUAVE};">{escape(rol)}</div>')
    contacto = []
    if cfg.contact_email:
        contacto.append(f'<a href="mailto:{escape(cfg.contact_email, quote=True)}" '
                        f'style="color:{TINTA};text-decoration:none;">{escape(cfg.contact_email)}</a>')
    if cfg.contact_phone:
        tel = "".join(c for c in cfg.contact_phone if c.isdigit() or c == "+")
        contacto.append(f'<a href="tel:{tel}" style="color:{TINTA};text-decoration:none;">'
                        f'{escape(cfg.contact_phone)}</a>')
    if cfg.website_url:
        visible = cfg.website_url.replace("https://", "").replace("http://", "").rstrip("/")
        contacto.append(f'<a href="{escape(cfg.website_url, quote=True)}" '
                        f'style="color:{TINTA};text-decoration:underline;">{escape(visible)}</a>')
    if contacto:
        lineas.append(f'<div style="margin-top:6px;">{" &nbsp;·&nbsp; ".join(contacto)}</div>')
    return (f'<tr><td class="vt-pad" style="padding:22px 40px 30px 40px;border-top:1px solid {LINEA};">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td style="vertical-align:top;padding-right:14px;">'
            f'<img src="{logo_src(cfg)}" width="44" height="44" alt="Logotipo de {escape(cfg.brand_name)}" '
            f'style="display:block;width:44px;height:44px;border:0;border-radius:22px;"></td>'
            f'<td style="vertical-align:top;font-family:{FUENTE};font-size:14px;line-height:1.55;">'
            f'{"".join(lineas)}</td></tr></table></td></tr>')


def _texto_legal(cfg: Config, brief: Brief) -> list[str]:
    identidad = ", ".join(x for x in (cfg.legal_name, f"NIF {cfg.legal_nif}" if cfg.legal_nif else "",
                                      cfg.legal_address) if x)
    partes = [f"Comunicación comercial de {cfg.brand_name}" + (f" ({identidad})." if identidad else ".")]
    origen = f" (fuente: {brief.data_source})" if brief.data_source else ""
    partes.append(f"Le escribimos porque los datos de contacto de {brief.business_name} "
                  f"son públicos{origen}.")
    partes.append("Si no desea recibir más correos nuestros, responda con la palabra BAJA "
                  "y no volveremos a escribirle.")
    return partes


def pie(cfg: Config, brief: Brief) -> str:
    texto = " ".join(escape(p) for p in _texto_legal(cfg, brief))
    if cfg.privacy_url:
        texto += (f' <a href="{escape(cfg.privacy_url, quote=True)}" style="color:{SUAVE};'
                  f'text-decoration:underline;">Política de privacidad</a>.')
    return (f'<tr><td class="vt-pad" style="padding:18px 40px 0 40px;font-family:{FUENTE};font-size:12px;'
            f'line-height:1.55;color:{SUAVE};">{texto}</td></tr>')


# ------------------------------------------------------------------ montaje --
def render_html(cfg: Config, brief: Brief, *, nota_prueba: str | None = None) -> str:
    pre = escape(brief.preheader) + "&#8204;&nbsp;" * 40
    filas = "".join([
        banner_prueba(nota_prueba) if nota_prueba else "",
        cabecera(cfg),
        cuerpo(brief),
        boton(cfg, brief),
        firma(cfg),
    ])
    return f"""<!doctype html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{escape(brief.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body{{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}}
  table,td{{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}}
  img{{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}}
  a{{color:{TINTA}}}
  @media only screen and (max-width:620px){{
    .vt-container{{width:100%!important;border-radius:0!important;border-left:0!important;border-right:0!important}}
    .vt-pad{{padding-left:22px!important;padding-right:22px!important}}
    .vt-outer{{padding:0!important}}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:{FONDO};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{FONDO}" style="background-color:{FONDO};">
<tr><td align="center" class="vt-outer" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="vt-container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid {LINEA};border-radius:14px;">
{filas}
</table>
<table role="presentation" class="vt-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
{pie(cfg, brief)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
"""


def render_text(cfg: Config, brief: Brief, *, nota_prueba: str | None = None) -> str:
    lineas = []
    if nota_prueba:
        lineas += [f"[PRUEBA INTERNA] {nota_prueba}", ""]
    lineas += [brief.greeting, "", brief.observation, "", brief.opportunity, "", brief.proposal, "", brief.cta, ""]
    lineas.append("--")
    if cfg.sender_name:
        lineas.append(cfg.sender_name)
    lineas.append(" · ".join(x for x in (cfg.sender_role, cfg.brand_name) if x))
    for dato in (cfg.contact_email, cfg.contact_phone, cfg.website_url):
        if dato:
            lineas.append(dato)
    lineas += ["", "---"]
    lineas += _texto_legal(cfg, brief)
    if cfg.privacy_url:
        lineas.append(f"Política de privacidad: {cfg.privacy_url}")
    return "\n".join(lineas) + "\n"
