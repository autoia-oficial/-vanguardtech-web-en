#!/usr/bin/env bash
#
# Lanzador de Vanguard CRM.
#
# Pulsas 1, Enter, y se abre el sistema en Brave.
#
# Antes de abrir el navegador comprueba y arregla lo que suele fallar —
# dependencias sin instalar, PostgreSQL parado, migraciones sin aplicar, falta
# de secretos — en vez de dejar que el error aparezca luego en una pantalla del
# CRM sin explicación.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

# No todos los terminales exportan USER (ni cron, ni un lanzador del
# escritorio), y con `set -u` leerlo a secas aborta el script a media frase.
USUARIO="${USER:-$(id -un)}"

PUERTO="${PORT:-3000}"
URL="http://localhost:$PUERTO"
LOG="$RAIZ/.sistema-servidor.log"
PIDFILE="$RAIZ/.sistema-servidor.pid"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
ambar() { printf '\033[33m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Requisitos
# ---------------------------------------------------------------------------

comprobar_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    rojo "Node.js no está instalado."
    echo
    echo "Instálalo con:"
    echo
    echo "    sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs"
    echo
    return 1
  fi

  local mayor
  mayor="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "${mayor:-0}" -lt 18 ] 2>/dev/null; then
    rojo "Node $(node -v) es demasiado antiguo. Hace falta 18 o superior."
    return 1
  fi
  return 0
}

instalar_dependencias() {
  # node_modules no está en git: en un clon recién hecho hay que instalarlo.
  # npm deja su propia marca dentro; si es más nueva que el lock, ya está
  # todo puesto y no hace falta esperar un minuto en cada arranque.
  local marca="node_modules/.package-lock.json"
  if [ -f "$marca" ] && [ ! package-lock.json -nt "$marca" ]; then
    return 0
  fi
  ambar "Instalando dependencias (la primera vez tarda un par de minutos)…"
  if ! npm install; then
    rojo "npm install falló. Mira el error de arriba."
    return 1
  fi
  touch "$marca"
  verde "Dependencias instaladas."
  return 0
}

# ---------------------------------------------------------------------------
# Entorno
# ---------------------------------------------------------------------------

secreto_aleatorio() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

# Pone clave=valor en .env.local, tanto si la línea existe como si no.
fijar_variable() {
  local clave="$1" valor="$2"
  if grep -qE "^${clave}=" .env.local; then
    # El valor es hexadecimal, así que no hay nada que escapar en el sed.
    sed -i "s|^${clave}=.*|${clave}=${valor}|" .env.local
  else
    printf '%s=%s\n' "$clave" "$valor" >> .env.local
  fi
}

valor_de() {
  sed -n "s|^$1=||p" .env.local | head -1
}

