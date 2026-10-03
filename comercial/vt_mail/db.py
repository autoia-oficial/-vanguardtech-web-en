"""Base de datos del CRM comercial (SQLite).

Reglas:
  * El esquema solo se crea o se amplia (CREATE ... IF NOT EXISTS). Nunca se
    borran tablas ni columnas.
  * Los leads no se borran: se importan con UPSERT y, como mucho, se marcan
    como excluidos. Un dato que ya existe no se pisa con un valor vacio.
  * Cada dato usado para personalizar guarda su fuente (lead_facts), para
    poder justificar cualquier frase de un correo.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ESQUEMA = """
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY,
  external_id     TEXT UNIQUE NOT NULL,
  business_name   TEXT NOT NULL,
  sector          TEXT,
  city            TEXT,
  zone            TEXT,
  country         TEXT DEFAULT 'ES',
  language        TEXT DEFAULT 'es',
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  website_status  TEXT DEFAULT 'unknown',   -- none | old | issues | modern | unknown
  website_issues  TEXT,                     -- JSON: problemas comprobados
  google_business INTEGER,                  -- 1 si tiene ficha comprobada
  rating          REAL,
  reviews_count   INTEGER,
  services        TEXT,                     -- JSON: lista
  socials         TEXT,                     -- JSON: {"instagram": "url", ...}
  source          TEXT,                     -- de donde salen los datos de contacto
  is_fictitious   INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'nuevo',     -- nuevo | contactado | respondido | cliente | descartado | excluido
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_facts (
  id          INTEGER PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  source      TEXT NOT NULL,
  source_url  TEXT,
  verified_at TEXT,
  UNIQUE(lead_id, key)
);

CREATE TABLE IF NOT EXISTS emails (
  id                 INTEGER PRIMARY KEY,
  lead_id            INTEGER NOT NULL REFERENCES leads(id),
  campaign           TEXT NOT NULL,
  segment            TEXT NOT NULL,
  step               TEXT NOT NULL,          -- inicial | seguimiento_1 | seguimiento_2 | cierre
  contact_reason     TEXT NOT NULL,
  personalization    TEXT NOT NULL,          -- JSON: datos usados y su fuente
  to_email           TEXT,
  subject            TEXT NOT NULL,
  template_version   TEXT NOT NULL,
  html               TEXT NOT NULL,
  text               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'borrador',
                     -- borrador | aprobado | simulado | enviado | error | cancelado
  prepared_at        TEXT NOT NULL,
  scheduled_for      TEXT,
  approved_by        TEXT,
  approved_at        TEXT,
  sent_at            TEXT,
  message_id         TEXT,
  error              TEXT,
  reply_status       TEXT,                   -- respondido | baja | rebote
  replied_at         TEXT,
  is_test            INTEGER DEFAULT 0,
  notes              TEXT,
  UNIQUE(lead_id, campaign, step)
);

CREATE TABLE IF NOT EXISTS exclusions (
  email      TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  lead_id    INTEGER,
  email_id   INTEGER,
  type       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
"""

CAMPOS_LEAD = [
    "business_name", "sector", "city", "zone", "country", "language", "email", "phone",
    "website", "website_status", "website_issues", "google_business", "rating",
    "reviews_count", "services", "socials", "source", "is_fictitious", "notes",
]


def ahora() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def conectar(ruta: str | Path) -> sqlite3.Connection:
    if str(ruta) != ":memory:":
        Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(ruta))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(ESQUEMA)
    return conn


def _serializar(valor):
    if isinstance(valor, (list, dict)):
        return json.dumps(valor, ensure_ascii=False)
    if isinstance(valor, bool):
        return int(valor)
    return valor


def upsert_lead(conn: sqlite3.Connection, datos: dict) -> int:
    """Crea o completa un lead. Nunca borra ni vacia un campo que ya tenia valor."""
    if not datos.get("external_id") or not datos.get("business_name"):
        raise ValueError("Un lead necesita external_id y business_name")
    if datos.get("email"):
        datos = {**datos, "email": datos["email"].strip().lower()}
    fila = conn.execute("SELECT id FROM leads WHERE external_id = ?", (datos["external_id"],)).fetchone()
    valores = {k: _serializar(datos[k]) for k in CAMPOS_LEAD if datos.get(k) not in (None, "", [], {})}
    marca = ahora()
    if fila:
        if valores:
            asignaciones = ", ".join(f"{k} = ?" for k in valores)
            conn.execute(f"UPDATE leads SET {asignaciones}, updated_at = ? WHERE id = ?",
                         [*valores.values(), marca, fila["id"]])
        lead_id = fila["id"]
    else:
        cols = ["external_id", *valores, "created_at", "updated_at"]
        conn.execute(f"INSERT INTO leads ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                     [datos["external_id"], *valores.values(), marca, marca])
        lead_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    for hecho in datos.get("facts", []):
        conn.execute(
            """INSERT INTO lead_facts (lead_id, key, value, source, source_url, verified_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(lead_id, key) DO UPDATE SET value = excluded.value, source = excluded.source,
                 source_url = excluded.source_url, verified_at = excluded.verified_at""",
            (lead_id, hecho["key"], str(hecho["value"]), hecho["source"], hecho.get("source_url"),
             hecho.get("verified_at")),
        )
    conn.commit()
    return lead_id


def cargar_lead(conn: sqlite3.Connection, lead_id: int) -> dict:
    fila = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
    if not fila:
        raise KeyError(f"No existe el lead {lead_id}")
    lead = dict(fila)
    for campo in ("services", "socials", "website_issues"):
        lead[campo] = json.loads(lead[campo]) if lead[campo] else ([] if campo != "socials" else {})
    lead["facts"] = {
        f["key"]: dict(f) for f in conn.execute("SELECT * FROM lead_facts WHERE lead_id = ?", (lead_id,))
    }
    return lead


def registrar(conn: sqlite3.Connection, tipo: str, detalle: str = "", lead_id=None, email_id=None) -> None:
    conn.execute("INSERT INTO events (lead_id, email_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                 (lead_id, email_id, tipo, detalle, ahora()))
    conn.commit()
