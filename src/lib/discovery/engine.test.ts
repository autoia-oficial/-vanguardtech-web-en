import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { leads } from '@/db/schema';
import { persistDiscovered } from './engine';
import { rescoreUnscored } from '@/lib/automation/jobs';
import { resetDatabase, makeLead } from '@/test/helpers';
import type { DiscoveredBusiness } from './types';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

function business(over: Partial<DiscoveredBusiness> = {}): DiscoveredBusiness {
  return {
    business_name: 'Peluquería Central',
    city: 'Zaragoza',
    country: 'España',
    phone: '+34 976 111 222',
    email: 'hola@peluqueria.example',
    website: null,
    source: 'openstreetmap',
    external_id: `osm-${Math.random().toString(36).slice(2)}`,
    ...over,
  };
}

describe('scoring at discovery time', () => {
  it('scores a business with no website instead of leaving it at zero', async () => {
    const id = await persistDiscovered(business({ website: null }));
    expect(id).not.toBeNull();

    const lead = await db.query.leads.findFirst({ where: eq(leads.id, id!) });
    // A lead with no website is the strongest opportunity the scoring model
    // recognises. Left at zero it would sort below every audited lead.
    expect(lead!.score).toBeGreaterThan(0);
    expect(lead!.priority).not.toBe('medium');
  });

  it('scores a business that has a website, before any audit runs', async () => {
    const id = await persistDiscovered(
      business({ website: 'https://ejemplo.example', external_id: 'osm-con-web' }),
    );
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, id!) });
    expect(lead!.score).toBeGreaterThan(0);
  });

  it('ranks a business with no website above an identical one that has one', async () => {
    const sinWeb = await persistDiscovered(
      business({ business_name: 'Sin Web', website: null, external_id: 'osm-a', phone: '+34 976 111 001', email: 'a@x.example' }),
    );
    const conWeb = await persistDiscovered(
      business({ business_name: 'Con Web', website: 'https://x.example', external_id: 'osm-b', phone: '+34 976 111 002', email: 'b@x.example' }),
    );

    const a = await db.query.leads.findFirst({ where: eq(leads.id, sinWeb!) });
    const b = await db.query.leads.findFirst({ where: eq(leads.id, conWeb!) });
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  it('still returns null for a duplicate rather than scoring it twice', async () => {
    const first = await persistDiscovered(business({ external_id: 'osm-dup' }));
    const second = await persistDiscovered(business({ external_id: 'osm-dup' }));
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('rescoreUnscored', () => {
  it('scores leads that were stored before discovery started scoring', async () => {
    const lead = await makeLead({
      business_name: 'Gimnasio Antiguo',
      website: null,
      phone: '+34 976 222 333',
      email: 'gim@ejemplo.example',
      score: 0,
    });

    const changed = await rescoreUnscored();
    expect(changed).toBe(1);

    const after = await db.query.leads.findFirst({ where: eq(leads.id, lead.id) });
    expect(after!.score).toBeGreaterThan(0);
  });

  it('leaves already-scored leads alone', async () => {
    await makeLead({ business_name: 'Ya Puntuado', website: null, phone: '+34 976 222 444', score: 55 });
    const changed = await rescoreUnscored();
    expect(changed).toBe(0);
  });
});