preparar_entorno() {
  if [ ! -f .env.local ]; then
    ambar "No existe .env.local. Lo creo a partir del ejemplo."
    cp .env.example .env.local || return 1
  fi

  # Los secretos se generan solos; la cadena de la base de datos no, porque
  # sólo tú sabes dónde está.
  if [ -z "$(valor_de AUTH_SECRET)" ]; then
    fijar_variable AUTH_SECRET "$(secreto_aleatorio)"
    gris "AUTH_SECRET generado."
  fi
  if [ -z "$(valor_de CRON_SECRET)" ]; then
    fijar_variable CRON_SECRET "$(secreto_aleatorio)"
    gris "CRON_SECRET generado."
  fi

  # El valor de ejemplo apunta a un servidor llamado literalmente "host", que
  # no existe. Es el fallo número uno al arrancar esto por primera vez.
  local bd; bd="$(valor_de DATABASE_URL)"
  if [ -z "$bd" ] || [[ "$bd" == postgresql://user:password@host/* ]]; then
    rojo "Falta la dirección de la base de datos (DATABASE_URL)."
    echo
    echo "Si todavía no tienes PostgreSQL instalado, usa la opción 4 del menú:"
    echo "te da los comandos exactos y deja esta línea puesta."
    echo
    echo "Si ya lo tienes, edita .env.local y pon tu cadena real:"
    echo
    echo "    DATABASE_URL=postgresql://$USUARIO:TU_CONTRASEÑA@127.0.0.1:5432/vanguard_crm"
    echo
    return 1
  fi
  return 0
}

arrancar_postgres() {
  command -v systemctl >/dev/null 2>&1 || return 0
  # En un contenedor systemctl existe pero no hay systemd detrás: llamarlo
  # sólo produce un error confuso.
  [ -d /run/systemd/system ] || return 0
  systemctl is-active --quiet postgresql 2>/dev/null && return 0
  systemctl list-unit-files 2>/dev/null | grep -q '^postgresql' || return 0

  ambar "PostgreSQL está parado. Lo arranco (puede pedirte tu contraseña)."
  sudo systemctl start postgresql || return 1
  sleep 2
  return 0
}

# ---------------------------------------------------------------------------
# Servidor
# ---------------------------------------------------------------------------

responde() {
  curl -sf -m 3 -o /dev/null "$1/login" 2>/dev/null
}

# Next.js cambia de puerto solo si el 3000 está ocupado, y lo escribe en el
# log. Leerlo de ahí evita abrir Brave en la dirección equivocada.
url_del_log() {
  grep -oE 'http://localhost:[0-9]+' "$LOG" 2>/dev/null | head -1
}

abrir_navegador() {
  local destino="$1" navegador=""

  for c in brave-browser brave brave-browser-stable; do
    if command -v "$c" >/dev/null 2>&1; then navegador="$c"; break; fi
  done

  if [ -n "$navegador" ]; then
    "$navegador" "$destino" >/dev/null 2>&1 &
    verde "Abriendo Brave en $destino"
    return 0
  fi

  if command -v flatpak >/dev/null 2>&1 && flatpak info com.brave.Browser >/dev/null 2>&1; then
    flatpak run com.brave.Browser "$destino" >/dev/null 2>&1 &
    verde "Abriendo Brave (Flatpak) en $destino"
    return 0
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    ambar "No encuentro Brave. Abro el navegador por defecto."
    xdg-open "$destino" >/dev/null 2>&1 &
    return 0
  fi

  ambar "No he podido abrir ningún navegador. Entra tú a: $destino"
  return 0
}

iniciar() {
  echo
  comprobar_node       || return 1
  instalar_dependencias || return 1
  preparar_entorno     || return 1
  arrancar_postgres

  gris "Comprobando la base de datos…"
  local salida
  salida="$(npm run --silent db:check 2>&1)"

  if grep -q "MISSING" <<<"$salida"; then
    ambar "Faltan tablas. Aplico las migraciones."
    if ! npm run --silent db:migrate; then
      rojo "Las migraciones fallaron."
      echo "$salida"
      return 1
    fi
    verde "Migraciones aplicadas."
  elif grep -q "Could not reach the database" <<<"$salida"; then
    rojo "No se puede conectar con la base de datos. Esto es lo que dice:"
    echo
    echo "$salida"
    echo
    gris "La opción 4 del menú instala y configura PostgreSQL desde cero."
    return 1
  else
    verde "Base de datos correcta."
  fi

  if responde "$URL"; then
    gris "El servidor ya estaba en marcha."
  else
    gris "Arrancando el servidor…"
    : > "$LOG"
    # setsid lo pone en su propio grupo de procesos: así al parar se va
    # también el proceso hijo de Next, no sólo el npm de arriba.
    if command -v setsid >/dev/null 2>&1; then
      setsid npm run dev > "$LOG" 2>&1 &
    else
      npm run dev > "$LOG" 2>&1 &
    fi
    echo $! > "$PIDFILE"

    local intento=0
    until responde "${URL_REAL:-$URL}"; do
      URL_REAL="$(url_del_log)"
      intento=$((intento + 1))
      if [ "$intento" -gt 90 ]; then
        rojo "El servidor no respondió en 90 segundos. Últimas líneas del log:"
        echo
        tail -20 "$LOG"
        return 1
      fi
      sleep 1
    done
    URL_REAL="${URL_REAL:-$URL}"
    verde "Servidor listo."
  fi

  local destino="${URL_REAL:-$URL}"
  abrir_navegador "$destino"

  echo
  gris "Si es la primera vez, la pantalla te pedirá crear tu cuenta."
  gris "Registro del servidor: $LOG"
  gris "Para pararlo: opción 2 del menú."
  echo
}

parar() {
  echo
  if [ -f "$PIDFILE" ]; then
    local pid; pid="$(cat "$PIDFILE")"
    # El negativo mata al grupo entero (npm y el Next que cuelga de él).
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  sleep 1
  if responde "$URL"; then
    rojo "Sigue respondiendo. Puede que lo arrancaras desde otro terminal."
  else
    verde "Servidor parado."
  fi
  echo
}

diagnosticar() {
  echo
  comprobar_node || return 1
  gris "Carpeta     : $RAIZ"
  if [ -f .env.local ]; then
    gris ".env.local  : existe"
  else
    ambar ".env.local  : no existe todavía"
  fi
  echo
  arrancar_postgres
  npm run --silent db:check
  echo
  if responde "$URL"; then
    verde "Servidor    : en marcha en $URL"
  else
    gris "Servidor    : parado"
  fi
  echo
}

instalar_postgres() {
  cat <<AYUDA

PostgreSQL en AlmaLinux / RHEL / Rocky / Fedora. Copia y pega bloque a bloque.

1) Instalarlo y arrancarlo:

    sudo dnf install -y postgresql-server postgresql
    sudo postgresql-setup --initdb
    sudo systemctl enable --now postgresql

2) Permitir conexión por contraseña. Viene configurado en modo "ident", que
   sólo funciona desde la línea de comandos, no desde la aplicación:

    sudo sed -i 's/\bident\b/scram-sha-256/g' /var/lib/pgsql/data/pg_hba.conf
    sudo systemctl reload postgresql

3) Crear tu usuario y las dos bases de datos:

    sudo -u postgres psql -c "CREATE USER $USUARIO WITH PASSWORD 'vanguard' CREATEDB;"
    sudo -u postgres createdb -O $USUARIO vanguard_crm
    sudo -u postgres createdb -O $USUARIO vanguard_crm_test

