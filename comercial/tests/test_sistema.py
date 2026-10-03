"""Tests del sistema comercial. Ninguno abre conexiones de red ni envía nada.

    cd comercial && python3 -m unittest discover -s tests -v
"""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from vt_mail import db  # noqa: E402
from vt_mail.config import Config  # noqa: E402
from vt_mail.dispatcher import (Bloqueado, aprobar, checklist_prueba, despachar, preparar,  # noqa: E402
                                preparar_prueba, registrar_respuesta)
from vt_mail.guardrails import problema_destinatario, problemas_contenido  # noqa: E402
from vt_mail.mime import construir  # noqa: E402
from vt_mail.personalize import construir_brief, segmentar  # noqa: E402
from vt_mail.templates import render_html, render_text  # noqa: E402

FICTICIO = RAIZ / "datos" / "ejemplo" / "restaurante_ficticio.json"


def hecho(k, v):
    return {"key": k, "value": v, "source": "test"}


def lead_base(**extra):
    d = {"external_id": "t-1", "business_name": "Peluquería Prueba", "sector": "peluqueria", "city": "Bilbao",
         "email": "hola@peluqueria-prueba.test", "website_status": "none", "source": "directorio público (test)",
         "facts": [hecho("sin_web", "true"), hecho("zona", "Indautxu")]}
    d.update(extra)
    return d


class TransporteFalso:
    def __init__(self, fallar=False):
        self.enviados, self.fallar = [], fallar

    def enviar(self, msg):
        if self.fallar:
            raise RuntimeError("SMTP caído")
        self.enviados.append(msg)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.cfg = Config.cargar(entorno={
            "VT_DB_PATH": str(t / "t.db"), "VT_EXCLUSION_FILE": str(t / "bajas.txt"),
            "VT_OUTBOX_DIR": str(t / "salida"), "VT_CONTACT_EMAIL": "contacto@vt.test",
            "VT_WEBSITE_URL": "https://vt.test", "VT_SENDER_NAME": "Ander",
        }, fichero=None)
        self.conn = db.conectar(self.cfg.db_path)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def cfg_real(self):
        return Config.cargar(entorno={
            **{f"VT_{k.upper()}": str(v) for k, v in vars(self.cfg).items() if not isinstance(v, bool)},
            "VT_LIVE_MODE": "true", "VT_SMTP_HOST": "smtp.test", "VT_SMTP_USER": "u",
            "VT_SMTP_PASSWORD": "secreto-de-test", "VT_FROM_EMAIL": "ander@vt.test",
            "VT_LEGAL_NAME": "VT SL", "VT_LEGAL_NIF": "B00000000", "VT_LEGAL_ADDRESS": "Calle Test 1",
            "VT_LEGAL_EMAIL": "legal@vt.test", "VT_DAILY_LIMIT": "2", "VT_SEND_INTERVAL_SECONDS": "45",
        }, fichero=None)


class TestConfig(Base):
    def test_simulacion_por_defecto(self):
        self.assertFalse(Config.cargar(entorno={}, fichero=None).live_mode)

    def test_describir_no_muestra_secretos(self):
        cfg = Config.cargar(entorno={"VT_SMTP_PASSWORD": "super-secreta", "VT_SMTP_USER": "yo@x.es"}, fichero=None)
        salida = "\n".join(cfg.describir())
        self.assertNotIn("super-secreta", salida)
        self.assertNotIn("yo@x.es", salida)
        self.assertIn("configurada (oculta)", salida)

    def test_campana_bloqueada_sin_datos_legales(self):
        self.assertIn("VT_LEGAL_NIF", self.cfg.faltan_para_campana())


