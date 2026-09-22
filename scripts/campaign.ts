/**
 * Sets up the outreach campaign and enrols leads into it.
 *
 *   npm run campaign -- --remitente contact.vanguardtech@gmail.com
 *   npm run campaign -- --remitente ... --activar
 *   npm run campaign -- --inscribir            # sólo añadir leads nuevos
 *   npm run campaign -- --estado               # ver cómo va
 *
 * Creating the campaign does not send anything. Mail leaves only when the
 * campaign is ACTIVE, the SMTP credentials are set, and the scheduled jobs
 * run — and no message is ever marked SENT unless the provider confirmed it.
 */
import './load-env';

const ARGS = process.argv.slice(2);
function arg(name: string): string | null {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--') ? ARGS[i + 1] : null;
}
const flag = (n: string) => ARGS.includes(`--${n}`);

const NOMBRE_CAMPANA = 'Webs que necesitan una mano';

/**
 * Tres pasos, espaciados. El texto identifica quién escribe y cómo dejar de
 * recibir correos: en España un email comercial sin remitente identificable
 * y sin salida no es legal (LSSI-CE art. 20-22), aparte de que funciona peor.
 */
const SECUENCIA = [
  {
    step: 1,
    wait_days: 0,
    subject: '{{business_name}} — una pregunta rápida sobre vuestra web',
    body: `Hola:

Soy Ander, de Vanguard Tech. Hemos estado mirando negocios de {{city}} y me ha llamado la atención {{business_name}}.

He revisado vuestra presencia en internet y he visto un par de cosas que hoy os están costando clientes: gente que os busca desde el móvil y no os encuentra, o que llega y se va porque la página tarda o no se ve bien.

No es una plantilla: si me respondéis, os mando el detalle concreto de lo que he visto en vuestro caso, sin compromiso.

¿Os interesa que os lo pase?

Ander
Vanguard Tech
{{sender_email}}

Si no queréis recibir más correos míos, respondedme con "baja" y no os vuelvo a escribir.`,
  },
  {
    step: 2,
    wait_days: 4,
    subject: 'Re: {{business_name}} — os dejo lo que vi',
    body: `Hola de nuevo:

Os escribí hace unos días sobre la web de {{business_name}}. Por si se perdió entre el correo, os resumo por qué os escribí:

Cuando alguien busca un negocio como el vuestro en {{city}}, lo primero que hace es mirar el móvil. Si lo que encuentra no carga rápido o no se lee bien, se va al siguiente. Eso pasa todos los días y no se ve en ninguna parte: simplemente no llaman.

Nosotros arreglamos exactamente eso. Si queréis, os digo qué encontré en vuestro caso concreto y vosotros decidís.

Ander
Vanguard Tech
{{sender_email}}

Responded "baja" y dejo de escribiros.`,
  },
  {
    step: 3,
    wait_days: 7,
    subject: 'Re: {{business_name}} — cierro el tema',
    body: `Hola:

No os molesto más. Cierro el tema por mi parte y no os vuelvo a escribir sobre esto.

Si en algún momento os planteáis renovar la web de {{business_name}}, escribidme y lo vemos sin compromiso.

Suerte con el negocio.

Ander
Vanguard Tech
{{sender_email}}`,
  },
];

function ayuda() {
  console.log(`
Campaña de captación.

  npm run campaign -- --remitente TU@gmail.com    crea la campaña (en borrador)
  npm run campaign -- --activar                   la pone a enviar
  npm run campaign -- --pausar                    la para
  npm run campaign -- --inscribir                 añade los leads nuevos que encajen
  npm run campaign -- --estado                    cómo va

Opciones:
  --limite-diario 30     emails al día de esta campaña (por defecto 30)
  --puntuacion-max 60    considera "web mejorable" por debajo de esta nota
  --minimo-score 50      sólo leads del CRM con esta puntuación o más
`);
}

