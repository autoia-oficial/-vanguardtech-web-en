import type { CheerioAPI } from 'cheerio';

/**
 * Pulls contact email addresses out of a page the auditor already fetched.
 *
 * Without this there is no campaign: OpenStreetMap almost never records an
 * email, so for a business that has a website the site itself is the only
 * honest source of one. Nothing here guesses an address — it reads what is
 * published on the page, and returns nothing when the page publishes nothing.
 *
 * (A business with no website therefore has no email to find. That is a real
 * limit of the data, not a gap to paper over: those leads are phone leads.)
 */

/** Dominios que pertenecen a una herramienta, no al negocio. */
const DOMINIOS_RUIDO = [
  'sentry.io', 'wixpress.com', 'squarespace.com', 'godaddy.com',
  'wordpress.com', 'shopify.com', 'cloudflare.com', 'schema.org',
  'w3.org', 'jquery.com', 'googleapis.com', 'gstatic.com', 'email.com',
];

/**
 * Palabras que delatan un dominio de relleno. Se comparan contra la primera
 * etiqueta del dominio, no contra el dominio entero: la plantilla puede venir
 * como tudominio.es, tudominio.com o yourdomain.co.uk.
 */
const PLACEHOLDERS = [
  'example', 'ejemplo', 'domain', 'yourdomain', 'tudominio', 'dominio',
  'midominio', 'mydomain', 'tuempresa', 'yourcompany',
];

/** Local parts that are never a person or a business inbox. */
const LOCAL_RUIDO = ['noreply', 'no-reply', 'donotreply', 'postmaster', 'abuse', 'mailer-daemon'];

/** Extensions that show up when a filename gets caught by the address regex. */
const EXTENSIONES = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|eot|mp4|pdf)$/i;

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;

export function isPlausibleBusinessEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email)) return false;
  if (EXTENSIONES.test(email)) return false;

  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.length > 64 || email.length > 254) return false;
  if (LOCAL_RUIDO.includes(local)) return false;
  if (DOMINIOS_RUIDO.some((n) => domain === n || domain.endsWith(`.${n}`))) return false;
  if (PLACEHOLDERS.includes(domain.split('.')[0])) return false;
  // A long hex local part is a tracking address, not a person.
  if (/^[0-9a-f]{16,}$/.test(local)) return false;

  return true;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns the addresses found on the page, best first.
 *
 * An address on the site's own domain outranks a free webmail one, and a
 * mailto: link outranks an address that merely appears in the text — a link is
 * published as a contact point, whereas loose text may be quoting someone else.
 */
export function extractEmails($: CheerioAPI, pageUrl: string, max = 5): string[] {
  const dominio = hostOf(pageUrl);
  const puntuacion = new Map<string, number>();

  const anotar = (bruto: string, puntos: number) => {
    const email = bruto.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    if (!isPlausibleBusinessEmail(email)) return;
    puntuacion.set(email, Math.max(puntuacion.get(email) ?? 0, puntos));
  };

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) anotar(decodeURIComponent(href.slice(7)), 2);
  });

  // El texto visible, no el HTML entero: así no se cuelan direcciones que
  // viven en scripts de analítica o en comentarios.
  //
  // Se recorren los nodos de texto uno a uno y se unen con saltos de línea.
  // Un `.text()` a secas pega el texto de un enlace con el que viene detrás
  // ("a" + "info@bar.es" = "ainfo@bar.es") e inventa direcciones que no
  // existen — justo lo que no puede pasar aquí.
  const partes: string[] = [];
  $('body')
    .find('*')
    .addBack()
    .not('script, style, noscript, template')
    .contents()
    .each((_, node) => {
      if (node.type === 'text') partes.push(node.data ?? '');
    });
  for (const encontrado of partes.join('\n').match(RE_EMAIL) ?? []) anotar(encontrado, 1);

  return [...puntuacion.entries()]
    .sort((a, b) => {
      const dominioA = a[0].split('@')[1] === dominio ? 1 : 0;
      const dominioB = b[0].split('@')[1] === dominio ? 1 : 0;
      if (dominioA !== dominioB) return dominioB - dominioA;
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, max)
    .map(([email]) => email);
}
