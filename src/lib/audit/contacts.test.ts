import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractEmails, isPlausibleBusinessEmail } from './contacts';

const cargar = (html: string) => cheerio.load(html);

describe('isPlausibleBusinessEmail', () => {
  it('accepts an ordinary business address', () => {
    expect(isPlausibleBusinessEmail('hola@peluqueria.es')).toBe(true);
    expect(isPlausibleBusinessEmail('  Info@Gimnasio.COM ')).toBe(true);
  });

  it('rejects filenames the address regex would otherwise swallow', () => {
    expect(isPlausibleBusinessEmail('logo@2x.png')).toBe(false);
    expect(isPlausibleBusinessEmail('sprite@3x.svg')).toBe(false);
  });

  it('rejects placeholder domains', () => {
    expect(isPlausibleBusinessEmail('info@example.com')).toBe(false);
    expect(isPlausibleBusinessEmail('info@tudominio.es')).toBe(false);
  });

  it('rejects addresses nobody reads', () => {
    expect(isPlausibleBusinessEmail('noreply@tienda.es')).toBe(false);
    expect(isPlausibleBusinessEmail('postmaster@tienda.es')).toBe(false);
  });

  it('rejects platform and tooling addresses', () => {
    expect(isPlausibleBusinessEmail('a@sentry.io')).toBe(false);
    expect(isPlausibleBusinessEmail('x@build.wixpress.com')).toBe(false);
  });

  it('rejects tracking addresses with long hex local parts', () => {
    expect(isPlausibleBusinessEmail('0a1b2c3d4e5f6a7b@correo.es')).toBe(false);
  });

  it('rejects things that are not addresses at all', () => {
    expect(isPlausibleBusinessEmail('sin-arroba.es')).toBe(false);
    expect(isPlausibleBusinessEmail('dos@@arrobas.es')).toBe(false);
    expect(isPlausibleBusinessEmail('')).toBe(false);
  });
});

describe('extractEmails', () => {
  it('finds a mailto address', () => {
    const $ = cargar('<body><a href="mailto:hola@peluqueria.es">Escríbenos</a></body>');
    expect(extractEmails($, 'https://peluqueria.es/')).toEqual(['hola@peluqueria.es']);
  });

  it('finds an address written in the page text', () => {
    const $ = cargar('<body><p>Contacto: reservas@gimnasio.es</p></body>');
    expect(extractEmails($, 'https://gimnasio.es/')).toEqual(['reservas@gimnasio.es']);
  });

  it('prefers an address on the site own domain over a webmail one', () => {
    const $ = cargar(
      '<body><p>viejo@gmail.com</p><a href="mailto:info@clinica.es">info</a></body>',
    );
    expect(extractEmails($, 'https://clinica.es/')[0]).toBe('info@clinica.es');
  });

  it('prefers a mailto link over a loose mention on the same footing', () => {
    const $ = cargar(
      '<body><p>proveedor@otra.com</p><a href="mailto:cliente@otra.com">esc</a></body>',
    );
    expect(extractEmails($, 'https://sinrelacion.es/')[0]).toBe('cliente@otra.com');
  });

  it('ignores addresses inside scripts', () => {
    const $ = cargar(
      '<body><script>var dsn="abc@sentry.io"; var t="oculto@analitica.com";</script></body>',
    );
    expect(extractEmails($, 'https://tienda.es/')).toEqual([]);
  });

  it('returns nothing when the page publishes nothing', () => {
    const $ = cargar('<body><p>Llámanos al 976 000 000</p></body>');
    expect(extractEmails($, 'https://tienda.es/')).toEqual([]);
  });

  it('deduplicates the same address found twice', () => {
    const $ = cargar(
      '<body><a href="mailto:info@bar.es">a</a><p>info@bar.es</p></body>',
    );
    expect(extractEmails($, 'https://bar.es/')).toEqual(['info@bar.es']);
  });

  it('strips a mailto subject parameter', () => {
    const $ = cargar('<body><a href="mailto:info@bar.es?subject=Hola%20a%20todos">a</a></body>');
    expect(extractEmails($, 'https://bar.es/')).toEqual(['info@bar.es']);
  });

  it('caps how many it returns', () => {
    const cuerpo = Array.from({ length: 12 }, (_, i) => `<p>p${i}@sitio.es</p>`).join('');
    expect(extractEmails(cargar(`<body>${cuerpo}</body>`), 'https://sitio.es/', 3)).toHaveLength(3);
  });

  it('survives a page url that is not parseable', () => {
    const $ = cargar('<body><a href="mailto:info@bar.es">a</a></body>');
    expect(extractEmails($, 'no-es-una-url')).toEqual(['info@bar.es']);
  });
});
