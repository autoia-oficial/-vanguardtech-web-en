import type { CheerioAPI } from 'cheerio';
import type { FetchedPage } from './fetcher';
import type { CheckResult, CheckStatus, CheckPriority, LeadContext } from './types';
import { CHECK_NAMES } from './types';

interface Ctx {
  $: CheerioAPI;
  page: FetchedPage;
  lead: LeadContext;
  /** Result of probing the plain-http origin; undefined when not probed. */
  httpProbe?: { reachable: boolean; redirectsToHttps: boolean };
}

const result = (
  n: number,
  status: CheckStatus,
  evidence: string | null,
  problem: string | null = null,
  impact: string | null = null,
  priority: CheckPriority | null = null,
): CheckResult => ({
  check_number: n,
  check_name: CHECK_NAMES[n],
  status,
  evidence,
  problem,
  impact,
  priority,
  checked_at: new Date(),
});

const textOf = ($: CheerioAPI): string => $('body').text().replace(/\s+/g, ' ').trim();

/** Collects any JSON-LD blocks so structured-data checks read real markup. */
function jsonLdBlocks($: CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* malformed JSON-LD is simply not usable evidence */
    }
  });
  return out;
}

function jsonLdHas(blocks: unknown[], key: string): boolean {
  const visit = (node: unknown): boolean => {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(visit);
    const obj = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
    return Object.values(obj).some(visit);
  };
  return blocks.some(visit);
}

// 01 ---------------------------------------------------------------------
export function checkMobile({ $ }: Ctx): CheckResult {
  const viewport = $('meta[name="viewport"]').attr('content');
  if (!viewport) {
    return result(
      1,
      'FAIL',
      'No <meta name="viewport"> tag found.',
      'The page does not declare a mobile viewport, so phones render it at desktop width and zoom out.',
      'Most local searches happen on a phone. A page that renders zoomed-out loses the majority of visitors.',
      'critical',
    );
  }
  const hasDeviceWidth = /width\s*=\s*device-width/i.test(viewport);
  const blocksZoom = /user-scalable\s*=\s*no/i.test(viewport) || /maximum-scale\s*=\s*1/i.test(viewport);

  if (!hasDeviceWidth) {
    return result(
      1,
      'FAIL',
      `Viewport present but not device-width: "${viewport}"`,
      'The viewport is fixed rather than following the device width.',
      'The layout will not adapt to phones.',
      'high',
    );
  }
  if (blocksZoom) {
    return result(
      1,
      'WARNING',
      `Viewport: "${viewport}"`,
      'Zoom is disabled, which blocks users who need to enlarge text.',
      'Accessibility problem and a minor ranking signal.',
      'low',
    );
  }
  return result(1, 'PASS', `Viewport: "${viewport}"`);
}

// 02 ---------------------------------------------------------------------
export function checkHttps({ page, httpProbe }: Ctx): CheckResult {
  if (!page.https) {
    return result(
      2,
      'FAIL',
      `Final URL after redirects is not TLS: ${page.finalUrl}`,
      'The site is served over plain HTTP.',
      'Browsers label the site "Not secure", which deters visitors and suppresses rankings.',
      'critical',
    );
  }
  if (httpProbe?.reachable && !httpProbe.redirectsToHttps) {
    return result(
      2,
      'WARNING',
      `HTTPS works, but http:// stays on http:// (no redirect).`,
      'Plain HTTP is reachable and is not redirected to HTTPS.',
      'Visitors on old links stay on an insecure version of the site.',
      'medium',
    );
  }
  return result(2, 'PASS', `Served over HTTPS (${page.finalUrl}).`);
}

