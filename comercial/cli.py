#!/usr/bin/env python3
"""Sistema comercial de Vanguard Tech — linea de comandos.

    python3 cli.py estado                      configuración (sin mostrar valores)
    python3 cli.py importar leads.json         añade o completa leads (nunca borra)
    python3 cli.py segmentos                   cuántos leads hay en cada campaña
    python3 cli.py preparar --campana sin_web  prepara correos (borrador + seguimientos simulados)
    python3 cli.py revisar                     página local para leer cada correo antes de aprobarlo
    python3 cli.py aprobar ID --por "Ander"    visto bueno humano, correo a correo
    python3 cli.py respuesta ID respondido|baja|rebote
    python3 cli.py excluir correo@dominio.es
    python3 cli.py despachar                   con VT_LIVE_MODE=false solo simula
    python3 cli.py prueba --lead datos/ejemplo/restaurante_ficticio.json --para TU@CORREO

Nada sale de verdad si VT_LIVE_MODE no es true y la configuración no está completa.
"""
from __future__ import annotations

import argparse
import json
import sys
from html import escape
from pathlib import Path

from vt_mail import db
from vt_mail.config import Config
from vt_mail.dispatcher import (Bloqueado, aprobar, checklist_prueba, despachar, preparar, preparar_prueba,
                                registrar_respuesta)
from vt_mail.mime import TransporteSMTP
from vt_mail.personalize import CAMPANAS, segmentar


def _lead_de_fichero(ruta: str) -> dict:
    """Convierte un lead en JSON al mismo formato que devuelve db.cargar_lead."""
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    datos["facts"] = {h["key"]: {**h, "value": str(h["value"])} for h in datos.get("facts", [])}
    return datos


def cmd_estado(cfg, _):
    print("\n".join(cfg.describir()))
    faltan = cfg.faltan_para_campana()
    print("\nCampañas reales:", "BLOQUEADAS — falta " + ", ".join(faltan) if faltan else "configuración completa")
    print("Modo:", "REAL" if cfg.live_mode else "SIMULACIÓN (no se envía nada)")


def cmd_importar(cfg, a):
    conn = db.conectar(cfg.db_path)
    leads = json.loads(Path(a.fichero).read_text(encoding="utf-8"))
    for lead in leads if isinstance(leads, list) else [leads]:
        db.upsert_lead(conn, lead)
    print(f"{len(leads) if isinstance(leads, list) else 1} leads importados o completados (ninguno borrado).")


def cmd_segmentos(cfg, _):
    conn = db.conectar(cfg.db_path)
    cuenta = {c: 0 for c in CAMPANAS}
    for fila in conn.execute("SELECT id FROM leads WHERE is_fictitious = 0"):
        cuenta[segmentar(db.cargar_lead(conn, fila["id"]))] += 1
    for c in CAMPANAS:
        print(f"{c:15} {cuenta[c]}")


def cmd_preparar(cfg, a):
    conn = db.conectar(cfg.db_path)
    hechos = 0
    for fila in conn.execute("SELECT id FROM leads WHERE is_fictitious = 0 AND status = 'nuevo' ORDER BY id"):
        lead = db.cargar_lead(conn, fila["id"])
        if segmentar(lead) != a.campana:
            continue
        if preparar(conn, cfg, fila["id"], a.campana):
            hechos += 1
        if a.limite and hechos >= a.limite:
            break
    print(f"{hechos} leads preparados en '{a.campana}'. Nada se ha enviado. Revísalos con: python3 cli.py revisar")


