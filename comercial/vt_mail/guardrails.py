"""Controles que deciden si un correo puede salir.

Se aplican siempre, en simulacion y en real. Un fallo aqui no se salta con
una opcion: se corrige el dato o la plantilla.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# Lenguaje de spam, urgencia falsa y promesas que no se pueden justificar.
PROHIBIDAS = [
    "gratis", "100%", "garantizado", "garantizamos", "oferta limitada", "última oportunidad",
    "ultima oportunidad", "solo hoy", "sólo hoy", "urgente", "plazas limitadas", "no te lo pierdas",
    "no se lo pierda", "haz clic aquí", "haga clic aquí", "dinero", "ganar", "duplicar sus ventas",
    "más clientes garantizados", "número 1", "los mejores", "premiado", "exclusiva para ti",
]

MAX_HTML_BYTES = 102_400  # Gmail recorta los mensajes de mas de ~102 KB


def problemas_contenido(asunto: str, texto: str, html: str) -> list[str]:
    fallos = []
    juntos = f"{asunto}\n{texto}".lower()
    for p in PROHIBIDAS:
        if re.search(r"(?<!\w)" + re.escape(p) + r"(?!\w)", juntos):
            fallos.append(f"expresión no permitida: «{p}»")
    if "!!" in juntos or asunto.count("!") > 0:
        fallos.append("signos de exclamación en el asunto o repetidos")
    if re.search(r"\b[A-ZÁÉÍÓÚÑ]{5,}\b", asunto):
        fallos.append("palabras en mayúsculas en el asunto")
    if len(asunto) > 78:
        fallos.append("asunto de más de 78 caracteres")
    for marca in ("{{", "}}", "None", "[pendiente]", "undefined"):
        if marca in texto or marca in html:
            fallos.append(f"marcador sin rellenar: {marca}")
    if "BAJA" not in texto or "BAJA" not in html:
        fallos.append("falta la instrucción de baja")
    if "Comunicación comercial" not in texto:
        fallos.append("falta identificar el correo como comunicación comercial")
    if "<script" in html.lower() or "javascript:" in html.lower():
        fallos.append("el HTML contiene JavaScript")
    if 'src="cid:vt-logo"' not in html:
        fallos.append("falta el logo de la firma")
    if re.search(r"<img(?![^>]*\balt=)", html):
        fallos.append("imagen sin texto alternativo")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        fallos.append("HTML demasiado pesado (>100 KB)")
    return fallos


def problema_destinatario(to: str) -> str | None:
    if not to:
        return "sin correo verificado"
    if any(c in to for c in ",;<>\n\r "):
        return "el destinatario debe ser una única dirección"
    if not EMAIL_RE.match(to):
        return "dirección de correo no válida"
    return None


def excluidos(conn: sqlite3.Connection, fichero: str | Path | None) -> set[str]:
    """Union de la tabla `exclusions` y del fichero de bajas (mismo formato que
    sistema-de-ventas/correos/bajas.txt: un correo por linea, # comenta)."""
    lista = {r["email"].lower() for r in conn.execute("SELECT email FROM exclusions")}
    if fichero and Path(fichero).exists():
        for linea in Path(fichero).read_text(encoding="utf-8").splitlines():
            linea = linea.strip().lower()
            if linea and not linea.startswith("#"):
                lista.add(linea)
    return lista
