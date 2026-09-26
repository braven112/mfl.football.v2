/**
 * Custom-site demo leads, on the PRODUCTION site (docs/plans/custom-site-demo.md,
 * phase 3). The demo relays each questionnaire here, signed; the owner reads
 * and manages them at /theleague/admin/demo-leads.
 *
 *   demo-leads:<id>      the lead record (JSON)
 *   demo-leads:index     sorted set of ids by creation time
 */
import { getRedis } from './redis-client';

export interface DemoLead {
  id: string;
  createdAt: number;
  expiresAt: number;
  token: string;
  link: string;
  /** The demo we would build for them; `path` is the one they were shown. */
  wanted: string;
  path: string;
  name: string;
  email: string;
  leagueName: string;
  leagueId: string;
  platform: string;
  format: string;
  draftType: string;
  teams: number | null;
  salaryCap: boolean;
  contracts: boolean;
  conferences: boolean;
  scoring: string;
  wishlist: string;
  heardFrom: string;
  /** Set when the owner revokes the link from the admin page. */
  revokedAt?: number;
  /** 'questionnaire' (default) or 'manual' — a link the owner issued by hand. */
  source?: 'questionnaire' | 'manual';
}

const INDEX = 'demo-leads:index';
const key = (id: string) => `demo-leads:${id}`;

export async function saveDemoLead(lead: DemoLead): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.set(key(lead.id), JSON.stringify(lead));
  await redis.zadd(INDEX, { score: lead.createdAt, member: lead.id });
  return true;
}

export async function getDemoLead(id: string): Promise<DemoLead | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(key(id));
  if (!raw) return null;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as DemoLead;
}

export async function listDemoLeads(limit = 200): Promise<DemoLead[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const ids = (await redis.zrevrangebyscore<string>(INDEX, '+inf', '-inf', { offset: 0, count: limit })) ?? [];
  const leads = await Promise.all(ids.map((id) => getDemoLead(String(id))));
  return leads.filter((l): l is DemoLead => l !== null);
}
