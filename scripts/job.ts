/**
 * Runs one scheduled job from the command line.
 *
 *   npm run job -- follow-up      cola los correos que tocan hoy
 *   npm run job -- email-queue    envía lo que haya en cola
 *   npm run job -- lista          los nombres disponibles
 *
 * The same jobs the HTTP cron routes call, without needing the web server up
 * or CRON_SECRET in play — which is what a machine-local timer wants.
 */
import './load-env';

const NOMBRES = [
  'lead-discovery',
  'website-audit',
  'email-queue',
  'follow-up',
  'crm-maintenance',
  'duplicate-detection',
  'error-retry',
] as const;

type Nombre = (typeof NOMBRES)[number];

async function main() {
  const nombre = process.argv[2];

  if (!nombre || nombre === 'lista' || nombre === '--ayuda') {
    console.log('Trabajos disponibles:');
    for (const n of NOMBRES) console.log(`  ${n}`);
    console.log('');
    console.log('    npm run job -- follow-up');
    return;
  }

  if (!NOMBRES.includes(nombre as Nombre)) {
    console.error(`"${nombre}" no es un trabajo. Usa: npm run job -- lista`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurada. Ejecuta: npm run db:check');
    process.exitCode = 1;
    return;
  }

  const jobs = await import('../src/lib/automation/jobs');
  const { pool } = await import('../src/db/client');

  const mapa: Record<Nombre, () => Promise<unknown>> = {
    'lead-discovery': jobs.jobLeadDiscovery,
    'website-audit': () => jobs.jobWebsiteAudit(),
    'email-queue': jobs.jobEmailQueue,
    'follow-up': () => jobs.jobFollowUp(),
    'crm-maintenance': jobs.jobCrmMaintenance,
    'duplicate-detection': jobs.jobDuplicateDetection,
    'error-retry': () => jobs.jobErrorRetry(),
  };

  const empezado = Date.now();
  try {
    const resultado = await mapa[nombre as Nombre]();
    console.log(`[${new Date().toISOString()}] ${nombre} — ${Date.now() - empezado} ms`);
    console.log(JSON.stringify(resultado, null, 2));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${nombre} FALLÓ`);
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
