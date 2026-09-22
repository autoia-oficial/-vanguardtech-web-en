#!/usr/bin/env bash
#
# Programa el envío diario.
#
#   ./sistema/programar.sh            instala los temporizadores
#   ./sistema/programar.sh --estado   cómo van
#   ./sistema/programar.sh --quitar   los desinstala
#
# Usa temporizadores de systemd del usuario, no cron: sobreviven al reinicio,
# guardan el registro de cada ejecución y no necesitan que el servidor web ni
# el navegador estén abiertos.
#
#   09:00 todos los días   follow-up     pone en cola los correos que tocan hoy
#   cada 10 minutos        email-queue   envía lo que haya en cola
#   cada hora              website-audit audita las webs pendientes

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

USUARIO="${USER:-$(id -un)}"
UNIDADES="$HOME/.config/systemd/user"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
ambar() { printf '\033[33m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

# nombre-del-trabajo|descripción|OnCalendar
TAREAS=(
  "follow-up|Cola los correos del día|*-*-* 09:00:00"
  "email-queue|Envía los correos en cola|*:0/10"
  "website-audit|Audita las webs pendientes|hourly"
)

comprobar_systemd() {
  if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
    rojo "Este sistema no usa systemd, así que no puedo programarlo así."
    echo
    echo "Alternativa con cron — ejecuta 'crontab -e' y pega:"
    echo
    echo "    0 9 * * *  cd $RAIZ && $(command -v npm) run --silent job -- follow-up   >> $RAIZ/.sistema-trabajos.log 2>&1"
    echo "    */10 * * * *  cd $RAIZ && $(command -v npm) run --silent job -- email-queue >> $RAIZ/.sistema-trabajos.log 2>&1"
    echo "    0 * * * *  cd $RAIZ && $(command -v npm) run --silent job -- website-audit >> $RAIZ/.sistema-trabajos.log 2>&1"
    echo
    return 1
  fi
  return 0
}

estado() {
  comprobar_systemd || return 1
  echo
  local hay=0
  for t in "${TAREAS[@]}"; do
    local nombre="${t%%|*}"
    if [ -f "$UNIDADES/vanguard-$nombre.timer" ]; then
      hay=1
      printf '  %-16s ' "$nombre"
      systemctl --user is-active --quiet "vanguard-$nombre.timer" \
        && printf '\033[32mactivo\033[0m' || printf '\033[31mparado\033[0m'
      local prox
      prox="$(systemctl --user list-timers "vanguard-$nombre.timer" --no-pager --no-legend 2>/dev/null | awk '{print $1, $2, $3}')"
      [ -n "$prox" ] && printf '   próximo: %s' "$prox"
      echo
    fi
  done
  [ "$hay" -eq 0 ] && gris "  No hay nada programado todavía."
  echo
  gris "  Registro:  journalctl --user -u vanguard-follow-up -n 30"
  echo
}

quitar() {
  comprobar_systemd || return 1
  for t in "${TAREAS[@]}"; do
    local nombre="${t%%|*}"
    systemctl --user disable --now "vanguard-$nombre.timer" >/dev/null 2>&1
    rm -f "$UNIDADES/vanguard-$nombre.timer" "$UNIDADES/vanguard-$nombre.service"
  done
  systemctl --user daemon-reload
  verde "Temporizadores quitados."
}

instalar() {
  comprobar_systemd || return 1

  local npm_bin; npm_bin="$(command -v npm)"
  if [ -z "$npm_bin" ]; then
    rojo "No encuentro npm."
    return 1
  fi
  # systemd arranca con un PATH mínimo, así que se le da el del node actual.
  local ruta_node; ruta_node="$(dirname "$(command -v node)")"

  if [ ! -f "$RAIZ/.env.local" ]; then
    rojo "No hay .env.local todavía. Arranca el sistema una vez (opción 1)."
    return 1
  fi

  mkdir -p "$UNIDADES"

  for t in "${TAREAS[@]}"; do
    local nombre="${t%%|*}"
    local resto="${t#*|}"
    local descripcion="${resto%%|*}"
    local cuando="${resto#*|}"

    cat > "$UNIDADES/vanguard-$nombre.service" <<SERVICIO
[Unit]
Description=Vanguard CRM — $descripcion
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$RAIZ
Environment=PATH=$ruta_node:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=$npm_bin run --silent job -- $nombre
SERVICIO

    cat > "$UNIDADES/vanguard-$nombre.timer" <<TEMPORIZADOR
[Unit]
Description=Vanguard CRM — $descripcion

[Timer]
OnCalendar=$cuando
# Si el ordenador estaba apagado a esa hora, lo ejecuta al encender.
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
TEMPORIZADOR
  done

  systemctl --user daemon-reload
  for t in "${TAREAS[@]}"; do
    local nombre="${t%%|*}"
    systemctl --user enable --now "vanguard-$nombre.timer" >/dev/null 2>&1 \
      || { rojo "No he podido activar vanguard-$nombre.timer"; return 1; }
  done

  # Sin "linger" los temporizadores del usuario sólo corren mientras haya
  # sesión iniciada: a las 9:00 con el portátil arrancado pero sin login, no
  # pasaría nada.
  if ! loginctl show-user "$USUARIO" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
    ambar "Activando 'linger' para que funcione sin sesión iniciada (pide sudo)."
    sudo loginctl enable-linger "$USUARIO" \
      || ambar "No se pudo. Los temporizadores sólo correrán con la sesión abierta."
  fi

  echo
  verde "Programado."
  echo
  echo "  09:00 cada día   pone en cola los correos del día"
  echo "  cada 10 min      envía los que haya en cola"
  echo "  cada hora        audita webs pendientes"
  echo
  gris "Nada sale hasta que la campaña esté ACTIVE y el SMTP configurado."
  gris "Ver estado:  ./sistema/programar.sh --estado"
  echo
}

case "${1:-}" in
  --estado) estado ;;
  --quitar) quitar ;;
  *)        instalar ;;
esac
