# El sistema está aquí

Este repositorio contiene **Vanguard CRM**: el sistema de ventas (Next.js +
TypeScript + PostgreSQL) que encuentra negocios, audita sus webs con 13 checks
reales, los puntúa y gestiona el envío de emails con límites estrictos.

La documentación técnica completa está en **[`CRM-README.md`](./CRM-README.md)**.

## La forma rápida: el lanzador

```bash
./sistema/iniciar.sh
```

Sale un menú, **pulsas `1` y Enter**, y se abre en Brave. El lanzador instala
las dependencias si hace falta, genera los secretos, arranca PostgreSQL,
aplica las migraciones que falten y espera a que el servidor responda de
verdad antes de abrir el navegador. Si algo falla, para y te dice qué pasa.

Detalles en **[`sistema/LEEME.md`](./sistema/LEEME.md)**.

El resto de esta página es el mismo proceso a mano, paso a paso.

> Los ficheros `index.html`, `styles.css`, `aviso-legal.html` y similares en la
> raíz son la **web comercial** anterior, que sigue aquí por historia del repo.
> El CRM vive en `src/`. Ver la nota sobre despliegue más abajo.

---

## Arrancarlo en tu máquina

Necesitas **Node 18+** y **PostgreSQL 14+**.

### 1. Clonar

El nombre del repositorio empieza por un guion, y `cd` lo confunde con una
opción. Clónalo directamente en una carpeta con nombre limpio:

```bash
git clone -b claude/determined-galileo-ilco65 \
  https://github.com/autoia-oficial/-vanguardtech-web-en.git vanguard-crm

cd vanguard-crm
```

*(Si ya lo clonaste y quieres entrar en la carpeta con guion:
`cd ./-vanguardtech-web-en`)*

### 2. Base de datos

```bash
createdb vanguard_crm
createdb vanguard_crm_test      # solo si vas a ejecutar los tests
```

### 3. Variables de entorno

```bash
cp .env.example .env.local
```

Edita `.env.local` y rellena estas tres:

```bash
DATABASE_URL=postgresql://TU_USUARIO@localhost:5432/vanguard_crm
AUTH_SECRET=<pega aquí lo que devuelva: openssl rand -base64 32>
CRON_SECRET=<pega aquí lo que devuelva: openssl rand -hex 32>
```

> **Cada vez que hagas `git pull`, ejecuta `npm run db:migrate`.** Si el código
> espera una tabla que tu base de datos todavía no tiene, la app te lo dirá con
> ese mismo mensaje en vez de dar un error genérico.
>
> Si algo falla y no sabes por dónde empezar: **`npm run db:check`**. Te dice a
> qué base está conectando, si responde, qué tablas faltan y qué comando
> ejecutar. No necesita `psql` ni ninguna herramienta externa.

### 4. Instalar, migrar, arrancar

```bash
npm install
npm run db:migrate
npm run seed        # crea el admin y unos leads de ejemplo (opcional)
npm run dev
```

Abre **http://localhost:3000**. La primera vez te pedirá crear la cuenta de
administrador; ese formulario se cierra para siempre en cuanto exista un usuario.

Si usaste `npm run seed`, las credenciales por defecto son las de
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` en tu `.env.local`. **Cámbialas antes
de exponer esto a nadie.**

### Crear un usuario o cambiar una contraseña

```bash
npm run set-password -- xyrz@local mi-contraseña
```

Crea el usuario si no existe, o le cambia la contraseña si ya existe. El
identificador tiene que ser un email — el login usa un campo de email, así que
`xyrz` a secas no vale, pero `xyrz@local` sí.

Esta herramienta no impone el mínimo de 12 caracteres que sí exige el registro
por web: para ejecutarla ya necesitas la cadena de conexión a la base de datos,
y quien la tiene puede hacer cualquier cosa con los datos de todos modos. Te
avisa si la contraseña es corta.

Para borrar los datos de ejemplo: `npx tsx scripts/seed.ts --clean`

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `./sistema/iniciar.sh` | **El lanzador**: menú, pulsas 1, se abre en Brave |
| `npm test` | Los 220 tests (necesita `vanguard_crm_test`) |
| `npm run db:check` | **Diagnostica la base de datos**: conexión, tablas que faltan, qué hacer |
| `npm run db:migrate` | Aplica las migraciones |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run seed` | Datos de ejemplo · `-- --clean` para borrarlos |
| `npm run audit:url -- https://una-web.com` | Audita cualquier web desde el terminal |
| `npm run set-password -- <email> <contraseña>` | Crea un usuario o le cambia la contraseña |
| `npm run ui-check` | Recorre la app en un navegador real |

---

## Para que empiece a enviar emails

Sin estas cuatro variables la cola **acumula y no envía nada**, y no marca nada
como enviado. La interfaz te dirá `NOT CONFIGURED` señalando exactamente lo que
falta:

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
```

Luego, dentro de la app: **Settings** → añade la cuenta de envío →
**Campaigns** → nueva campaña → añade los pasos de la secuencia → asigna la
cuenta → enrola leads por etapa → *Activate*.

---

## Desplegar en Vercel — léelo antes

`main` es tu **web comercial** (`index.html`, desplegada en Netlify).
Esta rama contiene esos ficheros *y además* la app Next.js.

Si apuntas Vercel a este repositorio, Next.js **no sirve el `index.html` de la
raíz**: en ese dominio se vería el login del CRM, no tu web.

Recomendación:

1. Crea un **proyecto de Vercel aparte** para el CRM.
2. En *Settings → Git → Production Branch* pon `claude/determined-galileo-ilco65`
   (si no, Vercel solo hará *previews* y la URL de producción quedará vacía).
3. Dale un subdominio propio, por ejemplo `crm.tudominio.com`.
4. Tu web comercial se queda en Netlify sin tocar.

Variables a configurar en ese proyecto de Vercel:

| Variable | ¿Obligatoria? |
|---|---|
| `DATABASE_URL` | Sí — la cadena *pooled* de Neon |
| `AUTH_SECRET` | Sí — `openssl rand -base64 32` |
| `CRON_SECRET` | Sí — `openssl rand -hex 32` |
| `SMTP_*` | No — hasta ponerlas, no se envía nada |
| `GOOGLE_PLACES_API_KEY` | No — habilita esa fuente de discovery |

Los 7 cron jobs ya están declarados en `vercel.json`; se activan solos al
desplegar. Después del primer despliegue, ejecuta las migraciones una vez:

```bash
DATABASE_URL="<la de Neon>" npm run db:migrate
```

---

## Qué NO está construido

Dicho claramente para que nada se confunda con algo que funciona:

- **Seguimiento de aperturas, clics y respuestas.** Las tablas y los estados
  existen, pero nada los escribe: eso requiere webhooks de tu proveedor de
  email. Preferimos dejarlo vacío antes que inventar eventos.
- **Fusión de duplicados.** Se detectan y se listan en *Errors*; fusionarlos
  sigue siendo manual.
- **Discovery desde la interfaz.** Funciona por API y por el job programado
  (con las consultas guardadas en *Settings*), pero no hay formulario de
  búsqueda en la UI.