def cmd_revisar(cfg, a):
    conn = db.conectar(cfg.db_path)
    destino = Path(cfg.outbox_dir) / "revision"
    destino.mkdir(parents=True, exist_ok=True)
    logo = Path(cfg.logo_path).resolve().as_uri()
    filas = []
    for e in conn.execute("""SELECT e.*, l.business_name FROM emails e JOIN leads l ON l.id = e.lead_id
                             WHERE e.status IN ('borrador', 'simulado', 'aprobado') ORDER BY e.lead_id, e.id"""):
        (destino / f"{e['id']}.html").write_text(e["html"].replace("cid:vt-logo", logo), encoding="utf-8")
        datos = json.loads(e["personalization"])
        fuentes = "".join(f"<li>{escape(h['key'])}: {escape(h['value'])} <small>({escape(h['source'])})</small></li>"
                          for h in datos["facts"])
        filas.append(f"""<section><h2>#{e['id']} · {escape(e['business_name'])} · {escape(e['step'])}
          <small>{escape(e['status'])} · {escape(e['scheduled_for'] or '')}</small></h2>
          <p><b>Para:</b> {escape(e['to_email'] or 'SIN CORREO')} · <b>Asunto:</b> {escape(e['subject'])}</p>
          <p><b>Motivo:</b> {escape(e['contact_reason'])}</p><ul>{fuentes}</ul>
          <iframe src="{e['id']}.html" loading="lazy"></iframe><pre>{escape(e['text'])}</pre></section>""")
    (destino / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Revisión de correos</title><style>body{font:15px system-ui;"
        "max-width:1100px;margin:24px auto;padding:0 16px}section{border-top:1px solid #ddd;padding:16px 0}"
        "iframe{width:100%;height:760px;border:1px solid #ddd}pre{white-space:pre-wrap;background:#f6f6f6;"
        "padding:12px}</style><h1>Correos pendientes de revisión</h1>" + "".join(filas), encoding="utf-8")
    print(f"{len(filas)} correos. Abre {destino / 'index.html'}")


def cmd_aprobar(cfg, a):
    aprobar(db.conectar(cfg.db_path), a.id, a.por)
    print(f"Correo {a.id} aprobado por {a.por}.")


def cmd_respuesta(cfg, a):
    registrar_respuesta(db.conectar(cfg.db_path), cfg, a.id, a.tipo, a.nota or "")
    print(f"Registrado '{a.tipo}' en el correo {a.id}; el resto de la secuencia queda cancelada.")


def cmd_excluir(cfg, a):
    conn = db.conectar(cfg.db_path)
    conn.execute("INSERT OR IGNORE INTO exclusions (email, reason, created_at) VALUES (?, ?, ?)",
                 (a.correo.lower(), "manual", db.ahora()))
    conn.commit()
    print(f"{a.correo} excluido de forma permanente.")


def cmd_despachar(cfg, a):
    conn = db.conectar(cfg.db_path)
    transporte = None
    if cfg.live_mode:
        if not a.confirmar:
            raise Bloqueado("Modo real: añade --confirmar si de verdad quieres enviar")
        transporte = TransporteSMTP(cfg)
    r = despachar(conn, cfg, transporte)
    print(json.dumps(r, ensure_ascii=False, indent=2))


def cmd_prueba(cfg, a):
    lead = _lead_de_fichero(a.lead)
    p = preparar_prueba(cfg, lead, a.para)
    destino = Path(cfg.outbox_dir) / "prueba"
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "prueba.eml").write_bytes(bytes(p["mensaje"]))
    (destino / "prueba.html").write_text(p["html"], encoding="utf-8")
    (destino / "prueba.txt").write_text(p["texto"], encoding="utf-8")
    (destino / "prueba.json").write_text(json.dumps(
        {"asunto": p["asunto"], "para": a.para, "segmento": p["brief"].segment,
         "datos_usados": p["brief"].facts_used}, ensure_ascii=False, indent=2), encoding="utf-8")
    controles = checklist_prueba(cfg, p["mensaje"], a.para)
    for nombre, ok in controles:
        print(("  OK  " if ok else "  FALLA ") + nombre)
    print(f"\nAsunto: {p['asunto']}\nGuardado en {destino}/")
    if not all(ok for _, ok in controles):
        raise Bloqueado("La prueba no pasa los controles: no se envía")
    if a.enviar:
        if not a.confirmar:
            raise Bloqueado("Añade --confirmar para mandar esta única prueba")
        faltan = cfg.faltan_para_enviar()
        if faltan:
            raise Bloqueado("Falta configurar: " + ", ".join(faltan))
        TransporteSMTP(cfg).enviar(p["mensaje"])
        print(f"Prueba enviada a {a.para} (un único correo).")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="orden", required=True)
    sub.add_parser("estado")
    s = sub.add_parser("importar"); s.add_argument("fichero")
    sub.add_parser("segmentos")
    s = sub.add_parser("preparar"); s.add_argument("--campana", choices=CAMPANAS, default="sin_web")
    s.add_argument("--limite", type=int, default=0)
    sub.add_parser("revisar")
    s = sub.add_parser("aprobar"); s.add_argument("id", type=int); s.add_argument("--por", required=True)
    s = sub.add_parser("respuesta"); s.add_argument("id", type=int)
    s.add_argument("tipo", choices=["respondido", "baja", "rebote"]); s.add_argument("--nota")
    s = sub.add_parser("excluir"); s.add_argument("correo")
    s = sub.add_parser("despachar"); s.add_argument("--confirmar", action="store_true")
    s = sub.add_parser("prueba"); s.add_argument("--lead", required=True); s.add_argument("--para", required=True)
    s.add_argument("--enviar", action="store_true"); s.add_argument("--confirmar", action="store_true")
    a = ap.parse_args(argv)
    cfg = Config.cargar()
    try:
        globals()["cmd_" + a.orden](cfg, a)
    except Bloqueado as e:
        print(f"BLOQUEADO: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