4) Apuntar la aplicación ahí:

    cd $RAIZ
    ./sistema/iniciar.sh 4 --escribir

   (ese último comando deja la línea DATABASE_URL puesta en .env.local)

Después vuelve al menú y pulsa 1.

AYUDA

  if [ "${1:-}" = "--escribir" ]; then
    [ -f .env.local ] || cp .env.example .env.local
    fijar_variable DATABASE_URL "postgresql://$USUARIO:vanguard@127.0.0.1:5432/vanguard_crm"
    fijar_variable TEST_DATABASE_URL "postgresql://$USUARIO:vanguard@127.0.0.1:5432/vanguard_crm_test"
    verde "DATABASE_URL escrita en .env.local."
    echo
  fi
}

cambiar_password() {
  echo
  gris "El identificador tiene que ser un email (el login usa un campo de email)."
  read -r -p "Email: " correo
  read -r -s -p "Contraseña nueva: " clave
  echo
  [ -z "$correo" ] && { rojo "Hace falta un email."; return 1; }
  [ -z "$clave" ]  && { rojo "Hace falta una contraseña."; return 1; }
  npm run --silent set-password -- "$correo" "$clave"
  echo
}

# ---------------------------------------------------------------------------
# Menú
# ---------------------------------------------------------------------------

menu() {
  while true; do
    echo
    printf '\033[1m  VANGUARD CRM\033[0m\n'
    gris "  ──────────────────────────────"
    echo "  1  Iniciar y abrir en Brave"
    echo "  2  Parar el servidor"
    echo "  3  Diagnosticar"
    echo "  4  Instalar PostgreSQL (instrucciones)"
    echo "  5  Crear usuario / cambiar contraseña"
    echo "  0  Salir"
    echo
    read -r -p "  Pulsa un número y Enter: " opcion || { echo; exit 0; }

    case "$opcion" in
      1) iniciar ;;
      2) parar ;;
      3) diagnosticar ;;
      4) instalar_postgres ;;
      5) cambiar_password ;;
      0) echo; gris "Hasta luego."; echo; exit 0 ;;
      "") ;;
      *) rojo "Opción no válida." ;;
    esac
  done
}

# Con un número como argumento ejecuta esa opción directamente, sin menú.
case "${1:-}" in
  1) iniciar; exit $? ;;
  2) parar; exit $? ;;
  3) diagnosticar; exit $? ;;
  4) instalar_postgres "${2:-}"; exit $? ;;
  5) cambiar_password; exit $? ;;
esac

menu
