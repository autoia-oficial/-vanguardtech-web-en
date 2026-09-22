/**
 * Bulk lead discovery: sweeps a matrix of cities x sectors through the
 * configured providers and writes what they return.
 *
 *   npm run discover                      # the default sweep
 *   npm run discover -- --ciudades "Zaragoza,Huesca" --categorias barbers
 *   npm run discover -- --limite 200 --pausa 5000
 *
 * Everything here comes from a real source. OpenStreetMap needs no key and is
 * always available; Google Places joins in only if its key is set. A business
 * with no website is a business OSM has no website for — that absence is the
 * signal this CRM is looking for, so it is recorded as absence, never guessed.
 *
 * Re-running is safe. Discovery deduplicates on the source's own identity, and
 * this script also remembers which pairs it finished so a second run continues
 * instead of starting over.
 */
import './load-env';

const ARGS = process.argv.slice(2);

function arg(name: string): string | null {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null;
}
const flag = (name: string) => ARGS.includes(`--${name}`);

/**
 * Default sweep. Spain, largest cities first, because a bigger city returns
 * more businesses per Overpass call and the early runs are the ones most
 * likely to be interrupted.
 */
const CIUDADES_POR_DEFECTO = [
  'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga',
  'Murcia', 'Palma', 'Las Palmas de Gran Canaria', 'Bilbao', 'Alicante',
  'Córdoba', 'Valladolid', 'Vigo', 'Gijón', 'Hospitalet de Llobregat',
  'Vitoria-Gasteiz', 'A Coruña', 'Granada', 'Elche', 'Oviedo',
  'Badalona', 'Cartagena', 'Terrassa', 'Jerez de la Frontera', 'Sabadell',
  'Santa Cruz de Tenerife', 'Móstoles', 'Alcalá de Henares', 'Pamplona',
  'Fuenlabrada', 'Almería', 'San Sebastián', 'Leganés', 'Santander',
  'Castellón de la Plana', 'Burgos', 'Albacete', 'Alcorcón', 'Getafe',
  'Salamanca', 'Logroño', 'Huelva', 'Badajoz', 'Tarragona', 'León',
  'Cádiz', 'Lleida', 'Marbella', 'Dos Hermanas', 'Mataró', 'Santa Coloma de Gramenet',
  'Torrejón de Ardoz', 'Algeciras', 'Jaén', 'Ourense', 'Reus', 'Telde',
  'Girona', 'Lugo', 'Cáceres', 'Lorca', 'Toledo', 'Guadalajara', 'Huesca',
  'Teruel', 'Zamora', 'Ávila', 'Segovia', 'Cuenca', 'Soria', 'Palencia',
];

