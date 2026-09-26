#!/usr/bin/env node
/**
 * A tiny in-memory stand-in for Upstash's Redis REST API, for exercising the
 * custom-site demo locally without a real database:
 *
 *   node scripts/demo/mock-upstash.mjs 8079
 *   DEMO_REDIS_REST_URL=http://127.0.0.1:8079 DEMO_REDIS_REST_TOKEN=local ...
 *
 * Speaks the two request shapes @upstash/redis sends — a JSON command array to
 * `/`, and an array of them to `/pipeline` (or `/multi-exec`) — for the
 * commands the site uses. Development only; nothing persists.
 */
import http from 'node:http';


/** An error this mock raises on purpose; its message is safe to return. */
class MockError extends Error {}

const port = Number(process.argv[2] ?? 8079);
const db = new Map(); // key -> { value, type, expiresAt }

const alive = (key) => {
  const entry = db.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    db.delete(key);
    return null;
  }
  return entry;
};

function run([rawCmd, ...args]) {
  const cmd = String(rawCmd).toLowerCase();
  const key = args[0];
  switch (cmd) {
    case 'ping':
      return 'PONG';
    case 'get':
      return alive(key)?.value ?? null;
    case 'set': {
      const entry = { value: String(args[1]), expiresAt: null };
      const upper = args.map((a) => String(a).toUpperCase());
      const ex = upper.indexOf('EX');
      if (ex > 0) entry.expiresAt = Date.now() + Number(args[ex + 1]) * 1000;
      const px = upper.indexOf('PX');
      if (px > 0) entry.expiresAt = Date.now() + Number(args[px + 1]);
      if (upper.includes('NX') && alive(key)) return null;
      db.set(key, entry);
      return 'OK';
    }
    case 'mget':
      return args.map((k) => alive(k)?.value ?? null);
    case 'del':
      return args.reduce((n, k) => n + (db.delete(k) ? 1 : 0), 0);
    case 'exists':
      return args.filter((k) => alive(k)).length;
    case 'incr':
    case 'decr':
    case 'incrby': {
      const by = cmd === 'incrby' ? Number(args[1]) : cmd === 'incr' ? 1 : -1;
      const next = Number(alive(key)?.value ?? 0) + by;
      db.set(key, { value: String(next), expiresAt: alive(key)?.expiresAt ?? null });
      return next;
    }
    case 'expire': {
      const entry = alive(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + Number(args[1]) * 1000;
      return 1;
    }
    case 'ttl': {
      const entry = alive(key);
      if (!entry) return -2;
      return entry.expiresAt ? Math.ceil((entry.expiresAt - Date.now()) / 1000) : -1;
    }
    case 'hset': {
      const entry = alive(key) ?? { value: new Map(), expiresAt: null };
      let added = 0;
      for (let i = 1; i < args.length; i += 2) {
        if (!entry.value.has(String(args[i]))) added += 1;
        entry.value.set(String(args[i]), String(args[i + 1]));
      }
      db.set(key, entry);
      return added;
    }
    case 'hget':
      return alive(key)?.value?.get(String(args[1])) ?? null;
    case 'hgetall': {
      const map = alive(key)?.value;
      return map ? [...map.entries()].flat() : [];
    }
    case 'hdel': {
      const map = alive(key)?.value ?? new Map();
      return args.slice(1).reduce((n, f) => (map.delete(String(f)) ? n + 1 : n), 0);
    }
    case 'hincrby': {
      const entry = alive(key) ?? { value: new Map(), expiresAt: null };
      const field = String(args[1]);
      const next = Number(entry.value.get(field) ?? 0) + Number(args[2]);
      entry.value.set(field, String(next));
      db.set(key, entry);
      return next;
    }
    case 'sadd': {
      const entry = alive(key) ?? { value: new Set(), expiresAt: null };
      const before = entry.value.size;
      for (const m of args.slice(1)) entry.value.add(String(m));
      db.set(key, entry);
      return entry.value.size - before;
    }
    case 'smembers':
      return [...(alive(key)?.value ?? [])];
    case 'srem': {
      const set = alive(key)?.value ?? new Set();
      return args.slice(1).reduce((n, m) => n + (set.delete(String(m)) ? 1 : 0), 0);
    }
    case 'lpush': {
      const entry = alive(key) ?? { value: [], expiresAt: null };
      entry.value.unshift(...args.slice(1).map(String).reverse());
      db.set(key, entry);
      return entry.value.length;
    }
    case 'lrange': {
      const list = alive(key)?.value ?? [];
      const stop = Number(args[2]);
      return list.slice(Number(args[1]), stop < 0 ? list.length + stop + 1 : stop + 1);
    }
    case 'scan': {
      const upper = args.map((a) => String(a).toUpperCase());
      const m = upper.indexOf('MATCH');
      const pattern = m > 0 ? String(args[m + 1]) : '*';
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      return ['0', [...db.keys()].filter((k) => alive(k) && re.test(k))];
    }
    case 'hlen':
      return alive(key)?.value?.size ?? 0;
    case 'scard':
    case 'llen':
      return (alive(key)?.value ?? { size: 0, length: 0 }).size ?? alive(key)?.value?.length ?? 0;
    case 'zadd': {
      const entry = alive(key) ?? { value: new Map(), expiresAt: null };
      let added = 0;
      const rest = args.slice(1).filter((a) => !['NX', 'XX', 'GT', 'LT', 'CH'].includes(String(a).toUpperCase()));
      for (let i = 0; i < rest.length; i += 2) {
        if (!entry.value.has(String(rest[i + 1]))) added += 1;
        entry.value.set(String(rest[i + 1]), Number(rest[i]));
      }
      db.set(key, entry);
      return added;
    }
    case 'zcard':
      return alive(key)?.value?.size ?? 0;
    case 'zrange':
    case 'zrangebyscore':
    case 'zrevrangebyscore':
      return [...(alive(key)?.value ?? new Map()).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    case 'zremrangebyscore':
    case 'zremrangebyrank':
    case 'lrem':
      return 0;
    case 'eval':
    case 'evalsha':
      // Scripts are not emulated; callers in this repo fall back when EVAL fails.
      throw new MockError('NOSCRIPT mock-upstash does not run Lua');
    default:
      throw new MockError(`mock-upstash: unsupported command ${cmd}`);
  }
}

const reply = (fn) => {
  try {
    return { result: fn() };
  } catch (err) {
    // Only this file's own messages go back to the caller, never a stack.
    return { error: err instanceof MockError ? err.message : 'ERR mock-upstash internal error' };
  }
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : [];
      const out = req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec')
        ? parsed.map((c) => reply(() => run(c)))
        : reply(() => run(parsed));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`[mock-upstash] listening on http://127.0.0.1:${port}`));
