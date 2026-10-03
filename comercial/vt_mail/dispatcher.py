"""Preparacion, revision y despacho de correos.

Flujo:
    preparar()  -> el correo inicial queda en 'borrador' y los seguimientos en
                   'simulado', todos asociados al lead en la tabla `emails`
    revision    -> `cli.py revisar` genera una pagina local para leerlos
    aprobar()   -> una persona da el visto bueno, correo a correo
    despachar() -> con VT_LIVE_MODE=false SOLO escribe .eml en salida/simulacion
                   y no llama a ningun transporte. En real, ademas de lo
                   anterior exige configuracion completa, respeta bajas,
                   duplicados, tope diario e intervalo.

La prueba interna va por un camino aparte (preparar_prueba / checklist_prueba)
que comparte el mismo motor de plantilla y MIME pero nunca toca leads reales.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import db
from .config import Config
from .followups import PASOS, brief_para_paso
from .guardrails import excluidos, problema_destinatario, problemas_contenido
from .mime import construir
from .personalize import construir_brief
from .templates import TEMPLATE_VERSION, render_html, render_text

PREFIJO_PRUEBA = "[PRUEBA INTERNA] "


class Bloqueado(Exception):
    """Un guardrail impide continuar."""


def _contenido(cfg: Config, lead: dict, paso: str, nota_prueba: str | None = None):
    base = construir_brief(lead)
    brief = brief_para_paso(base, paso, cfg, (lead.get("sector") or "").lower())
    html = render_html(cfg, brief, nota_prueba=nota_prueba)
    texto = render_text(cfg, brief, nota_prueba=nota_prueba)
    return brief, html, texto


# ------------------------------------------------------------------ preparar --
def preparar(conn: sqlite3.Connection, cfg: Config, lead_id: int, campana: str,
             inicio: datetime | None = None) -> list[int]:
    lead = db.cargar_lead(conn, lead_id)
    email = (lead.get("email") or "").lower()
    if email and email in excluidos(conn, cfg.exclusion_file):
        db.registrar(conn, "omitido", "excluido (baja)", lead_id=lead_id)
        return []
    if email:
        otro = conn.execute(
            """SELECT e.id FROM emails e JOIN leads l ON l.id = e.lead_id
               WHERE l.email = ? AND e.campaign = ? AND e.lead_id <> ? AND e.is_test = 0""",
            (email, campana, lead_id)).fetchone()
        if otro:
            db.registrar(conn, "omitido", "duplicado: el mismo correo ya está en esta campaña", lead_id=lead_id)
            return []
    inicio = inicio or datetime.now(timezone.utc)
    ids = []
    for paso, dias in PASOS:
        brief, html, texto = _contenido(cfg, lead, paso)
        fallos = problemas_contenido(brief.subject, texto, html)
        if fallos:
            raise Bloqueado(f"Lead {lead_id}, paso {paso}: " + "; ".join(fallos))
        existente = conn.execute("SELECT id, status FROM emails WHERE lead_id = ? AND campaign = ? AND step = ?",
                                 (lead_id, campana, paso)).fetchone()
        if existente and existente["status"] not in ("borrador", "simulado"):
            ids.append(existente["id"])  # ya aprobado o enviado: no se toca
            continue
        fila = dict(
            lead_id=lead_id, campaign=campana, segment=brief.segment, step=paso,
            contact_reason=brief.contact_reason,
            personalization=json.dumps({"facts": brief.facts_used, "source": brief.data_source},
                                       ensure_ascii=False),
            to_email=email or None, subject=brief.subject, template_version=TEMPLATE_VERSION,
            html=html, text=texto, status="borrador" if paso == "inicial" else "simulado",
            prepared_at=db.ahora(),
            scheduled_for=(inicio + timedelta(days=dias)).replace(microsecond=0).isoformat(),
            notes=None if email else "Sin correo verificado: no se podrá enviar.",
        )
        if existente:
            asign = ", ".join(f"{k} = ?" for k in fila)
            conn.execute(f"UPDATE emails SET {asign} WHERE id = ?", [*fila.values(), existente["id"]])
            ids.append(existente["id"])
        else:
            cols = ", ".join(fila)
            conn.execute(f"INSERT INTO emails ({cols}) VALUES ({', '.join('?' * len(fila))})", list(fila.values()))
            ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        db.registrar(conn, "preparado", f"{campana}/{paso}", lead_id=lead_id, email_id=ids[-1])
    conn.commit()
    return ids


def aprobar(conn: sqlite3.Connection, email_id: int, por: str) -> None:
    fila = conn.execute("SELECT status FROM emails WHERE id = ?", (email_id,)).fetchone()
    if not fila or fila["status"] not in ("borrador", "simulado"):
        raise Bloqueado(f"El correo {email_id} no está pendiente de revisión")
    conn.execute("UPDATE emails SET status = 'aprobado', approved_by = ?, approved_at = ? WHERE id = ?",
                 (por, db.ahora(), email_id))
    db.registrar(conn, "aprobado", por, email_id=email_id)


def registrar_respuesta(conn: sqlite3.Connection, cfg: Config, email_id: int, tipo: str, nota: str = "") -> None:
    """tipo: respondido | baja | rebote. Cancela el resto de la secuencia."""
    if tipo not in ("respondido", "baja", "rebote"):
        raise ValueError(tipo)
    fila = conn.execute("SELECT lead_id, campaign FROM emails WHERE id = ?", (email_id,)).fetchone()
    conn.execute("UPDATE emails SET reply_status = ?, replied_at = ?, notes = COALESCE(notes || ' | ', '') || ? "
                 "WHERE id = ?", (tipo, db.ahora(), nota, email_id))
    conn.execute("UPDATE emails SET status = 'cancelado' WHERE lead_id = ? AND campaign = ? "
                 "AND status IN ('borrador', 'simulado', 'aprobado')", (fila["lead_id"], fila["campaign"]))
    estado = {"respondido": "respondido", "baja": "excluido", "rebote": "descartado"}[tipo]
    conn.execute("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?", (estado, db.ahora(), fila["lead_id"]))
    if tipo in ("baja", "rebote"):
        correo = conn.execute("SELECT email FROM leads WHERE id = ?", (fila["lead_id"],)).fetchone()["email"]
        if correo:
            conn.execute("INSERT OR IGNORE INTO exclusions (email, reason, created_at) VALUES (?, ?, ?)",
                         (correo.lower(), tipo, db.ahora()))
    db.registrar(conn, tipo, nota, lead_id=fila["lead_id"], email_id=email_id)


# ----------------------------------------------------------------- despachar --
def despachar(conn: sqlite3.Connection, cfg: Config, transporte=None, *, ahora: datetime | None = None,
              dormir=time.sleep) -> dict:
    ahora = ahora or datetime.now(timezone.utc)
    resumen = {"modo": "real" if cfg.live_mode else "simulacion", "simulados": 0, "enviados": 0,
               "omitidos": [], "errores": 0}
    candidatos = conn.execute(
        """SELECT * FROM emails WHERE status = 'aprobado' AND is_test = 0 AND scheduled_for <= ?
           ORDER BY scheduled_for, id""", (ahora.isoformat(),)).fetchall()

    if cfg.live_mode:
        faltan = cfg.faltan_para_campana()
        if faltan:
            raise Bloqueado("Modo real bloqueado; falta configurar: " + ", ".join(faltan))
        if transporte is None:
            raise Bloqueado("Modo real sin transporte de envío")

    lista_negra = excluidos(conn, cfg.exclusion_file)
    hoy = ahora.date().isoformat()
    enviados_hoy = conn.execute("SELECT COUNT(*) FROM emails WHERE status = 'enviado' AND is_test = 0 "
                                "AND substr(sent_at, 1, 10) = ?", (hoy,)).fetchone()[0]
    salida = Path(cfg.outbox_dir) / "simulacion"
    primero = True

    for e in candidatos:
        motivo = problema_destinatario(e["to_email"] or "")
        if not motivo and e["to_email"].lower() in lista_negra:
            motivo = "excluido (baja)"
        if not motivo:
            lead = conn.execute("SELECT status FROM leads WHERE id = ?", (e["lead_id"],)).fetchone()
            if lead["status"] in ("respondido", "cliente", "descartado", "excluido"):
                motivo = f"lead en estado {lead['status']}"
        if not motivo and conn.execute(
                "SELECT 1 FROM emails WHERE lead_id = ? AND campaign = ? AND step = ? AND status = 'enviado'",
                (e["lead_id"], e["campaign"], e["step"])).fetchone():
            motivo = "duplicado: ya enviado"
        if not motivo:
            fallos = problemas_contenido(e["subject"], e["text"], e["html"])
            if fallos:
                motivo = "contenido: " + "; ".join(fallos)
        if motivo:
            resumen["omitidos"].append((e["id"], motivo))
            db.registrar(conn, "omitido", motivo, lead_id=e["lead_id"], email_id=e["id"])
            continue

        msg = construir(cfg, e["to_email"], e["subject"], e["text"], e["html"])

        if not cfg.live_mode:
            salida.mkdir(parents=True, exist_ok=True)
            (salida / f"email-{e['id']}-{e['step']}.eml").write_bytes(bytes(msg))
            resumen["simulados"] += 1
            db.registrar(conn, "simulado", "no enviado: VT_LIVE_MODE=false", lead_id=e["lead_id"], email_id=e["id"])
            continue

        if enviados_hoy >= cfg.daily_limit:
            resumen["omitidos"].append((e["id"], "tope diario alcanzado"))
            db.registrar(conn, "omitido", "tope diario alcanzado", email_id=e["id"])
            break
        if not primero:
            dormir(cfg.send_interval_seconds)
        primero = False
        try:
            transporte.enviar(msg)
        except Exception as error:  # se registra y se sigue con el siguiente
            resumen["errores"] += 1
            conn.execute("UPDATE emails SET status = 'error', error = ? WHERE id = ?", (str(error)[:300], e["id"]))
            db.registrar(conn, "error", str(error)[:300], lead_id=e["lead_id"], email_id=e["id"])
            continue
        conn.execute("UPDATE emails SET status = 'enviado', sent_at = ?, message_id = ? WHERE id = ?",
                     (db.ahora(), msg["Message-ID"], e["id"]))
        conn.execute("UPDATE leads SET status = 'contactado', updated_at = ? WHERE id = ? AND status = 'nuevo'",
                     (db.ahora(), e["lead_id"]))
        db.registrar(conn, "enviado", e["to_email"], lead_id=e["lead_id"], email_id=e["id"])
        enviados_hoy += 1
        resumen["enviados"] += 1
    conn.commit()
    return resumen


# -------------------------------------------------------------------- prueba --
def preparar_prueba(cfg: Config, lead: dict, destinatario: str) -> dict:
    """Genera la prueba interna con el MISMO motor que la campaña real.

    Solo acepta leads marcados como ficticios y un único destinatario, que
    además debe coincidir con VT_TEST_RECIPIENT.
    """
    if not lead.get("is_fictitious"):
        raise Bloqueado("La prueba solo se hace con un negocio ficticio")
    if not cfg.test_recipient or destinatario.lower() != cfg.test_recipient.lower():
        raise Bloqueado("El destinatario de prueba no coincide con VT_TEST_RECIPIENT")
    nota = (f"Negocio ficticio ({lead['business_name']}), creado para revisar el diseño. "
            "Este correo no se ha enviado a ningún negocio.")
    brief, html, texto = _contenido(cfg, lead, "inicial", nota_prueba=nota)
    fallos = problemas_contenido(brief.subject, texto, html)
    if fallos:
        raise Bloqueado("; ".join(fallos))
    asunto = PREFIJO_PRUEBA + brief.subject
    msg = construir(cfg, destinatario, asunto, texto, html, prueba=True)
    return {"brief": brief, "asunto": asunto, "html": html, "texto": texto, "mensaje": msg}


def checklist_prueba(cfg: Config, msg, destinatario: str) -> list[tuple[str, bool]]:
    tipos = [p.get_content_type() for p in msg.walk()]
    html = next((p.get_content() for p in msg.walk() if p.get_content_type() == "text/html"), "")
    texto = next((p.get_content() for p in msg.walk() if p.get_content_type() == "text/plain"), "")
    return [
        (f"destinatario es exactamente {destinatario}", msg["To"] == destinatario),
        ("no hay ningún otro destinatario", msg.get_all("To") == [destinatario]),
        ("sin CC", msg["Cc"] is None),
        ("sin BCC", msg["Bcc"] is None),
        ("VT_LIVE_MODE sigue en false", cfg.live_mode is False),
        ("marcado como prueba interna", msg["X-VT-Test"] == "prueba-interna"
         and msg["Subject"].startswith(PREFIJO_PRUEBA)),
        ("multipart/alternative con text/plain y text/html",
         tipos[0] == "multipart/alternative" and "text/plain" in tipos and "text/html" in tipos),
        ("logo inline (image/png, cid:vt-logo)", "image/png" in tipos and 'src="cid:vt-logo"' in html),
        ("firma de Vanguard Tech en HTML y texto", cfg.brand_name in html and cfg.brand_name in texto),
        ("sin credenciales en el mensaje", not cfg.smtp_password or cfg.smtp_password not in bytes(msg).decode(
            "utf-8", "replace")),
    ]
