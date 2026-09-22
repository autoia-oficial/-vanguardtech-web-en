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
  # no existe. Devolver 2 (y no 1) deja que quien llama lo distinga de un
  # error de verdad y ofrezca configurarlo.
  local bd; bd="$(valor_de DATABASE_URL)"
  if [ -z "$bd" ] || [[ "$bd" == postgresql://user:password@host/* ]]; then
    return 2
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
# Instalación automática de PostgreSQL
#
# Esto toca el sistema con sudo, así que pregunta una vez antes de empezar y
# dice exactamente lo que va a hacer. Todo lo de aquí se puede repetir sin
# romper nada: si el paquete ya está, si el usuario ya existe o si la base ya
# está creada, lo detecta y sigue.
# ---------------------------------------------------------------------------

gestor_paquetes() {
  for g in dnf apt-get yum zypper pacman; do
    command -v "$g" >/dev/null 2>&1 && { echo "$g"; return 0; }
  done
  return 1
}

postgres_instalado() {
  command -v postgres >/dev/null 2>&1 && return 0
  command -v pg_ctl   >/dev/null 2>&1 && return 0
  ls /usr/pgsql-*/bin/postgres >/dev/null 2>&1 && return 0
  ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1 && return 0
  return 1
}

# psql como el usuario del sistema "postgres". El cd a /tmp evita el aviso de
# "could not change directory" cuando el home de postgres no es accesible.
psql_admin() {
  sudo -u postgres bash -c "cd /tmp && psql -tAc \"$1\"" 2>&1
}

esperar_postgres() {
  local intento=0
  until psql_admin "SELECT 1" | grep -q '^1$'; do
    intento=$((intento + 1))
    [ "$intento" -gt 30 ] && return 1
    sleep 1
  done
  return 0
}

instalar_paquete_postgres() {
  local g; g="$(gestor_paquetes)" || return 1
  gris "Instalando PostgreSQL con $g…"
  case "$g" in
    dnf|yum)  sudo "$g" install -y postgresql-server postgresql ;;
    apt-get)  sudo apt-get update -qq && sudo apt-get install -y postgresql ;;
    zypper)   sudo zypper --non-interactive install postgresql-server postgresql ;;
    pacman)   sudo pacman -S --noconfirm postgresql ;;
    *)        return 1 ;;
  esac
}

inicializar_cluster() {
  # Debian y derivados crean el cluster solos al instalar; RHEL no.
  [ -f /var/lib/pgsql/data/PG_VERSION ] && return 0
  ls /etc/postgresql/*/main/postgresql.conf >/dev/null 2>&1 && return 0

  if command -v postgresql-setup >/dev/null 2>&1; then
    gris "Inicializando la base de datos…"
    sudo postgresql-setup --initdb || return 1
  fi
  return 0
}

# Por defecto sólo se permite entrar por "ident"/"peer", que funciona desde el
# terminal pero no desde la aplicación. Hay que pasar las líneas de red a
# contraseña, dejando intactas las locales para que sudo -u postgres siga yendo.
permitir_contrasena() {
  local hba
  hba="$(psql_admin 'SHOW hba_file' | grep '^/' | head -1)"
  [ -f "$hba" ] || hba="/var/lib/pgsql/data/pg_hba.conf"
  [ -f "$hba" ] || hba="$(ls /etc/postgresql/*/main/pg_hba.conf 2>/dev/null | head -1)"
  [ -f "$hba" ] || { ambar "No encuentro pg_hba.conf; sigo sin tocarlo."; return 0; }

  # Si ya acepta contraseña en red, no hay nada que hacer.
  if sudo grep -qE '^[[:space:]]*host.*(scram-sha-256|md5)' "$hba"; then
    return 0
  fi

  sudo cp -n "$hba" "$hba.antes-de-vanguard" 2>/dev/null
  gris "Permitiendo conexión por contraseña (copia en $hba.antes-de-vanguard)…"
  # Sólo las líneas host: las local se quedan en peer.
  sudo sed -i -E 's/^([[:space:]]*host[[:space:]].*[[:space:]])(ident|trust|peer)([[:space:]]*)$/\1scram-sha-256\3/' "$hba"
  sudo systemctl reload postgresql 2>/dev/null || true
  sleep 1
}

