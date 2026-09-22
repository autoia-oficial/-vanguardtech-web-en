#!/usr/bin/env bash
#
# Crea un icono "Vanguard CRM" en el escritorio y en el menú de aplicaciones.
# Al pulsarlo se abre un terminal con el menú del sistema.
#
# Opcional: el sistema funciona igual ejecutando ./sistema/iniciar.sh

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANZADOR="$RAIZ/sistema/iniciar.sh"

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
ambar() { printf '\033[33m%s\033[0m\n' "$*"; }

if [ ! -x "$LANZADOR" ]; then
  chmod +x "$LANZADOR" 2>/dev/null
fi

contenido="[Desktop Entry]
Type=Application
Name=Vanguard CRM
Comment=Abre el sistema de ventas de Vanguard Tech
Exec=bash -c 'cd \"$RAIZ\" && ./sistema/iniciar.sh'
Path=$RAIZ
Icon=applications-office
Terminal=true
Categories=Office;
"

instalar_en() {
  local carpeta="$1"
  [ -d "$carpeta" ] || return 1
  local destino="$carpeta/vanguard-crm.desktop"
  printf '%s' "$contenido" > "$destino" || return 1
  chmod +x "$destino"
  # GNOME no ejecuta un lanzador que no esté marcado como de confianza.
  command -v gio >/dev/null 2>&1 && gio set "$destino" metadata::trusted true 2>/dev/null
  verde "Creado: $destino"
  return 0
}

mkdir -p "$HOME/.local/share/applications"
instalar_en "$HOME/.local/share/applications"

# El nombre de la carpeta del escritorio depende del idioma del sistema.
escritorio=""
if command -v xdg-user-dir >/dev/null 2>&1; then
  escritorio="$(xdg-user-dir DESKTOP 2>/dev/null)"
fi
for candidata in "$escritorio" "$HOME/Escritorio" "$HOME/Desktop"; do
  if [ -n "$candidata" ] && [ -d "$candidata" ] && [ "$candidata" != "$HOME" ]; then
    instalar_en "$candidata" && break
  fi
done

echo
ambar "Si el icono del escritorio aparece con un aviso, pulsa con el botón"
ambar "derecho y elige «Permitir ejecución» la primera vez."
echo
