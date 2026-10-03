"""Segmentacion y personalizacion.

LEAD -> INVESTIGACION -> OPORTUNIDAD -> PROPUESTA

Regla de oro: cada frase personalizada sale de un dato de `lead_facts`, que
lleva su fuente. Si un dato no esta, la frase no se escribe: no hay valores
por defecto que suenen a dato real. Lo que no esta respaldado por un hecho
del lead son afirmaciones generales sobre el sector, redactadas como tales.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Orden de campanas acordado.
CAMPANAS = ["sin_web", "web_antigua", "web_problemas", "otras"]

MOTIVOS = {
    "sin_web": "El negocio no tiene pagina web propia (comprobado).",
    "web_antigua": "La web del negocio esta desactualizada (comprobado).",
    "web_problemas": "La web del negocio tiene problemas tecnicos o de calidad (comprobado).",
    "otras": "Otra oportunidad digital detectada.",
}


def segmentar(lead: dict) -> str:
    hechos = lead.get("facts", {})
    if "sin_web" in hechos or lead.get("website_status") == "none":
        return "sin_web"
    if "web_antigua" in hechos or lead.get("website_status") == "old":
        return "web_antigua"
    if "web_problema" in hechos or lead.get("website_status") == "issues":
        return "web_problemas"
    return "otras"


# Lo que suele buscar un cliente antes de decidir, por sector. Son
# generalidades del sector, no afirmaciones sobre el negocio concreto.
SECTORES = {
    "restaurante": {
        "plural": "restaurantes",
        "singular": "un restaurante",
        "busca": "la carta, el horario y cómo reservar",
        "incluye": "su carta, horarios, ubicación y un botón para reservar o llamar",
    },
    "peluqueria": {
        "plural": "peluquerías",
        "singular": "una peluquería",
        "busca": "los servicios, los precios orientativos y cómo pedir cita",
        "incluye": "sus servicios, horarios, ubicación y un botón para pedir cita",
    },
    "clinica_dental": {
        "plural": "clínicas dentales",
        "singular": "una clínica dental",
        "busca": "los tratamientos, el equipo y cómo pedir cita",
        "incluye": "sus tratamientos, el equipo, horarios y un botón para pedir cita",
    },
    "gimnasio": {
        "plural": "gimnasios",
        "singular": "un gimnasio",
        "busca": "las clases, los horarios y las tarifas",
        "incluye": "sus clases, horarios, instalaciones y un acceso directo para apuntarse",
    },
    "inmobiliaria": {
        "plural": "inmobiliarias",
        "singular": "una inmobiliaria",
        "busca": "los inmuebles disponibles y cómo contactar",
        "incluye": "sus inmuebles, zonas de trabajo y un contacto directo",
    },
}
SECTOR_GENERICO = {
    "plural": "negocios",
        "singular": "un negocio",
    "busca": "qué ofrece, el horario y cómo contactar",
    "incluye": "sus servicios, horarios, ubicación y un contacto directo",
}


@dataclass
class Brief:
    """Todo lo que necesita la plantilla, y de donde sale cada cosa."""
    segment: str
    contact_reason: str
    business_name: str
    greeting: str
    observation: str
    opportunity: str
    proposal: str
    cta: str
    subject: str
    preheader: str
    sector: dict
    facts_used: list = field(default_factory=list)
    data_source: str = ""


def _num_es(valor: str) -> str:
    """4.6 -> 4,6 ; 1200 -> 1.200 (formato espanol, sin inventar decimales)."""
    if "." in valor and valor.replace(".", "", 1).isdigit():
        return valor.replace(".", ",")
    if valor.isdigit() and len(valor) > 3:
        return f"{int(valor):,}".replace(",", ".")
    return valor


def _enumerar(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " y " + items[-1]


def construir_brief(lead: dict) -> Brief:
    hechos = lead.get("facts", {})
    usados: list[dict] = []

    def usar(clave: str) -> str | None:
        h = hechos.get(clave)
        if not h:
            return None
        usados.append({"key": clave, "value": h["value"], "source": h["source"],
                       "source_url": h.get("source_url")})
        return h["value"]

    segmento = segmentar(lead)
    nombre = lead["business_name"]
    sector = SECTORES.get((lead.get("sector") or "").lower(), SECTOR_GENERICO)
    zona = usar("zona")
    ciudad = lead.get("city") or ""
    lugar = f"{zona} ({ciudad})" if zona and ciudad else (zona or ciudad)

    # ---------------------------------------------------- observacion -------
    presencia = []
    if usar("google_business"):
        rating, resenas = usar("rating"), usar("reviews_count")
        if rating and resenas:
            presencia.append(f"una ficha de Google con {_num_es(resenas)} reseñas (valoración media de {_num_es(rating)})")
        elif resenas:
            presencia.append(f"una ficha de Google con {_num_es(resenas)} reseñas")
        else:
            presencia.append("una ficha en Google")
    redes = [r for r in ("instagram", "facebook", "tiktok") if usar(r)]
    if redes:
        presencia.append(("un perfil activo en " if len(redes) == 1 else "perfiles activos en ")
                         + _enumerar([r.capitalize() if r != "tiktok" else "TikTok" for r in redes]))

    if segmento == "sin_web":
        usar("sin_web")
        if presencia:
            observacion = f"Hemos visto que {nombre} tiene {_enumerar(presencia)}, pero no una página web propia."
        else:
            observacion = f"Buscando {sector['plural']} en {lugar or 'su zona'}, hemos visto que {nombre} no tiene una página web propia."
    elif segmento == "web_antigua":
        detalle = usar("web_antigua")
        observacion = f"Hemos revisado la web de {nombre}" + (f" y hemos visto que {detalle}." if detalle else ".")
    elif segmento == "web_problemas":
        detalle = usar("web_problema")
        observacion = f"Revisando la web de {nombre} hemos detectado que {detalle}." if detalle else \
            f"Hemos revisado la web de {nombre}."
    else:
        detalle = usar("oportunidad")
        observacion = f"Hemos estado mirando la presencia digital de {nombre}" + (f": {detalle}." if detalle else ".")

    # ---------------------------------------------------- oportunidad -------
    donde = f" en {zona}" if zona else (f" en {ciudad}" if ciudad else "")
    if segmento == "sin_web":
        oportunidad = (f"Quien busca {sector['plural']}{donde} suele querer ver {sector['busca']} antes de decidirse. "
                       "Sin una web propia, esa información queda repartida entre plataformas de terceros "
                       "y no siempre se presenta como a usted le gustaría.")
        if presencia and usados and any(u["key"] == "reviews_count" for u in usados):
            oportunidad += " Las reseñas que ya tiene son un buen punto de partida para esa primera impresión."
    elif segmento == "web_antigua":
        oportunidad = (f"Cada vez más gente busca desde el móvil, y quien busca {sector['plural']}{donde} "
                       f"quiere encontrar {sector['busca']} en pocos segundos.")
    elif segmento == "web_problemas":
        oportunidad = ("Este tipo de problemas suele pasar desapercibido para el propietario, pero lo ve el cliente "
                       "y también afecta a cómo aparece la web en los buscadores.")
    else:
        oportunidad = "Hay margen para que su presencia en internet trabaje más a su favor."

    # ---------------------------------------------------- propuesta ---------
    servicios = usar("servicios")
    extra = f" Incluiríamos lo que ya le distingue: {servicios}." if servicios else ""
    if segmento == "sin_web":
        propuesta = (f"Le proponemos una web propia para {nombre}: rápida, cuidada y pensada para el móvil, "
                     f"con {sector['incluye']}.{extra}")
    else:
        propuesta = (f"Le proponemos renovar la web de {nombre} para que sea rápida, clara y pensada para el móvil, "
                     f"con {sector['incluye']}.{extra}")

    cta = (f"Si le interesa, responda a este correo y le enviaremos una propuesta visual "
           f"adaptada a {nombre}, sin compromiso.")

    asuntos = {
        "sin_web": f"Una idea para la web de {nombre}",
        "web_antigua": f"Sobre la web de {nombre}",
        "web_problemas": f"Un detalle en la web de {nombre}",
        "otras": f"Una idea para {nombre}",
    }
    preheader = {
        "sin_web": f"Lo que hemos visto de {nombre} y lo que proponemos.",
        "web_antigua": f"Lo que hemos visto en su web y cómo mejorarla.",
        "web_problemas": f"Lo que hemos detectado y cómo se resuelve.",
        "otras": f"Lo que hemos visto y lo que proponemos.",
    }[segmento]

    return Brief(
        segment=segmento,
        contact_reason=MOTIVOS[segmento],
        business_name=nombre,
        greeting="Buenos días:",
        observation=observacion,
        opportunity=oportunidad,
        proposal=propuesta,
        cta=cta,
        subject=asuntos[segmento],
        preheader=preheader,
        sector=sector,
        facts_used=usados,
        data_source=lead.get("source") or "",
    )