crear_usuario_y_bases() {
  local clave="$1" salida

  # El identificador va entre comillas dobles y la clave es hexadecimal, así
  # que no hay nada que se pueda colar en la sentencia. psql_admin devuelve
  # también el error en stdout: hay que enseñarlo, no tragárselo.
  salida="$(psql_admin "DO \\\$\\\$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = '$USUARIO') THEN
      ALTER ROLE \\\"$USUARIO\\\" WITH LOGIN CREATEDB PASSWORD '$clave';
    ELSE
      CREATE ROLE \\\"$USUARIO\\\" WITH LOGIN CREATEDB PASSWORD '$clave';
    END IF;
  END \\\$\\\$;")"
  if grep -qiE 'error|fatal' <<<"$salida"; then
    rojo "No se ha podido crear el usuario '$USUARIO':"
    echo "$salida"
    return 1
  fi

  local base
  for base in vanguard_crm vanguard_crm_test; do
    if ! psql_admin "SELECT 1 FROM pg_database WHERE datname = '$base'" | grep -q '^1$'; then
      salida="$(sudo -u postgres bash -c "cd /tmp && createdb -O '$USUARIO' '$base'" 2>&1)" || {
        rojo "No se ha podido crear la base '$base':"
        echo "$salida"
        return 1
      }
      gris "Base '$base' creada."
    fi
  done
  return 0
}

configurar_base_de_datos() {
  echo
  ambar "Falta la base de datos. Puedo instalarla y configurarla yo."
  echo
  echo "  · Instala PostgreSQL si no está"
  echo "  · Crea el usuario '$USUARIO' con una contraseña aleatoria"
  echo "  · Crea las bases vanguard_crm y vanguard_crm_test"
  echo "  · Escribe la conexión en .env.local"
  echo
  gris "Necesita sudo, así que puede pedirte tu contraseña de Linux."
  echo
  local respuesta
  read -r -p "  ¿Lo hago ahora? [S/n]: " respuesta
  case "${respuesta:-s}" in
    [nN]*)
      echo
      instalar_postgres
      return 1
      ;;
  esac
  echo

  if ! command -v sudo >/dev/null 2>&1; then
    rojo "No hay sudo en este sistema; no puedo instalarlo por ti."
    instalar_postgres
    return 1
  fi

  if ! postgres_instalado; then
    instalar_paquete_postgres || {
      rojo "No he podido instalar PostgreSQL. Los comandos a mano:"
      instalar_postgres
      return 1
    }
  else
    gris "PostgreSQL ya está instalado."
  fi

  inicializar_cluster || { rojo "No he podido inicializar la base de datos."; return 1; }

  gris "Arrancando el servicio…"
  sudo systemctl enable --now postgresql 2>/dev/null || sudo systemctl start postgresql 2>/dev/null

  if ! esperar_postgres; then
    rojo "PostgreSQL no ha llegado a responder. Mira: sudo systemctl status postgresql"
    return 1
  fi

  permitir_contrasena

  local clave; clave="$(secreto_aleatorio)"
  if ! crear_usuario_y_bases "$clave"; then
    rojo "No he podido crear el usuario o las bases de datos."
    return 1
  fi

  fijar_variable DATABASE_URL "postgresql://$USUARIO:$clave@127.0.0.1:5432/vanguard_crm"
  fijar_variable TEST_DATABASE_URL "postgresql://$USUARIO:$clave@127.0.0.1:5432/vanguard_crm_test"
  verde "Base de datos lista y conexión escrita en .env.local."

  # Comprobación de verdad: conectar como lo hará la aplicación, no asumirlo.
  if ! npm run --silent db:check >/dev/null 2>&1; then
    local detalle; detalle="$(npm run --silent db:check 2>&1)"
    if grep -q "Could not reach the database" <<<"$detalle"; then
      rojo "Se ha configurado, pero la aplicación no consigue conectar:"
      echo
      echo "$detalle"
      return 1
    fi
  fi
  echo
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
  comprobar_node        || return 1
  instalar_dependencias || return 1

  preparar_entorno
  case $? in
    0) ;;
    2) configurar_base_de_datos || return 1 ;;   # falta DATABASE_URL
    *) return 1 ;;
  esac

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
    # No basta con que db:migrate diga que ha ido bien: si estaba apuntando a
    # otra base, diría exactamente lo mismo y el fallo aparecería después,
    # dentro de la aplicación. Se vuelve a mirar qué tablas hay de verdad.
    salida="$(npm run --silent db:check 2>&1)"
    if grep -q "MISSING" <<<"$salida"; then
      rojo "Las migraciones dijeron que fueron bien, pero las tablas siguen sin estar."
      echo
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
    echo "  4  Instalar PostgreSQL a mano (instrucciones)"
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
