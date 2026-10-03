"""Configuracion del sistema comercial.

Todo sale de variables de entorno VT_*, o de un fichero `config.local.env`
(KEY=VALOR, una por linea) que NO se sube al repositorio. Las variables de
entorno ganan al fichero.

Nada de este modulo imprime valores: `describir()` solo dice si cada clave
esta configurada o vacia, para poder revisarlo sin exponer credenciales.

Por defecto el sistema esta en SIMULACION (VT_LIVE_MODE=false). Ninguna
campana manda nada mientras eso no cambie a proposito.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FICHERO_LOCAL = RAIZ / "config.local.env"

SECRETAS = {"VT_SMTP_PASSWORD"}


def _leer_fichero(ruta: Path) -> dict[str, str]:
    datos: dict[str, str] = {}
    if not ruta.exists():
        return datos
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        datos[clave.strip()] = valor.strip().strip('"').strip("'")
    return datos


def _verdadero(valor: str) -> bool:
    return valor.strip().lower() in {"1", "true", "si", "sí", "yes", "on"}


@dataclass
class Config:
    live_mode: bool = False

    # Envio
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = field(default="", repr=False)
    from_email: str = ""
    from_name: str = ""
    reply_to: str = ""

    # Identidad y firma (nunca se inventan: vacio = no se muestra)
    brand_name: str = "Vanguard Tech"
    sender_name: str = ""
    sender_role: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    website_url: str = ""
    privacy_url: str = ""

    # Datos legales (LSSI art. 10 / RGPD art. 13-14). Los mismos que pide aviso-legal.html
    legal_name: str = ""
    legal_nif: str = ""
    legal_address: str = ""
    legal_email: str = ""

    # Guardrails
    daily_limit: int = 15
    send_interval_seconds: int = 45
    test_recipient: str = ""

    # Rutas
    db_path: str = str(RAIZ / "datos" / "vt_comercial.db")
    exclusion_file: str = str(RAIZ / "datos" / "bajas.txt")
    outbox_dir: str = str(RAIZ / "salida")
    logo_path: str = str(RAIZ / "assets" / "vt-logo-96.png")
    # Si se define, el logo se enlaza por URL (https) en vez de ir incrustado por Content-ID.
    # Util cuando el canal de envio reescribe los Content-ID (p. ej. la API de Gmail).
    logo_url: str = ""

    @classmethod
    def cargar(cls, entorno: dict[str, str] | None = None, fichero: Path | None = FICHERO_LOCAL) -> "Config":
        valores = _leer_fichero(fichero) if fichero else {}
        valores.update({k: v for k, v in (entorno if entorno is not None else os.environ).items() if k.startswith("VT_")})
        cfg = cls()
        for f in fields(cls):
            clave = "VT_" + f.name.upper()
            if clave not in valores:
                continue
            crudo = valores[clave]
            if f.type in ("bool", bool):
                setattr(cfg, f.name, _verdadero(crudo))
            elif f.type in ("int", int):
                setattr(cfg, f.name, int(crudo))
            else:
                setattr(cfg, f.name, crudo)
        if not cfg.privacy_url and cfg.website_url:
            cfg.privacy_url = cfg.website_url.rstrip("/") + "/privacidad.html"
        return cfg

    # ------------------------------------------------------------------ checks
    def faltan_para_enviar(self) -> list[str]:
        """Lo imprescindible para mandar cualquier correo por SMTP."""
        req = {
            "VT_SMTP_HOST": self.smtp_host,
            "VT_SMTP_USER": self.smtp_user,
            "VT_SMTP_PASSWORD": self.smtp_password,
            "VT_FROM_EMAIL": self.from_email,
        }
        return [k for k, v in req.items() if not v]

    def faltan_para_campana(self) -> list[str]:
        """Lo imprescindible, ademas, para una campana real: identidad legal y contacto."""
        req = {
            "VT_LEGAL_NAME": self.legal_name,
            "VT_LEGAL_NIF": self.legal_nif,
            "VT_LEGAL_ADDRESS": self.legal_address,
            "VT_LEGAL_EMAIL": self.legal_email,
            "VT_CONTACT_EMAIL": self.contact_email,
            "VT_PRIVACY_URL o VT_WEBSITE_URL": self.privacy_url,
        }
        return self.faltan_para_enviar() + [k for k, v in req.items() if not v]

    def describir(self) -> list[str]:
        """Estado de cada clave SIN su valor (las secretas jamas se muestran)."""
        filas = []
        for f in fields(self):
            clave = "VT_" + f.name.upper()
            valor = getattr(self, f.name)
            if clave in SECRETAS:
                estado = "configurada (oculta)" if valor else "VACIA"
            elif isinstance(valor, bool):
                estado = "true" if valor else "false"
            elif isinstance(valor, int):
                estado = str(valor)
            else:
                estado = "configurada" if valor else "vacia"
            filas.append(f"{clave:28} {estado}")
        return filas