// 03 ---------------------------------------------------------------------
export function checkPerformance({ $, page }: Ctx): CheckResult {
  const blockingScripts = $('head script[src]').filter((_, el) => {
    const e = $(el);
    return !e.attr('async') && !e.attr('defer');
  }).length;
  const stylesheets = $('link[rel="stylesheet"]').length;
  const kb = Math.round(page.bytes / 1024);

  const evidence =
    `HTML document ${kb} KB, fetched in ${page.elapsedMs} ms; ` +
    `${blockingScripts} render-blocking script(s) in <head>, ${stylesheets} stylesheet(s). ` +
    `Measured for the HTML document only — images and sub-resources are not included.`;

  const slow = page.elapsedMs > 2500;
  const heavy = kb > 500;

  if (slow || heavy || blockingScripts > 3) {
    const problems: string[] = [];
    if (slow) problems.push(`the document took ${page.elapsedMs} ms to arrive`);
    if (heavy) problems.push(`the HTML alone is ${kb} KB`);
    if (blockingScripts > 3) problems.push(`${blockingScripts} scripts block first render`);
    return result(
      3,
      slow && heavy ? 'FAIL' : 'WARNING',
      evidence,
      `Slow first paint is likely: ${problems.join('; ')}.`,
      'Every extra second of load time measurably increases bounce rate on mobile connections.',
      slow && heavy ? 'high' : 'medium',
    );
  }
  return result(3, 'PASS', evidence);
}

// 04 ---------------------------------------------------------------------
export function checkVisualStructure({ $ }: Ctx): CheckResult {
  const h1 = $('h1');
  const landmarks = ['header', 'nav', 'main', 'footer'].filter((t) => $(t).length > 0);
  const headings = $('h1,h2,h3').length;

  const evidence = `${h1.length} <h1>, ${headings} headings total, landmarks present: ${
    landmarks.length ? landmarks.join(', ') : 'none'
  }.`;

  if (h1.length === 0) {
    return result(
      4,
      'FAIL',
      evidence,
      'The page has no <h1>, so there is no single stated subject.',
      'Visitors and search engines cannot tell at a glance what the business does.',
      'high',
    );
  }
  if (h1.length > 1 || landmarks.length < 2) {
    return result(
      4,
      'WARNING',
      evidence,
      h1.length > 1
        ? `${h1.length} <h1> elements compete for the page's subject.`
        : 'Few semantic landmarks, suggesting a visually-styled rather than structured page.',
      'Weaker hierarchy makes the page harder to scan and to index.',
      'medium',
    );
  }
  return result(4, 'PASS', evidence);
}

// 05 ---------------------------------------------------------------------
const CTA_WORDS =
  /(contact|contacto|book|reserva|reservar|quote|presupuesto|call|llamar|appointment|cita|get in touch|escríbenos|solicitar|pedir)/i;

export function checkCta({ $ }: Ctx): CheckResult {
  const candidates: string[] = [];
  $('a,button,input[type="submit"]').each((_, el) => {
    const e = $(el);
    const label = (e.text() || e.attr('value') || e.attr('aria-label') || '').replace(/\s+/g, ' ').trim();
    const href = e.attr('href') ?? '';
    if (CTA_WORDS.test(label) || CTA_WORDS.test(href)) {
      if (label) candidates.push(label.slice(0, 60));
    }
  });
  const forms = $('form').length;
  const unique = Array.from(new Set(candidates));

  const evidence = unique.length
    ? `Action elements found: ${unique.slice(0, 5).map((c) => `"${c}"`).join(', ')}${
        unique.length > 5 ? ` (+${unique.length - 5} more)` : ''
      }. Forms on page: ${forms}.`
    : `No action-labelled links or buttons found. Forms on page: ${forms}.`;

  if (unique.length === 0 && forms === 0) {
    return result(
      5,
      'FAIL',
      evidence,
      'There is no visible call to action anywhere on the page.',
      'Visitors who are ready to buy have nothing to click, so interest does not convert into contact.',
      'critical',
    );
  }
  if (unique.length === 0) {
    return result(
      5,
      'WARNING',
      evidence,
      'A form exists but no clearly labelled call to action points to it.',
      'Conversion depends on visitors finding the form unaided.',
      'medium',
    );
  }
  return result(5, 'PASS', evidence);
}

