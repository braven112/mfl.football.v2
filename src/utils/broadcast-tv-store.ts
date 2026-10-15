/**
 * Where TV pairings live: Redis in every deployed environment.
 *
 * `pnpm dev` without a `.env.local` has no Redis, and the whole pairing flow
 * is unreachable without a store — so DEV ONLY, an in-process Map stands in.
 * Never in a deployed build: serverless instances do not share memory, so a
 * pairing started on one would be invisible to the poll that lands on
 * another, and the TV would sit on its code forever.
 */
import { getRedis } from './redis-client';
import type { PairingStore } from './broadcast-tv-pairing';

/** A Map with `ex`/`nx`, enough to stand in for the store in dev and tests. */
export function memoryPairingStore(clock: () => number = Date.now): PairingStore {
  const data = new Map<string, { value: unknown; expires: number }>();
  const live = (key: string) => {
    const hit = data.get(key);
    if (!hit) return null;
    if (hit.expires <= clock()) {
      data.delete(key);
      return null;
    }
    return hit;
  };
  return {
    async get<T>(key: string) {
      const hit = live(key);
      // A structured clone, as a JSON round trip through Redis would give.
      return hit ? (JSON.parse(JSON.stringify(hit.value)) as T) : null;
    },
    async set(key, value, opts) {
      if (opts?.nx && live(key)) return null;
      data.set(key, { value, expires: opts?.ex ? clock() + opts.ex * 1000 : Infinity });
      return 'OK';
    },
    async del(key) {
      data.delete(key);
      return 1;
    },
  };
}

let devStore: PairingStore | null = null;

export async function getPairingStore(): Promise<PairingStore | null> {
  const redis = await getRedis();
  if (redis) return redis;
  if (import.meta.env.DEV) return (devStore ??= memoryPairingStore());
  return null;
}
