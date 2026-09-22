# El sistema está aquí

Esta carpeta es el lanzador. El código del sistema vive en `../src`, y la
documentación técnica completa en [`../CRM-README.md`](../CRM-README.md).

## Para abrirlo

Abre un terminal en la carpeta del proyecto y escribe:

```bash
./sistema/iniciar.sh
```

Sale un menú. **Pulsa `1` y Enter** y se abre el sistema en Brave.

```
  VANGUARD CRM
  ──────────────────────────────
  1  Iniciar y abrir en Brave
  2  Parar el servidor
  3  Diagnosticar
  4  Instalar PostgreSQL (instrucciones)
  5  Crear usuario / cambiar contraseña
  0  Salir

  Pulsa un número y Enter:
```

La opción 1 hace, por este orden, todo lo que hace falta:

1. Instala las dependencias si es un clon nuevo (`npm install`).
2. Crea `.env.local` si no existe y genera `AUTH_SECRET` y `CRON_SECRET`.
3. **Si falta la base de datos, instala y configura PostgreSQL** (te lo
   pregunta una vez antes, porque necesita `sudo`).
4. Arranca PostgreSQL si está parado.
5. Aplica las migraciones que falten — y comprueba después que las tablas
   están de verdad, sin fiarse de que el comando diga que fue bien.
6. Levanta el servidor y espera a que responda de verdad.
7. Abre Brave.

Si algo falla, para ahí y te dice exactamente qué pasa. No abre el navegador
para que te encuentres el error dentro de la aplicación.

## La primera vez

No tienes que preparar nada. Pulsa `1` y, cuando te pregunte si configura la
base de datos, pulsa Enter. Eso:

- instala PostgreSQL con el gestor de paquetes de tu sistema,
- crea el usuario de base de datos con una contraseña aleatoria,
- crea `vanguard_crm` y `vanguard_crm_test`,
- y escribe la conexión en `.env.local`.

Te pedirá tu contraseña de Linux, porque instalar paquetes necesita `sudo`.

Si prefieres hacerlo a mano, pulsa `4`: te da los comandos exactos y no toca
nada.

La primera pantalla del sistema te pedirá crear tu cuenta de administrador.
Ese formulario se cierra para siempre en cuanto exista un usuario.

## Icono en el escritorio (opcional)

```bash
./sistema/crear-acceso-directo.sh
```

Crea un icono «Vanguard CRM» en el escritorio y en el menú de aplicaciones.
Al pulsarlo abre un terminal con este mismo menú.

## Sin menú

Cada opción se puede ejecutar directa, pasándole el número:

```bash
./sistema/iniciar.sh 1     # iniciar y abrir Brave
./sistema/iniciar.sh 2     # parar
./sistema/iniciar.sh 3     # diagnosticar
```

## Si algo va mal

Pulsa `3` (Diagnosticar). Te dice a qué base de datos está conectando, si
responde, qué tablas faltan y qué comando ejecutar.

El registro del servidor queda en `.sistema-servidor.log`, en la raíz del
proyecto.

## Lo que el lanzador **no** hace

- No instala PostgreSQL sin preguntar. Toca el sistema con `sudo` y cambia
  `pg_hba.conf`, así que pide permiso una vez y deja una copia del fichero
  original al lado (`pg_hba.conf.antes-de-vanguard`). Si dices que no, te da
  los comandos y no toca nada.
- No inventa una `DATABASE_URL` ni usa una por defecto. Si no está puesta,
  se para y lo dice.
- No da por buena una migración porque el comando diga que fue bien: vuelve a
  mirar qué tablas hay.
- No configura el envío de emails. Hasta que pongas `SMTP_*` en `.env.local`,
  la cola guarda los correos y no envía nada — y la interfaz lo dice con un
  `NOT CONFIGURED`, sin marcar nada como enviado.
