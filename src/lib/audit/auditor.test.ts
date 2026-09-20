import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { auditWebsite, scoreChecks, overallStatus } from './auditor';
import type { CheckResult, CheckStatus } from './types';

/**
 * Serves fixture HTML over loopback so the checks run against a real HTTP
 * fetch and a real parse, without depending on any third-party site.
 */
const fixtures: Record<string, { body: string; contentType?: string; status?: number }> = {};
let server: http.Server;
let base = '';

function put(path: string, body: string, contentType = 'text/html; charset=utf-8') {
  fixtures[path] = { body, contentType };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const f = fixtures[path];
    if (!f) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(f.status ?? 200, { 'content-type': f.contentType ?? 'text/html' });
    res.end(f.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const byNumber = (checks: CheckResult[], n: number): CheckResult => {
  const c = checks.find((x) => x.check_number === n);
  if (!c) throw new Error(`check ${n} missing`);
  return c;
};

// A page that does close to everything right.
const GOOD_PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gimnasio Atlas Madrid — Entrenamiento personal</title>
  <meta name="description" content="Gimnasio Atlas en Madrid. Entrenamiento personal, clases dirigidas y sala de musculación abierta de lunes a domingo.">
  <link rel="canonical" href="https://atlas.example/">
  <meta property="og:title" content="Gimnasio Atlas Madrid">
  <meta property="og:description" content="Entrenamiento personal en Madrid">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Gym","name":"Gimnasio Atlas",
   "address":{"@type":"PostalAddress","streetAddress":"Calle Mayor 1","addressLocality":"Madrid"},
   "openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"Monday","opens":"07:00","closes":"22:00"}],
   "telephone":"+34 910 000 111"}
  </script>
</head>
<body>
  <header><nav><a href="/servicios">Servicios</a><a href="/contacto">Contacto</a></nav></header>
  <main>
    <h1>Gimnasio Atlas Madrid</h1>
    <h2>Servicios</h2>
    <ul><li>Entrenamiento personal</li><li>Clases dirigidas</li><li>Musculación</li><li>Nutrición</li><li>Fisioterapia</li></ul>
    <p>${'Entrenamos a personas de todos los niveles en el centro de Madrid. '.repeat(20)}</p>
    <img src="/a.jpg" alt="Sala de musculación">
    <img src="/b.jpg" alt="Clase dirigida">
    <a href="tel:+34910000111">Llamar ahora</a>
    <a href="mailto:hola@atlas.example">Escríbenos</a>
    <form action="/contacto"><input name="email"><button type="submit">Solicitar información</button></form>
  </main>
  <footer><address>Calle Mayor 1, Madrid</address></footer>
</body></html>`;

// A page that fails nearly everything.
const BAD_PAGE = `<html><body>
  <div>Bienvenido</div>
  <img src="x.jpg">
</body></html>`;

describe('auditWebsite — a well-built page', () => {
  let checks: CheckResult[];

  beforeAll(async () => {
    put('/good', GOOD_PAGE);
    const res = await auditWebsite(`${base}/good`, {
      business_name: 'Gimnasio Atlas',
      phone: '+34 910 000 111',
      city: 'Madrid',
    });
    checks = res.checks;
  });

  it('returns exactly 13 checks in order', () => {
    expect(checks).toHaveLength(13);
    expect(checks.map((c) => c.check_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('passes the mobile viewport check', () => {
    expect(byNumber(checks, 1).status).toBe('PASS');
  });

  it('passes visual structure with one h1 and landmarks', () => {
    expect(byNumber(checks, 4).status).toBe('PASS');
  });

  it('finds the call to action', () => {
    expect(byNumber(checks, 5).status).toBe('PASS');
  });

  it('finds the tel: link', () => {
    const c = byNumber(checks, 6);
    expect(c.status).toBe('PASS');
    expect(c.evidence).toContain('tel:');
  });

  it('reads opening hours from JSON-LD', () => {
    expect(byNumber(checks, 7).status).toBe('PASS');
  });

  it('finds the services section', () => {
    expect(byNumber(checks, 8).status).toBe('PASS');
  });

  it('reads the address from JSON-LD', () => {
    expect(byNumber(checks, 9).status).toBe('PASS');
  });

  it('counts multiple contact channels', () => {
    expect(byNumber(checks, 10).status).toBe('PASS');
  });

  it('passes basic SEO', () => {
    expect(byNumber(checks, 11).status).toBe('PASS');
  });

  it('passes image and content quality', () => {
    expect(byNumber(checks, 12).status).toBe('PASS');
  });

  it('confirms name, phone and city all appear on the page', () => {
    const c = byNumber(checks, 13);
    expect(c.status).toBe('PASS');
    expect(c.evidence).toContain('Not found: none');
  });
});

describe('auditWebsite — a neglected page', () => {
  let checks: CheckResult[];

  beforeAll(async () => {
    put('/bad', BAD_PAGE);
    const res = await auditWebsite(`${base}/bad`, {});
    checks = res.checks;
  });

  it('fails the mobile viewport check', () => {
    const c = byNumber(checks, 1);
    expect(c.status).toBe('FAIL');
    expect(c.problem).toBeTruthy();
    expect(c.impact).toBeTruthy();
    expect(c.priority).toBe('critical');
  });

  it('fails visual structure when there is no h1', () => {
    expect(byNumber(checks, 4).status).toBe('FAIL');
  });

  it('fails the CTA check', () => {
    expect(byNumber(checks, 5).status).toBe('FAIL');
  });

  it('fails click-to-call when no number appears at all', () => {
    expect(byNumber(checks, 6).status).toBe('FAIL');
  });

  it('fails contactability', () => {
    expect(byNumber(checks, 10).status).toBe('FAIL');
  });

  it('fails basic SEO with no title or description', () => {
    expect(byNumber(checks, 11).status).toBe('FAIL');
  });

  it('marks local consistency NOT_VERIFIED when nothing is on record', () => {
    const c = byNumber(checks, 13);
    expect(c.status).toBe('NOT_VERIFIED');
    expect(c.problem).toBeNull();
  });

  it('never reports a problem on a passing check', () => {
    for (const c of checks) {
      if (c.status === 'PASS') expect(c.problem).toBeNull();
    }
  });
});

describe('auditWebsite — partial signals', () => {
  it('warns rather than fails when a phone is printed but not linked', async () => {
    put(
      '/printed-phone',
      `<html><head><meta name="viewport" content="width=device-width"></head>
       <body><h1>Bar</h1><p>Llámanos al 910 000 111</p></body></html>`,
    );
    const res = await auditWebsite(`${base}/printed-phone`, {});
    const c = byNumber(res.checks, 6);
    expect(c.status).toBe('WARNING');
    expect(c.evidence).toContain('910');
  });

  it('warns when the name matches but the phone does not', async () => {
    put('/partial-nap', `<html><body><h1>Gimnasio Atlas</h1><p>Madrid</p></body></html>`);
    const res = await auditWebsite(`${base}/partial-nap`, {
      business_name: 'Gimnasio Atlas',
      phone: '+34 999 888 777',
      city: 'Madrid',
    });
    const c = byNumber(res.checks, 13);
    expect(c.status).toBe('WARNING');
    expect(c.evidence).toContain('999 888 777');
  });

  it('ignores phone formatting differences when comparing', async () => {
    put('/nap-format', `<html><body><h1>Atlas</h1><p>Tel: 910-000-111</p></body></html>`);
    const res = await auditWebsite(`${base}/nap-format`, {
      business_name: 'Atlas',
      phone: '+34 910 000 111',
    });
    expect(byNumber(res.checks, 13).status).toBe('PASS');
  });
});

describe('auditWebsite — unreachable sites are never guessed at', () => {
  it('marks every check NOT_VERIFIED when the host does not resolve', async () => {
    const res = await auditWebsite('https://this-host-does-not-exist.invalid');
    expect(res.fetch_error).toBeTruthy();
    expect(res.overall_status).toBe('NOT_VERIFIED');
    expect(res.overall_score).toBe(0);
    expect(res.checks).toHaveLength(13);
    expect(res.checks.every((c) => c.status === 'NOT_VERIFIED')).toBe(true);
    expect(res.checks.every((c) => c.problem === null)).toBe(true);
  });

  it('rejects a malformed URL without attempting a fetch', async () => {
    const res = await auditWebsite('not a url at all');
    expect(res.fetch_error).toContain('Not a usable URL');
    expect(res.checks.every((c) => c.status === 'NOT_VERIFIED')).toBe(true);
  });

  it('marks a non-HTML response NOT_VERIFIED rather than auditing it', async () => {
    fixtures['/json'] = { body: '{"a":1}', contentType: 'application/json' };
    const res = await auditWebsite(`${base}/json`);
    expect(res.fetch_error).toContain('not HTML');
    expect(res.overall_status).toBe('NOT_VERIFIED');
  });
});

describe('scoring', () => {
  const mk = (status: CheckStatus): CheckResult => ({
    check_number: 1,
    check_name: 'x',
    status,
    evidence: null,
    problem: null,
    impact: null,
    priority: null,
    checked_at: new Date(),
  });

  it('scores only verified checks', () => {
    expect(scoreChecks([mk('PASS'), mk('NOT_VERIFIED')])).toBe(100);
  });

  it('returns 0 when nothing is verified', () => {
    expect(scoreChecks([mk('NOT_VERIFIED')])).toBe(0);
    expect(overallStatus([mk('NOT_VERIFIED')])).toBe('NOT_VERIFIED');
  });

  it('weights WARNING at half of PASS', () => {
    expect(scoreChecks([mk('PASS'), mk('FAIL')])).toBe(50);
    expect(scoreChecks([mk('WARNING'), mk('WARNING')])).toBe(50);
  });

  it('reports FAIL over WARNING in the overall status', () => {
    expect(overallStatus([mk('PASS'), mk('WARNING'), mk('FAIL')])).toBe('FAIL');
    expect(overallStatus([mk('PASS'), mk('WARNING')])).toBe('WARNING');
    expect(overallStatus([mk('PASS')])).toBe('PASS');
  });
});
