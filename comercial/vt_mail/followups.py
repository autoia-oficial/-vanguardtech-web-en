"""Secuencia de seguimiento: inicial -> seguimiento_1 -> seguimiento_2 -> cierre.

Cada paso aporta algo nuevo (un ejemplo concreto, como se trabaja, un cierre
cortes) en vez de preguntar si se leyo el anterior. Los pasos posteriores al
inicial se preparan como SIMULADOS con fecha prevista: no se envian solos.
Para que uno salga hace falta aprobarlo a mano y que el modo real este
activo. Si el lead responde o pide la baja, la secuencia se cancela.
"""
from __future__ import annotations

from dataclasses import replace

from .config import Config
from .personalize import Brief

PASOS = [
    ("inicial", 0),
    ("seguimiento_1", 4),
    ("seguimiento_2", 10),
    ("cierre", 18),
]

# Demos de sector publicadas en la propia web de Vanguard Tech (carpeta /work/).
# Son negocios inventados y la pagina lo dice; aqui se presentan como ejemplo.
DEMOS = {
    "restaurante": "work/restaurant/",
    "clinica_dental": "work/dental-clinic/",
    "gimnasio": "work/gym/",
    "peluqueria": "work/barber/",
    "inmobiliaria": "work/real-estate/",
}


def brief_para_paso(brief: Brief, paso: str, cfg: Config, sector_clave: str = "") -> Brief:
    if paso == "inicial":
        return brief
    nombre = brief.business_name
    s = brief.sector
    if paso == "seguimiento_1":
        demo = ""
        if cfg.website_url and sector_clave in DEMOS:
            demo = (f" Si quiere hacerse una idea del estilo, tiene un ejemplo de {s['singular']} "
                    f"(un negocio ficticio que usamos como muestra) en {cfg.website_url.rstrip('/')}/{DEMOS[sector_clave]}")
        return replace(
            brief,
            subject=f"Cómo sería la web de {nombre}",
            preheader="Un esquema concreto, para que no quede en una idea abstracta.",
            observation=f"Hace unos días le escribí sobre una web propia para {nombre}. "
                        "Para que no quede en una idea abstracta, le cuento cómo la plantearíamos.",
            opportunity=f"Una sola página, rápida en el móvil, con {s['incluye']}. "
                        "Todo con la información que usted ya publica, revisada con usted antes de salir.",
            proposal="Nada de plantillas genéricas: el diseño parte de la identidad del negocio." + demo,
            cta="Si le encaja, responda a este correo y le preparo la propuesta visual.",
        )
    if paso == "seguimiento_2":
        return replace(
            brief,
            subject=f"Lo que implica la web de {nombre}",
            preheader="Cómo trabajamos y qué necesitaríamos de usted.",
            observation="Una duda habitual es cuánto tiempo exige tener una web propia.",
            opportunity="Por nuestra parte nos encargamos del diseño, de redactar los textos a partir de lo que ya "
                        "publica y de ponerla en marcha. Por la suya, revisar y dar el visto bueno.",
            proposal=f"Si prefiere verlo antes de decidir nada, le enviamos primero la propuesta visual para {nombre}.",
            cta="Basta con responder a este correo.",
        )
    if paso == "cierre":
        return replace(
            brief,
            subject=f"Cierro el tema de la web de {nombre}",
            preheader="Último correo sobre esto.",
            observation=f"No quiero insistir, así que este será mi último correo sobre la web de {nombre}.",
            opportunity="Entiendo que puede no ser el momento.",
            proposal="Si más adelante quiere retomarlo, la propuesta sigue en pie.",
            cta="Solo tiene que responder a este correo cuando le venga bien.",
        )
    raise ValueError(f"Paso desconocido: {paso}")