function parseLista(valor: string | null, porDefecto: string[]): string[] {
  if (!valor) return porDefecto;
  return valor.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Overpass is a free shared service. Going slowly is the price of using it. */
const PAUSA_POR_DEFECTO = 4000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CLAVE_PROGRESO = 'discovery.sweep.done';

function ayuda() {
  console.log(`
Búsqueda masiva de leads.

  npm run discover                                  barrido completo
  npm run discover -- --ciudades "Zaragoza,Huesca"  sólo esas ciudades
  npm run discover -- --categorias "barbers,gyms"   sólo esos sectores
  npm run discover -- --limite 200                  resultados por consulta
  npm run discover -- --pausa 5000                  ms entre consultas
  npm run discover -- --desde-cero                  ignora el progreso guardado
  npm run discover -- --categorias-disponibles      lista los sectores

Se puede parar con Ctrl-C: guarda el progreso y al volver continúa.
`);
}

async function main() {
  if (flag('ayuda') || flag('help')) {
    ayuda();
    return;
  }

  const { supportedCategories } = await import('../src/lib/discovery/providers/openstreetmap');

  if (flag('categorias-disponibles')) {
    console.log(supportedCategories().join('\n'));
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurada. Ejecuta: npm run db:check');
    process.exitCode = 1;
    return;
  }

  const { runDiscovery, availableProviders, allProviders } = await import('../src/lib/discovery/engine');
  const { getSetting, setSetting } = await import('../src/lib/automation/jobs');
  const { pool } = await import('../src/db/client');

  const disponibles = availableProviders();
  if (disponibles.length === 0) {
    console.error('No hay ninguna fuente de leads disponible. Esto no debería pasar:');
    for (const p of allProviders()) {
      const a = p.availability();
      if (!a.available) console.error(`  ${p.key}: ${a.reason}`);
    }
    process.exitCode = 1;
    await pool.end();
    return;
  }

  console.log(`Fuentes activas: ${disponibles.map((p) => p.label).join(', ')}`);
  for (const p of allProviders()) {
    const a = p.availability();
    if (!a.available) console.log(`Fuente inactiva : ${p.label} — ${a.reason}`);
  }

  const ciudades = parseLista(arg('ciudades'), CIUDADES_POR_DEFECTO);
  const categorias = parseLista(arg('categorias'), supportedCategories());
  const limite = Number(arg('limite') ?? 200);
  const pausa = Number(arg('pausa') ?? PAUSA_POR_DEFECTO);

  const desconocidas = categorias.filter((c) => !supportedCategories().includes(c));
  if (desconocidas.length > 0) {
    console.error(`Categorías no reconocidas: ${desconocidas.join(', ')}`);
    console.error(`Disponibles: ${supportedCategories().join(', ')}`);
    process.exitCode = 1;
    await pool.end();
    return;
  }

  // El progreso vive en la base de datos, no en un fichero suelto, para que
  // sobreviva a un `git pull` o a ejecutarlo desde otra carpeta.
  let hechos = new Set<string>();
  if (!flag('desde-cero')) {
    const guardado = await getSetting(CLAVE_PROGRESO);
    if (guardado) {
      try {
        hechos = new Set(JSON.parse(guardado) as string[]);
      } catch {
        console.warn('El progreso guardado no se pudo leer; empiezo de cero.');
      }
    }
  }

  // Deja las mismas consultas guardadas para el job programado, que las lee
  // de aquí. Así lo que se busca a mano y lo que se busca solo coinciden.
  await setSetting(
    'discovery.queries',
    JSON.stringify(
      ciudades.flatMap((city) =>
        categorias.map((category) => ({ country: 'España', city, category, limit: limite })),
      ),
    ),
    'json',
  );

  const pares: Array<{ city: string; category: string }> = [];
  for (const city of ciudades) {
    for (const category of categorias) {
      if (!hechos.has(`${city}|${category}`)) pares.push({ city, category });
    }
  }

  const total = ciudades.length * categorias.length;
  console.log('');
  console.log(`Ciudades   : ${ciudades.length}`);
  console.log(`Sectores   : ${categorias.length}`);
  console.log(`Consultas  : ${pares.length} pendientes de ${total}`);
  console.log(`Pausa      : ${pausa} ms entre consultas`);
  console.log('');
  if (pares.length === 0) {
    console.log('No queda nada pendiente. Usa --desde-cero para repetir el barrido.');
    await pool.end();
    return;
  }

  let creados = 0;
  let duplicados = 0;
  let fallos = 0;
  let hecho = 0;
  let parar = false;

  const guardarProgreso = () => setSetting(CLAVE_PROGRESO, JSON.stringify([...hechos]), 'json');

  process.on('SIGINT', () => {
    console.log('\n\nParando… guardo el progreso.');
    parar = true;
  });

  const empezado = Date.now();

  for (const { city, category } of pares) {
    if (parar) break;
    hecho++;

    const etiqueta = `[${hecho}/${pares.length}] ${city} · ${category}`;
    let intento = 0;
    let ok = false;

    while (intento < 3 && !ok && !parar) {
      intento++;
      try {
        const r = await runDiscovery({ country: 'España', city, category, limit: limite });
        creados += r.created;
        duplicados += r.duplicates;

        if (r.errors.length > 0) {
          // Un error de la fuente no es un lead perdido en silencio: se dice.
          const msg = r.errors.map((e) => `${e.provider}: ${e.message}`).join(' | ');
          if (intento < 3) {
            console.log(`${etiqueta} — reintento ${intento}: ${msg}`);
            await dormir(pausa * intento * 2);
            continue;
          }
          fallos++;
          console.log(`${etiqueta} — FALLO: ${msg}`);
        } else {
          console.log(
            `${etiqueta} — ${r.found} encontrados, ${r.created} nuevos, ${r.duplicates} ya estaban`,
          );
        }
        ok = true;
        hechos.add(`${city}|${category}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (intento < 3) {
          console.log(`${etiqueta} — reintento ${intento}: ${msg}`);
          await dormir(pausa * intento * 2);
        } else {
          fallos++;
          console.log(`${etiqueta} — FALLO: ${msg}`);
        }
      }
    }

    // Guardar cada pocas consultas: si se corta la luz, se pierde poco.
    if (hecho % 10 === 0) await guardarProgreso();
    if (!parar) await dormir(pausa);
  }

  await guardarProgreso();

  const minutos = Math.round((Date.now() - empezado) / 60000);
  console.log('');
  console.log('─'.repeat(50));
  console.log(`Leads nuevos    : ${creados}`);
  console.log(`Ya estaban      : ${duplicados}`);
  console.log(`Consultas fallidas: ${fallos}`);
  console.log(`Tiempo          : ${minutos} min`);
  console.log('');
  if (creados > 0) {
    console.log('Siguiente paso: auditar sus webs para poder ordenarlos por oportunidad.');
    console.log('');
    console.log('    npm run audit:pending');
    console.log('');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
