"""Construccion del mensaje MIME y transportes.

Estructura:
    multipart/alternative
    ├── text/plain; charset=utf-8
    └── multipart/related
        ├── text/html; charset=utf-8
        └── image/png  (logo, Content-ID <vt-logo>, inline)

Un unico destinatario en To. Este modulo no admite Cc ni Bcc: no existe
ningun parametro para ponerlos.
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path

from .config import Config
from .guardrails import problema_destinatario
from .templates import LOGO_CID, TEMPLATE_VERSION


def construir(cfg: Config, to: str, asunto: str, texto: str, html: str, *, prueba: bool = False) -> EmailMessage:
    fallo = problema_destinatario(to)
    if fallo:
        raise ValueError(f"Destinatario rechazado: {fallo}")
    msg = EmailMessage()
    remitente = cfg.from_email or cfg.contact_email or "no-configurado@invalid"
    msg["From"] = formataddr((cfg.from_name or cfg.brand_name, remitente))
    msg["To"] = to
    msg["Subject"] = asunto
    msg["Date"] = formatdate(localtime=True)
    dominio = remitente.split("@")[-1]
    msg["Message-ID"] = make_msgid(domain=dominio)
    if cfg.reply_to:
        msg["Reply-To"] = cfg.reply_to
    baja = cfg.reply_to or cfg.contact_email or cfg.from_email
    if baja:
        msg["List-Unsubscribe"] = f"<mailto:{baja}?subject=BAJA>"
    msg["X-VT-Template"] = TEMPLATE_VERSION
    if prueba:
        msg["X-VT-Test"] = "prueba-interna"

    msg.set_content(texto, subtype="plain", charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")
    if cfg.logo_url:
        return msg  # logo enlazado: no hace falta la parte multipart/related
    parte_html = msg.get_payload()[1]
    logo = Path(cfg.logo_path).read_bytes()
    parte_html.add_related(logo, maintype="image", subtype="png", cid=f"<{LOGO_CID}>",
                           filename="vanguard-tech.png", disposition="inline")
    return msg


class TransporteSMTP:
    """Envio real. Solo lo usa el dispatcher cuando todos los controles pasan."""

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def enviar(self, msg: EmailMessage) -> None:
        cfg = self.cfg
        contexto = ssl.create_default_context()
        if cfg.smtp_port == 465:
            servidor = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, context=contexto, timeout=30)
        else:
            servidor = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=30)
            servidor.starttls(context=contexto)
        try:
            servidor.login(cfg.smtp_user, cfg.smtp_password)
            servidor.send_message(msg, to_addrs=[msg["To"]])
        finally:
            servidor.quit()

    def comprobar(self) -> None:
        """Saluda y autentica sin enviar nada."""
        cfg = self.cfg
        contexto = ssl.create_default_context()
        if cfg.smtp_port == 465:
            s = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, context=contexto, timeout=20)
        else:
            s = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20)
            s.starttls(context=contexto)
        try:
            s.login(cfg.smtp_user, cfg.smtp_password)
        finally:
            s.quit()