class TestPersonalizacion(Base):
    def test_segmentos(self):
        self.assertEqual(segmentar({"facts": {"sin_web": {}}}), "sin_web")
        self.assertEqual(segmentar({"website_status": "old", "facts": {}}), "web_antigua")
        self.assertEqual(segmentar({"website_status": "issues", "facts": {}}), "web_problemas")
        self.assertEqual(segmentar({"website_status": "modern", "facts": {}}), "otras")

    def test_no_inventa_datos_ausentes(self):
        lead = db.cargar_lead(self.conn, db.upsert_lead(self.conn, lead_base()))
        b = construir_brief(lead)
        todo = " ".join([b.observation, b.opportunity, b.proposal, b.cta])
        for palabra in ("reseña", "valoración", "Instagram", "Google"):
            self.assertNotIn(palabra, todo)
        self.assertIn("Indautxu", todo)

    def test_cada_dato_usado_tiene_fuente(self):
        lead = json.loads(FICTICIO.read_text(encoding="utf-8"))
        lead["facts"] = {h["key"]: h for h in lead["facts"]}
        b = construir_brief(lead)
        self.assertTrue(b.facts_used)
        self.assertTrue(all(u["source"] for u in b.facts_used))
        self.assertIn("312 reseñas", b.observation)
        self.assertIn("4,6", b.observation)


class TestPlantilla(Base):
    def setUp(self):
        super().setUp()
        self.lead = db.cargar_lead(self.conn, db.upsert_lead(self.conn, lead_base()))
        self.brief = construir_brief(self.lead)
        self.html = render_html(self.cfg, self.brief)
        self.texto = render_text(self.cfg, self.brief)

    def test_componentes(self):
        for trozo in ('src="cid:vt-logo"', "Vanguard Tech", "Ander", "contacto@vt.test", "BAJA",
                      "Política de privacidad", "Quiero ver la propuesta", "@media only screen", "<!--[if mso]>"):
            self.assertIn(trozo, self.html)
        self.assertNotIn("<script", self.html.lower())
        self.assertLess(len(self.html.encode()), 40_000)
        self.assertEqual(problemas_contenido(self.brief.subject, self.texto, self.html), [])

    def test_texto_equivalente(self):
        for trozo in ("Vanguard Tech", "Ander", "contacto@vt.test", "https://vt.test", "BAJA",
                      "Comunicación comercial", self.brief.observation):
            self.assertIn(trozo, self.texto)

    def test_escapa_datos_del_lead(self):
        lead = db.cargar_lead(self.conn, db.upsert_lead(self.conn, lead_base(
            external_id="t-x", business_name='<b onmouseover="x">Malo</b>')))
        html = render_html(self.cfg, construir_brief(lead))
        self.assertNotIn('<b onmouseover', html)
        self.assertIn("&lt;b onmouseover", html)

    def test_no_inventa_contacto(self):
        cfg = Config.cargar(entorno={}, fichero=None)
        html = render_html(cfg, self.brief)
        self.assertNotIn("mailto:", html)   # sin correo configurado no hay botón ni enlace
        self.assertNotIn("tel:", html)

    def test_detecta_spam(self):
        fallos = problemas_contenido("OFERTA GRATIS!!", "Solo hoy, garantizado. BAJA Comunicación comercial",
                                     'BAJA <img src="cid:vt-logo" alt="x">')
        self.assertTrue(any("gratis" in f for f in fallos))
        self.assertTrue(any("exclamación" in f for f in fallos))
        self.assertTrue(any("mayúsculas" in f for f in fallos))


class TestMime(Base):
    def test_estructura(self):
        lead = db.cargar_lead(self.conn, db.upsert_lead(self.conn, lead_base()))
        b = construir_brief(lead)
        msg = construir(self.cfg, "a@b.es", b.subject, render_text(self.cfg, b), render_html(self.cfg, b))
        tipos = [p.get_content_type() for p in msg.walk()]
        self.assertEqual(tipos, ["multipart/alternative", "text/plain", "multipart/related", "text/html",
                                 "image/png"])
        logo = [p for p in msg.walk() if p.get_content_type() == "image/png"][0]
        self.assertEqual(logo["Content-ID"], "<vt-logo>")
        self.assertIsNone(msg["Cc"])
        self.assertIsNone(msg["Bcc"])
        self.assertIn("BAJA", msg["List-Unsubscribe"])
        self.assertLess(len(bytes(msg)), 60_000)

    def test_rechaza_varios_destinatarios(self):
        for malo in ("a@b.es, c@d.es", "a@b.es;c@d.es", "no-es-correo", ""):
            self.assertIsNotNone(problema_destinatario(malo))
            with self.assertRaises(ValueError):
                construir(self.cfg, malo, "x", "BAJA", "BAJA")