// 06 ---------------------------------------------------------------------
export function checkClickToCall({ $ }: Ctx): CheckResult {
  const telLinks: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) telLinks.push(href);
  });

  if (telLinks.length > 0) {
    return result(6, 'PASS', `${telLinks.length} tel: link(s): ${Array.from(new Set(telLinks)).slice(0, 3).join(', ')}`);
  }

  // A number printed as plain text is still a number, but it is not tappable.
  const body = textOf($);
  const printed = body.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (printed) {
    return result(
      6,
      'WARNING',
      `No tel: link, but a phone-shaped string appears in the text: "${printed[1].trim().slice(0, 30)}"`,
      'The phone number is not a tappable link.',
      'On a phone the visitor must copy the number by hand, which loses a share of calls.',
      'medium',
    );
  }
  return result(
    6,
    'FAIL',
    'No tel: link and no phone-shaped text found on the page.',
    'There is no phone number to call from the page.',
    'Local businesses convert primarily by phone; without a number that path is closed.',
    'high',
  );
}

// 07 ---------------------------------------------------------------------
const DAY_WORDS =
  /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)/i;

export function checkOpeningHours({ $ }: Ctx): CheckResult {
  const blocks = jsonLdBlocks($);
  if (jsonLdHas(blocks, 'openingHours') || jsonLdHas(blocks, 'openingHoursSpecification')) {
    return result(7, 'PASS', 'Opening hours declared in JSON-LD structured data.');
  }

  const body = textOf($);
  const hasDay = DAY_WORDS.test(body);
  const hasTime = /\b\d{1,2}[:.]\d{2}\b/.test(body) || /\b\d{1,2}\s?(am|pm)\b/i.test(body);

  if (hasDay && hasTime) {
    return result(
      7,
      'WARNING',
      'Day names and clock times appear in the page text, but there is no structured openingHours markup.',
      'Hours are human-readable only; search engines cannot read them reliably.',
      'Google may not show opening hours in results, and "open now" searches can skip the business.',
      'medium',
    );
  }
  if (hasDay || hasTime) {
    return result(
      7,
      'WARNING',
      `Partial signal only (${hasDay ? 'day names' : 'clock times'} present, the other absent).`,
      'Opening hours appear incomplete.',
      'Visitors cannot tell when the business is open.',
      'medium',
    );
  }
  return result(
    7,
    'FAIL',
    'No opening-hours markup and no day/time text found on the page.',
    'Opening hours are not published.',
    'Customers who cannot confirm opening times frequently choose a competitor instead.',
    'medium',
  );
}

// 08 ---------------------------------------------------------------------
const SERVICE_WORDS =
  /(services|servicios|treatments|tratamientos|products|productos|what we do|precios|pricing|menu|carta|tarifas)/i;

export function checkServices({ $ }: Ctx): CheckResult {
  const headings: string[] = [];
  $('h1,h2,h3').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (SERVICE_WORDS.test(t)) headings.push(t.slice(0, 60));
  });
  const navLinks: string[] = [];
  $('nav a, header a').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (SERVICE_WORDS.test(t)) navLinks.push(t.slice(0, 40));
  });

  if (headings.length || navLinks.length) {
    const parts = [
      headings.length ? `headings: ${headings.slice(0, 3).join(' | ')}` : '',
      navLinks.length ? `nav links: ${navLinks.slice(0, 3).join(' | ')}` : '',
    ].filter(Boolean);
    return result(8, 'PASS', `Service/offer sections found (${parts.join('; ')}).`);
  }

  const listItems = $('ul li, ol li').length;
  if (listItems >= 5) {
    return result(
      8,
      'WARNING',
      `No section labelled as services, but the page contains ${listItems} list items that may describe the offer.`,
      'What the business offers is not labelled explicitly.',
      'Visitors must infer the offer, and search engines have nothing specific to match against.',
      'medium',
    );
  }
  return result(
    8,
    'FAIL',
    'No services/products section and no substantial list content found.',
    'The page does not state what the business offers.',
    'Visitors cannot tell whether the business does what they need.',
    'high',
  );
}

