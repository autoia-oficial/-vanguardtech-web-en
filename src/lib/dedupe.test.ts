import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '@/db/client';
import {
  normalizeEmail,
  normalizePhone,
  normalizeDomain,
  normalizeName,
  findDuplicateLead,
  findDuplicateGroups,
} from './dedupe';
import { resetDatabase, makeLead } from '@/test/helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe('normalisation', () => {
  it('lowercases and trims emails, rejecting non-addresses', () => {
    expect(normalizeEmail('  Owner@Shop.COM ')).toBe('owner@shop.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it('compares phones on their last nine digits', () => {
    expect(normalizePhone('+34 910 000 111')).toBe('910000111');
    expect(normalizePhone('910-000-111')).toBe('910000111');
    expect(normalizePhone('0034910000111')).toBe('910000111');
    expect(normalizePhone('123')).toBeNull();
  });

  it('strips scheme, www, path and query from domains', () => {
    expect(normalizeDomain('https://www.Atlas.com/pricing?a=1')).toBe('atlas.com');
    expect(normalizeDomain('atlas.com')).toBe('atlas.com');
    expect(normalizeDomain('http://atlas.com#x')).toBe('atlas.com');
    expect(normalizeDomain('notadomain')).toBeNull();
  });

  it('folds accents and punctuation in names', () => {
    expect(normalizeName('  Gimnàsio  Atlas! ')).toBe('gimnasio atlas');
    expect(normalizeName('Café-Bar')).toBe('cafe bar');
    expect(normalizeName('   ')).toBeNull();
  });
});

describe('findDuplicateLead', () => {
  it('finds nothing in an empty database', async () => {
    expect(await findDuplicateLead({ email: 'a@b.com' })).toBeNull();
  });

  it('matches on email regardless of case', async () => {
    const lead = await makeLead({ email: 'owner@shop.example' });
    const hit = await findDuplicateLead({ email: 'OWNER@SHOP.EXAMPLE' });
    expect(hit).toEqual({ lead_id: lead.id, matched_on: 'email' });
  });

  it('matches on phone regardless of formatting', async () => {
    const lead = await makeLead({ email: null, phone: '+34 910 000 111' });
    const hit = await findDuplicateLead({ phone: '910-000-111' });
    expect(hit?.lead_id).toBe(lead.id);
    expect(hit?.matched_on).toBe('phone');
  });

  it('matches on website ignoring scheme and www', async () => {
    const lead = await makeLead({ email: null, website: 'https://www.atlas.example/home' });
    const hit = await findDuplicateLead({ website: 'atlas.example' });
    expect(hit?.lead_id).toBe(lead.id);
    expect(hit?.matched_on).toBe('website');
  });

  it('matches on google_url', async () => {
    const lead = await makeLead({ email: null, google_url: 'https://maps.example/place/1' });
    const hit = await findDuplicateLead({ google_url: 'https://maps.example/place/1' });
    expect(hit?.lead_id).toBe(lead.id);
    expect(hit?.matched_on).toBe('google_url');
  });

  it('matches on name plus city when nothing else is known', async () => {
    const lead = await makeLead({ email: null, business_name: 'Gimnasio Atlas', city: 'Madrid' });
    const hit = await findDuplicateLead({ business_name: 'gimnasio  atlas', city: 'MADRID' });
    expect(hit?.lead_id).toBe(lead.id);
    expect(hit?.matched_on).toBe('name+city');
  });

  it('does not match on name alone when the city differs', async () => {
    await makeLead({ email: null, business_name: 'Atlas', city: 'Madrid' });
    expect(await findDuplicateLead({ business_name: 'Atlas', city: 'Barcelona' })).toBeNull();
  });

  it('prefers the source identity when present', async () => {
    const lead = await makeLead({ email: null, dedupe_key: 'openstreetmap:node/1' });
    const hit = await findDuplicateLead({ dedupe_key: 'openstreetmap:node/1' });
    expect(hit).toEqual({ lead_id: lead.id, matched_on: 'dedupe_key' });
  });

  it('treats two genuinely different businesses as distinct', async () => {
    await makeLead({ business_name: 'Atlas', city: 'Madrid', email: 'a@atlas.example', phone: '+34910000111' });
    const hit = await findDuplicateLead({
      business_name: 'Olympus',
      city: 'Barcelona',
      email: 'b@olympus.example',
      phone: '+34922222222',
    });
    expect(hit).toBeNull();
  });
});

describe('findDuplicateGroups', () => {
  it('reports nothing when every lead is distinct', async () => {
    await makeLead({ business_name: 'A', email: 'a@x.example' });
    await makeLead({ business_name: 'B', email: 'b@x.example' });
    expect(await findDuplicateGroups()).toHaveLength(0);
  });

  it('groups leads sharing an email', async () => {
    const a = await makeLead({ business_name: 'A', email: 'same@x.example' });
    const b = await makeLead({ business_name: 'B', email: 'SAME@x.example' });
    const groups = await findDuplicateGroups();
    const emailGroup = groups.find((g) => g.matched_on === 'email');
    expect(emailGroup?.lead_ids).toEqual([a.id, b.id].sort((x, y) => x - y));
  });

  it('groups leads sharing a website across formats', async () => {
    await makeLead({ business_name: 'A', email: 'a@x.example', website: 'https://www.same.example' });
    await makeLead({ business_name: 'B', email: 'b@x.example', website: 'same.example/page' });
    const groups = await findDuplicateGroups();
    expect(groups.some((g) => g.matched_on === 'website')).toBe(true);
  });
});