async function main() {
  if (flag('ayuda') || flag('help') || ARGS.length === 0) {
    ayuda();
    if (ARGS.length === 0) return;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurada. Ejecuta: npm run db:check');
    process.exitCode = 1;
    return;
  }

  const { and, eq, isNotNull, inArray, sql } = await import('drizzle-orm');
  const { db, pool } = await import('../src/db/client');
  const { leads, audits, campaigns, campaign_leads, email_accounts, emails } = await import(
    '../src/db/schema'
  );
  const { enrollLead } = await import('../src/lib/campaigns/sequences');
  const { emailStatus } = await import('../src/lib/config');

  const terminar = async (code = 0) => {
    process.exitCode = code;
    await pool.end();
  };

  // ---------------------------------------------------------------- estado
  const campanaExistente = async () =>
    db.query.campaigns.findFirst({ where: eq(campaigns.name, NOMBRE_CAMPANA) });

  if (flag('estado')) {
    const c = await campanaExistente();
    if (!c) {
      console.log('Todavía no hay campaña. Créala con --remitente TU@gmail.com');
      return terminar();
    }
    const inscritos = await db
      .select({ n: sql<number>`count(*)::int`, estado: campaign_leads.status })
      .from(campaign_leads)
      .where(eq(campaign_leads.campaign_id, c.id))
      .groupBy(campaign_leads.status);
    const correos = await db
      .select({ n: sql<number>`count(*)::int`, estado: emails.status })
      .from(emails)
      .where(eq(emails.campaign_id, c.id))
      .groupBy(emails.status);

    console.log(`Campaña    : ${c.name}`);
    console.log(`Estado     : ${c.status}`);
    console.log(`Límite/día : ${c.daily_limit}`);
    console.log('');
    console.log('Leads inscritos:');
    if (inscritos.length === 0) console.log('  (ninguno)');
    for (const r of inscritos) console.log(`  ${r.estado.padEnd(12)} ${r.n}`);
    console.log('');
    console.log('Emails:');
    if (correos.length === 0) console.log('  (ninguno todavía)');
    for (const r of correos) console.log(`  ${r.estado.padEnd(12)} ${r.n}`);
    console.log('');
    const smtp = emailStatus();
    console.log(`Envío      : ${smtp.status === 'CONFIGURED' ? 'configurado' : `NOT CONFIGURED — falta ${smtp.missing.join(', ')}`}`);
    return terminar();
  }

  // ------------------------------------------------------- activar/pausar
  if (flag('activar') || flag('pausar')) {
    const c = await campanaExistente();
    if (!c) {
      console.error('No hay campaña que activar. Créala primero con --remitente.');
      return terminar(1);
    }
    const nuevo = flag('activar') ? 'ACTIVE' : 'PAUSED';

    if (nuevo === 'ACTIVE') {
      const smtp = emailStatus();
      if (smtp.status !== 'CONFIGURED') {
        console.error('No activo la campaña: el envío no está configurado.');
        console.error(`Falta: ${smtp.missing.join(', ')}`);
        console.error('');
        console.error('Ponlas en .env.local. Para Gmail hace falta una contraseña de');
        console.error('aplicación (no la del correo): https://myaccount.google.com/apppasswords');
        console.error('');
        console.error('    SMTP_HOST=smtp.gmail.com');
        console.error('    SMTP_PORT=587');
        console.error('    SMTP_USER=tu@gmail.com');
        console.error('    SMTP_PASSWORD=la-contraseña-de-aplicación');
        return terminar(1);
      }
    }

    await db.update(campaigns).set({ status: nuevo, updated_at: new Date() }).where(eq(campaigns.id, c.id));
    console.log(`Campaña ${nuevo === 'ACTIVE' ? 'activada' : 'pausada'}.`);
    if (nuevo === 'ACTIVE') {
      console.log('');
      console.log('A partir de ahora el envío depende de los trabajos programados.');
      console.log('Si no los tienes puestos: ./sistema/iniciar.sh 7');
    }
    return terminar();
  }

  // --------------------------------------------------------------- crear
  const remitente = arg('remitente');
  const limiteDiario = Number(arg('limite-diario') ?? 30);
  const puntuacionMax = Number(arg('puntuacion-max') ?? 60);
  const minimoScore = Number(arg('minimo-score') ?? 50);

  let campana = await campanaExistente();

  if (!campana && !remitente) {
    console.error('Hace falta --remitente TU@gmail.com para crear la campaña.');
    return terminar(1);
  }

  if (remitente) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(remitente)) {
      console.error(`"${remitente}" no parece una dirección de correo.`);
      return terminar(1);
    }

    const existente = await db.query.email_accounts.findFirst({
      where: eq(email_accounts.email, remitente),
    });
    if (!existente) {
      await db.insert(email_accounts).values({
        email: remitente,
        name: 'Vanguard Tech',
        provider: 'smtp',
        is_active: true,
        daily_limit: Math.max(limiteDiario, 1),
        hourly_limit: Math.max(Math.ceil(limiteDiario / 4), 1),
      });
      console.log(`Cuenta de envío creada: ${remitente}`);
    }
  }

  const cuenta = remitente
    ? await db.query.email_accounts.findFirst({ where: eq(email_accounts.email, remitente) })
    : null;

  if (!campana) {
    const filas = await db
      .insert(campaigns)
      .values({
        name: NOMBRE_CAMPANA,
        description:
          'Negocios sin web, o con una web que falla en la auditoría. Tres pasos, con salida en cada uno.',
        target_filter: { sin_web_o_auditoria_por_debajo_de: puntuacionMax, minimo_score: minimoScore },
        sequence: SECUENCIA,
        email_account_id: cuenta?.id ?? null,
        daily_limit: limiteDiario,
        status: 'DRAFT',
      })
      .returning();
    campana = filas[0];
    console.log(`Campaña creada: ${campana.name} (en borrador)`);
  } else if (cuenta && campana.email_account_id !== cuenta.id) {
    await db
      .update(campaigns)
      .set({ email_account_id: cuenta.id, updated_at: new Date() })
      .where(eq(campaigns.id, campana.id));
    console.log('Remitente de la campaña actualizado.');
  }

  // ------------------------------------------------------------ inscribir
  // Sólo se inscribe a quien se puede escribir. Un lead sin email no entra
  // en una campaña de correo: es un lead de teléfono.
  const candidatos = await db
    .select({ id: leads.id, nombre: leads.business_name, web: leads.website, nota: audits.overall_score })
    .from(leads)
    .leftJoin(audits, eq(audits.lead_id, leads.id))
    .where(
      and(
        isNotNull(leads.email),
        inArray(leads.status, ['NEW', 'QUALIFIED', 'AUDIT_READY', 'AUDITED']),
        sql`${leads.score} >= ${minimoScore}`,
        sql`(${leads.website} IS NULL OR ${audits.overall_score} <= ${puntuacionMax})`,
      ),
    );

  const vistos = new Set<number>();
  let inscritos = 0;
  let yaEstaban = 0;
  for (const c of candidatos) {
    if (vistos.has(c.id)) continue;
    vistos.add(c.id);
    const nuevo = await enrollLead(campana.id, c.id);
    if (nuevo) inscritos++;
    else yaEstaban++;
  }

  const totalLeads = await db.select({ n: sql<number>`count(*)::int` }).from(leads);
  const conEmail = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(isNotNull(leads.email));

  console.log('');
  console.log('─'.repeat(52));
  console.log(`Leads en el CRM          : ${totalLeads[0].n}`);
  console.log(`  …con email             : ${conEmail[0].n}`);
  console.log(`  …que encajan y entran  : ${vistos.size}`);
  console.log('');
  console.log(`Inscritos ahora          : ${inscritos}`);
  console.log(`Ya estaban inscritos     : ${yaEstaban}`);
  console.log('');

  if (conEmail[0].n === 0 && totalLeads[0].n > 0) {
    console.log('Ninguno de tus leads tiene email todavía.');
    console.log('Los emails salen de las webs de los propios negocios, así que:');
    console.log('');
    console.log('    npm run audit:pending');
    console.log('');
    console.log('Un negocio sin web no tiene email en ninguna parte: ése es de teléfono.');
    console.log('');
  }

  console.log(`Estado de la campaña: ${campana.status}`);
  if (campana.status !== 'ACTIVE') {
    console.log('');
    console.log('Todavía NO envía nada. Cuando lo quieras:');
    console.log('');
    console.log('    npm run campaign -- --activar');
    console.log('');
  }

  await terminar();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