// 09 ---------------------------------------------------------------------
export function checkLocation({ $ }: Ctx): CheckResult {
  const blocks = jsonLdBlocks($);
  if (jsonLdHas(blocks, 'address') || jsonLdHas(blocks, 'geo')) {
    return result(9, 'PASS', 'Address/geo present in JSON-LD structured data.');
  }
  const mapEmbed = $('iframe[src*="google.com/maps"], iframe[src*="openstreetmap"]').length;
  if (mapEmbed > 0) {
    return result(9, 'PASS', `${mapEmbed} embedded map frame(s) found.`);
  }
  const mapLink = $('a[href*="google.com/maps"], a[href*="maps.app.goo.gl"], a[href*="goo.gl/maps"]').length;
  const hasAddressTag = $('address').length > 0;

  if (mapLink > 0 || hasAddressTag) {
    return result(
      9,
      'WARNING',
      `${mapLink} map link(s), ${hasAddressTag ? 'an <address> element present' : 'no <address> element'}; no structured address markup.`,
      'The location is stated but not machine-readable.',
      'Weakens local search visibility for "near me" queries.',
      'medium',
    );
  }
  return result(
    9,
    'FAIL',
    'No structured address, no map embed, no map link and no <address> element.',
    'The page does not say where the business is.',
    'A local business that does not publish its location cannot be found by people nearby.',
    'high',
  );
}

// 10 --------------------------------------------------------------------
export function checkContactability({ $ }: Ctx): CheckResult {
  const tel = $('a[href^="tel:"]').length;
  const mailto = $('a[href^="mailto:"]').length;
  const whatsapp = $('a[href*="wa.me"], a[href*="whatsapp.com"]').length;
  const forms = $('form').length;

  const channels = [
    tel > 0 ? 'phone link' : null,
    mailto > 0 ? 'email link' : null,
    whatsapp > 0 ? 'WhatsApp' : null,
    forms > 0 ? 'contact form' : null,
  ].filter(Boolean) as string[];

  const evidence = channels.length
    ? `Reachable via: ${channels.join(', ')}.`
    : 'No phone link, email link, WhatsApp link or form found.';

  if (channels.length === 0) {
    return result(
      10,
      'FAIL',
      evidence,
      'There is no way to contact the business from this page.',
      'Interested visitors have no path to enquire, so traffic cannot become revenue.',
      'critical',
    );
  }
  if (channels.length === 1) {
    return result(
      10,
      'WARNING',
      evidence,
      'Only one contact channel is offered.',
      'Visitors who prefer another channel may not get in touch at all.',
      'medium',
    );
  }
  return result(10, 'PASS', evidence);
}

// 11 --------------------------------------------------------------------
export function checkBasicSeo({ $ }: Ctx): CheckResult {
  const title = $('head title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? '';
  const lang = $('html').attr('lang')?.trim() ?? '';
  const og = $('meta[property^="og:"]').length;

  const problems: string[] = [];
  if (!title) problems.push('no <title>');
  else if (title.length < 10) problems.push(`<title> is only ${title.length} characters`);
  else if (title.length > 65) problems.push(`<title> is ${title.length} characters and will be truncated`);
  if (!desc) problems.push('no meta description');
  else if (desc.length < 50) problems.push(`meta description is only ${desc.length} characters`);
  if (!canonical) problems.push('no canonical URL');
  if (!lang) problems.push('no lang attribute on <html>');
  if (og === 0) problems.push('no Open Graph tags');

  const evidence =
    `title: ${title ? `"${title.slice(0, 70)}" (${title.length} chars)` : 'missing'}; ` +
    `description: ${desc ? `${desc.length} chars` : 'missing'}; ` +
    `canonical: ${canonical ? 'present' : 'missing'}; lang: ${lang || 'missing'}; ` +
    `${og} Open Graph tag(s).`;

  if (!title || !desc) {
    return result(
      11,
      'FAIL',
      evidence,
      `Core SEO tags are missing: ${problems.join(', ')}.`,
      'Without a title and description the search result is auto-generated and far less likely to be clicked.',
      'high',
    );
  }
  if (problems.length > 0) {
    return result(
      11,
      'WARNING',
      evidence,
      `Incomplete SEO metadata: ${problems.join(', ')}.`,
      'Leaves ranking and click-through performance on the table.',
      'medium',
    );
  }
  return result(11, 'PASS', evidence);
}

// 12 --------------------------------------------------------------------
export function checkImagesContent({ $ }: Ctx): CheckResult {
  const imgs = $('img');
  const total = imgs.length;
  let withAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (typeof alt === 'string' && alt.trim().length > 0) withAlt++;
  });
  const words = textOf($).split(/\s+/).filter(Boolean).length;

  const evidence = `${total} image(s), ${withAlt} with a non-empty alt attribute; approximately ${words} words of visible text.`;

  if (total === 0 && words < 100) {
    return result(
      12,
      'FAIL',
      evidence,
      'The page has almost no content: no images and very little text.',
      'There is nothing to rank for and nothing to persuade a visitor with.',
      'high',
    );
  }
  const altRatio = total === 0 ? 1 : withAlt / total;
  const thin = words < 250;

  if (altRatio < 0.5 || thin) {
    const problems: string[] = [];
    if (altRatio < 0.5) problems.push(`only ${withAlt} of ${total} images have alt text`);
    if (thin) problems.push(`only ~${words} words of text`);
    return result(
      12,
      'WARNING',
      evidence,
      `Content quality issues: ${problems.join('; ')}.`,
      'Thin content ranks poorly and missing alt text excludes screen-reader users.',
      'medium',
    );
  }
  return result(12, 'PASS', evidence);
}