class TestLogoURL(Base):
    def test_logo_por_url(self):
        cfg = Config.cargar(entorno={"VT_LOGO_URL": "https://ejemplo.test/logo.png",
                                     "VT_CONTACT_EMAIL": "c@vt.test"}, fichero=None)
        lead = db.cargar_lead(self.conn, db.upsert_lead(self.conn, lead_base()))
        b = construir_brief(lead)
        html, texto = render_html(cfg, b), render_text(cfg, b)
        self.assertIn('src="https://ejemplo.test/logo.png"', html)
        self.assertNotIn("cid:", html)
        self.assertEqual(problemas_contenido(b.subject, texto, html), [])
        msg = construir(cfg, "a@b.es", b.subject, texto, html)
        self.assertEqual([p.get_content_type() for p in msg.walk()],
                         ["multipart/alternative", "text/plain", "text/html"])


class TestCRMyDispatcher(Base):
    def preparar_lead(self, **extra):
        lead_id = db.upsert_lead(self.conn, lead_base(**extra))
        return lead_id, preparar(self.conn, self.cfg, lead_id, "sin_web",
                                 inicio=datetime.now(timezone.utc) - timedelta(days=1))

    def test_prepara_secuencia_completa_asociada_al_lead(self):
        lead_id, ids = self.preparar_lead()
        filas = self.conn.execute("SELECT * FROM emails WHERE lead_id = ? ORDER BY id", (lead_id,)).fetchall()
        self.assertEqual([f["step"] for f in filas], ["inicial", "seguimiento_1", "seguimiento_2", "cierre"])
        self.assertEqual([f["status"] for f in filas], ["borrador", "simulado", "simulado", "simulado"])
        for f in filas:
            self.assertEqual(f["segment"], "sin_web")
            self.assertTrue(f["html"] and f["text"] and f["subject"] and f["contact_reason"])
            self.assertEqual(f["template_version"], "vt-email-v1.0")
            self.assertTrue(json.loads(f["personalization"])["facts"])
        self.assertNotEqual(filas[1]["subject"], filas[0]["subject"])
        self.assertNotIn("has visto", filas[1]["text"].lower())

    def test_simulacion_no_llama_al_transporte(self):
        _, ids = self.preparar_lead()
        aprobar(self.conn, ids[0], "test")
        t = TransporteFalso()
        r = despachar(self.conn, self.cfg, t)
        self.assertEqual(r["modo"], "simulacion")
        self.assertEqual(r["simulados"], 1)
        self.assertEqual(t.enviados, [])
        self.assertTrue(list((Path(self.cfg.outbox_dir) / "simulacion").glob("*.eml")))
        estado = self.conn.execute("SELECT status FROM emails WHERE id = ?", (ids[0],)).fetchone()[0]
        self.assertEqual(estado, "aprobado")

    def test_sin_aprobar_no_sale_nada(self):
        self.preparar_lead()
        r = despachar(self.conn, self.cfg_real(), TransporteFalso(), dormir=lambda s: None)
        self.assertEqual((r["enviados"], r["simulados"]), (0, 0))

    def test_real_bloqueado_si_falta_configuracion(self):
        cfg = Config.cargar(entorno={"VT_LIVE_MODE": "true", "VT_DB_PATH": self.cfg.db_path}, fichero=None)
        with self.assertRaises(Bloqueado):
            despachar(self.conn, cfg, TransporteFalso())

    def test_real_respeta_bajas_tope_e_intervalo(self):
        cfg = self.cfg_real()
        aprobados = []
        for i in range(4):
            _, ids = self.preparar_lead(external_id=f"t-{i}", email=f"n{i}@negocio.test")
            aprobar(self.conn, ids[0], "test")
            aprobados.append(ids[0])
        Path(cfg.exclusion_file).write_text("# bajas\nn0@negocio.test\n", encoding="utf-8")
        esperas, t = [], TransporteFalso()
        r = despachar(self.conn, cfg, t, dormir=esperas.append)
        self.assertEqual(r["enviados"], 2)                    # tope diario = 2
        self.assertEqual(esperas, [45])                       # intervalo entre envíos
        self.assertIn((aprobados[0], "excluido (baja)"), r["omitidos"])
        self.assertTrue(all(m["To"] != "n0@negocio.test" for m in t.enviados))
        r2 = despachar(self.conn, cfg, t, dormir=esperas.append)
        self.assertEqual(r2["enviados"], 0)                   # el tope sigue aplicándose hoy

    def test_deduplica_mismo_correo(self):
        self.preparar_lead(external_id="a", email="mismo@negocio.test")
        _, ids = self.preparar_lead(external_id="b", email="mismo@negocio.test")
        self.assertEqual(ids, [])

    def test_baja_cancela_secuencia_y_excluye(self):
        lead_id, ids = self.preparar_lead()
        registrar_respuesta(self.conn, self.cfg, ids[0], "baja", "respondió BAJA")
        estados = {f["status"] for f in self.conn.execute("SELECT status FROM emails WHERE lead_id = ?", (lead_id,))}
        self.assertEqual(estados, {"cancelado"})
        self.assertTrue(self.conn.execute("SELECT 1 FROM exclusions WHERE email = ?",
                                          ("hola@peluqueria-prueba.test",)).fetchone())
        self.assertEqual(preparar(self.conn, self.cfg, lead_id, "otras"), [])

    def test_error_de_envio_se_registra(self):
        _, ids = self.preparar_lead()
        aprobar(self.conn, ids[0], "test")
        r = despachar(self.conn, self.cfg_real(), TransporteFalso(fallar=True), dormir=lambda s: None)
        self.assertEqual(r["errores"], 1)
        self.assertEqual(self.conn.execute("SELECT status FROM emails WHERE id = ?", (ids[0],)).fetchone()[0], "error")

    def test_importar_no_borra_ni_vacia(self):
        lead_id = db.upsert_lead(self.conn, lead_base(phone="600000000"))
        db.upsert_lead(self.conn, {"external_id": "t-1", "business_name": "Peluquería Prueba", "phone": ""})
        self.assertEqual(db.cargar_lead(self.conn, lead_id)["phone"], "600000000")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 1)


