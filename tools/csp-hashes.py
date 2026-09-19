#!/usr/bin/env python3
"""Mantiene al dia las huellas de los scripts en linea del CSP.

La web no tiene paso de construccion: el CSS y el JavaScript viven dentro del
HTML. Para no abrir la puerta con 'unsafe-inline', cada script en linea se
autoriza en netlify.toml por su huella sha256.

Eso tiene un filo: si se toca UNA linea de JavaScript y no se regeneran las
huellas, el navegador bloquea el script entero en produccion. La web se sirve,
pero sin nada de JavaScript. Ya paso una vez: se quedo sin la pantalla de
entrada y con los dos formularios a la vista.

    python3 tools/csp-hashes.py          reescribe netlify.toml
    python3 tools/csp-hashes.py --check  no escribe; sale con 1 si no cuadra

Hay que ejecutarlo DESPUES del ultimo cambio en cualquier <script>.
"""
import base64, hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ['index.html', 'gracias.html', 'aviso-legal.html', 'privacidad.html', 'cookies.html']
INLINE = re.compile(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', re.S)


def hashes():
    out = []
    for name in PAGES:
        page = ROOT / name
        if not page.exists():
            continue
        for m in INLINE.finditer(page.read_text(encoding='utf-8')):
            if 'ld+json' in m.group(1):        # datos, no codigo: no se ejecuta
                continue
            digest = hashlib.sha256(m.group(2).encode('utf-8')).digest()
            out.append("'sha256-%s'" % base64.b64encode(digest).decode())
    return list(dict.fromkeys(out))            # sin repetir, en orden


def main():
    check = '--check' in sys.argv
    toml = ROOT / 'netlify.toml'
    text = toml.read_text(encoding='utf-8')
    want = hashes()
    have = re.findall(r"'sha256-[^']+'", text)
    if have == want:
        print('CSP al dia: %d huella(s).' % len(want))
        return 0
    if check:
        print('CSP DESFASADO.')
        print('  en netlify.toml:', have or '(ninguna)')
        print('  deberia ser    :', want)
        print('Ejecuta: python3 tools/csp-hashes.py')
        return 1
    new = re.sub(r"script-src 'self'[^;]*;", "script-src 'self' " + ' '.join(want) + ';', text)
    toml.write_text(new, encoding='utf-8')
    print('netlify.toml actualizado con %d huella(s):' % len(want))
    for h in want:
        print('   ', h)
    return 0


if __name__ == '__main__':
    sys.exit(main())