// 13 --------------------------------------------------------------------
const digits = (s: string): string => s.replace(/\D/g, '');

export function checkLocalConsistency({ $, lead }: Ctx): CheckResult {
  const known = [lead.business_name, lead.phone, lead.city].filter(Boolean);
  if (known.length === 0) {
    return result(
      13,
      'NOT_VERIFIED',
      'No business name, phone or city on record to compare the page against.',
      null,
      null,
      null,
    );
  }

  const body = textOf($).toLowerCase();
  // A number reachable only through a tel: link or structured data is still
  // published on the page, so gather those alongside the visible text.
  const telHrefs: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) telHrefs.push(href);
  });
  const structuredPhones = jsonLdBlocks($)
    .map((b) => JSON.stringify(b))
    .join(' ');
  const phoneHaystack = digits(textOf($) + ' ' + telHrefs.join(' ') + ' ' + structuredPhones);

  const matched: string[] = [];
  const missing: string[] = [];

  if (lead.business_name) {
    const name = lead.business_name.toLowerCase().trim();
    (body.includes(name) ? matched : missing).push(`name "${lead.business_name}"`);
  }
  if (lead.phone) {
    const p = digits(lead.phone);
    // Compare the last 9 digits so formatting and country prefixes do not matter.
    const tail = p.slice(-9);
    (tail.length >= 7 && phoneHaystack.includes(tail) ? matched : missing).push(`phone "${lead.phone}"`);
  }
  if (lead.city) {
    const c = lead.city.toLowerCase().trim();
    (body.includes(c) ? matched : missing).push(`city "${lead.city}"`);
  }

  const evidence = `On record: ${known.length} field(s). Found on page: ${
    matched.length ? matched.join(', ') : 'none'
  }. Not found: ${missing.length ? missing.join(', ') : 'none'}.`;

  if (missing.length === 0) {
    return result(13, 'PASS', evidence);
  }
  if (matched.length === 0) {
    return result(
      13,
      'FAIL',
      evidence,
      'None of the details on record appear on the site.',
      'Inconsistent name/address/phone across listings splits local ranking signals and confuses customers.',
      'high',
    );
  }
  return result(
    13,
    'WARNING',
    evidence,
    `Some details on record do not appear on the site: ${missing.join(', ')}.`,
    'Partial NAP mismatches weaken local search confidence.',
    'medium',
  );
}

export const ALL_CHECKS: Array<(ctx: Ctx) => CheckResult> = [
  checkMobile,
  checkHttps,
  checkPerformance,
  checkVisualStructure,
  checkCta,
  checkClickToCall,
  checkOpeningHours,
  checkServices,
  checkLocation,
  checkContactability,
  checkBasicSeo,
  checkImagesContent,
  checkLocalConsistency,
];

export type { Ctx as CheckContext };
