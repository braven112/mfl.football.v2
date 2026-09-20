# Live broadcast companion — cost model. Assumptions labelled; adjust and re-run.
GAME_HOURS_PER_SUNDAY = 10      # 1pm ET through end of SNF
SUNDAYS = 18
TICK_SECONDS = 20               # how often central ingest refreshes
EDGE_TTL = 15                   # seconds a per-league blob is cached at the edge
SESSION_HOURS = 3               # avg hours a user actually watches per Sunday
POLL_SECONDS = 15               # client poll interval
BLOB_KB = 40                    # per-league state payload

VERCEL_INVOCATION_PER_M = 0.60  # $ per million function invocations
VERCEL_CPU_HOUR = 0.128         # $ per active CPU-hour (fluid)
VERCEL_BANDWIDTH_GB = 0.15      # $ per GB fast data transfer
NEON = 15.0                     # $/mo, generous

def model(users, leagues, data_cost_month, label):
    season_months = 5
    # 1. Central ingest — O(1) in users. One loop, whole slate.
    ticks = GAME_HOURS_PER_SUNDAY * 3600 / TICK_SECONDS * SUNDAYS
    ingest_cpu_h = ticks * 0.4 / 3600          # ~400ms CPU per tick
    # 2. Per-league recompute — O(leagues)
    league_cpu_h = ticks * leagues * 0.02 / 3600  # ~20ms per league per tick
    # 3. Delivery — users poll an edge-cached blob. Origin hits are capped by TTL.
    user_polls = users * SESSION_HOURS * 3600 / POLL_SECONDS * SUNDAYS
    origin_hits = min(user_polls, leagues * GAME_HOURS_PER_SUNDAY*3600/EDGE_TTL * SUNDAYS)
    bandwidth_gb = user_polls * BLOB_KB / 1e6
    cpu = (ingest_cpu_h + league_cpu_h) * VERCEL_CPU_HOUR
    inv = origin_hits / 1e6 * VERCEL_INVOCATION_PER_M
    bw  = bandwidth_gb * VERCEL_BANDWIDTH_GB
    infra = cpu + inv + bw + NEON*season_months + 20*season_months
    data  = data_cost_month * season_months
    total = infra + data
    print(f"\n{label}  —  {users:,} users / {leagues:,} leagues")
    print(f"   central ingest      {ingest_cpu_h:8.1f} CPU-h   ${cpu:8.2f}")
    print(f"   user polls          {user_polls/1e6:8.1f} M      origin hits {origin_hits/1e6:.2f} M  ${inv:.2f}")
    print(f"   bandwidth           {bandwidth_gb:8.1f} GB      ${bw:8.2f}")
    print(f"   infra (season)                          ${infra:9,.0f}")
    print(f"   DATA FEED (season)                      ${data:9,.0f}")
    print(f"   TOTAL PER SEASON                        ${total:9,.0f}")
    print(f"   cost per user per season                ${total/users:9,.2f}")
    return total

print("="*68); print("BRANCH A — free ESPN endpoints (what the repo already uses)"); print("="*68)
for u,l in [(100,10),(1000,100),(10000,1000)]: model(u,l,0,"free feed")
print("\n"+"="*68); print("BRANCH B — paid real-time feed @ $1,500/mo (mid of $500-3,000)"); print("="*68)
for u,l in [(100,10),(1000,100),(10000,1000)]: model(u,l,1500,"paid feed")
