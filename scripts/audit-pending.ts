/**
 * Audits every lead that has a website and has not been audited yet, then
 * rescores it.
 *
 *   npm run audit:pending
 *   npm run audit:pending -- --lote 5 --pausa 2000
 *
 * This is the same job the scheduler runs, driven in a loop until there is
 * nothing left. It is what turns a raw list of businesses into a ranked one:
 * a lead with no website scores top on opportunity without being fetched at
 * all, and a lead with a website gets the 13 checks run against the real site.
 *
 * Nothing here invents a verdict. A site that cannot be fetched is recorded as
 * a failed audit with the reason, and retried on later runs.
 */
import './load-env';

const ARGS = process.argv.slice(2);
function arg(name: string): string | null {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurada. Ejecuta: npm run db:check');
    process.exitCode = 1;
    return;
  }

  const lote = Number(arg('lote') ?? 10);
  const pausa = Number(arg('pausa') ?? 1000);

  const { jobWebsiteAudit, rescoreUnscored } = await import('../src/lib/automation/jobs');
  const { pool } = await import('../src/db/client');

  // Los leads sin web no se auditan nunca, así que si nadie los puntúa se
  // quedan en cero — y son justo los de más oportunidad.
  const puntuados = await rescoreUnscored();
  if (puntuados > 0) console.log(`Puntuados ${puntuados} leads que estaban a cero.`);

  let vueltas = 0;
  let total = 0;
  let ok = 0;
  let fallidas = 0;
  let parar = false;

  process.on('SIGINT', () => {
    console.log('\n\nParando al terminar el lote actual.');
    parar = true;
  });

  console.log(`Auditando en lotes de ${lote}. Ctrl-C para parar.`);
  console.log('');

  for (;;) {
    if (parar) break;
    const r = await jobWebsiteAudit(lote);
    const hechas = r.processed ?? 0;
    if (hechas === 0) break;

    vueltas++;
    total += hechas;
    ok += r.success ?? 0;
    fallidas += r.failed ?? 0;
    console.log(
      `Lote ${vueltas}: ${hechas} auditadas · ${r.success ?? 0} bien · ${r.failed ?? 0} fallidas`,
    );

    // Las auditorías salen a internet: conviene no ir a ciegas a toda pastilla.
    await dormir(pausa);
  }

  console.log('');
  console.log('─'.repeat(50));
  console.log(`Auditadas : ${total}`);
  console.log(`Correctas : ${ok}`);
  console.log(`Fallidas  : ${fallidas}`);
  console.log('');
  if (total === 0) {
    console.log('No había nada pendiente de auditar.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