class TestPrueba(Base):
    def lead(self):
        d = json.loads(FICTICIO.read_text(encoding="utf-8"))
        d["facts"] = {h["key"]: h for h in d["facts"]}
        return d

    def cfg_prueba(self, **extra):
        return Config.cargar(entorno={"VT_TEST_RECIPIENT": "andermartinez.tm@gmail.com",
                                      "VT_CONTACT_EMAIL": "contacto@vt.test", **extra}, fichero=None)

    def test_checklist_completo(self):
        cfg = self.cfg_prueba()
        p = preparar_prueba(cfg, self.lead(), "andermartinez.tm@gmail.com")
        self.assertTrue(all(ok for _, ok in checklist_prueba(cfg, p["mensaje"], "andermartinez.tm@gmail.com")))
        self.assertTrue(p["asunto"].startswith("[PRUEBA INTERNA]"))
        self.assertIn("ficticio", p["html"])

    def test_solo_el_destinatario_autorizado(self):
        with self.assertRaises(Bloqueado):
            preparar_prueba(self.cfg_prueba(), self.lead(), "otro@correo.es")

    def test_nunca_con_un_lead_real(self):
        lead = self.lead()
        lead["is_fictitious"] = 0
        with self.assertRaises(Bloqueado):
            preparar_prueba(self.cfg_prueba(), lead, "andermartinez.tm@gmail.com")

    def test_mismo_motor_que_la_campana(self):
        cfg = self.cfg_prueba()
        p = preparar_prueba(cfg, self.lead(), "andermartinez.tm@gmail.com")
        real = render_html(cfg, construir_brief(self.lead()))
        # Lo único que cambia es la franja de prueba
        self.assertEqual(p["html"].replace(p["html"][p["html"].index("<tr><td bgcolor=\"#fff7d6\""):
                                                      p["html"].index("</td></tr>") + 10], ""), real)


if __name__ == "__main__":
    unittest.main()
