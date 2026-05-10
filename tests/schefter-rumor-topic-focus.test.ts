/**
 * Source-level guards for the single-topic rumor-scan pipeline.
 *
 * The rumor scanner used to synthesize whatever was in the tip queue into a
 * single 2–4 sentence post, often blending three unrelated topics. We now
 * pick ONE topic bucket per cycle (trade rumors first, then multi-tip gossip
 * clusters), rate-limit gossip to 1 post/day, preserve unused tips for the
 * next cycle, and link the tip page from every post.
 *
 * These tests pin those invariants at the source level so a regression
 * (e.g. someone re-enables multi-topic synthesis or drops the gossip cap)
 * surfaces in CI rather than in the feed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('rumor-scan daily caps — trade-heavy, gossip-rationed', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('caps daily posts at 3 (gossip hard-limited to 1/day, so the other 2 slots go to trade rumors)', () => {
    expect(src).toMatch(/const\s+MAX_POSTS_PER_DAY\s*=\s*3\b/);
  });

  it('rations gossip posts to at most 1 per day', () => {
    expect(src).toMatch(/const\s+MAX_GOSSIP_POSTS_PER_DAY\s*=\s*1\b/);
  });

  it('tracks the gossip counter in its own Redis key', () => {
    expect(src).toMatch(/const\s+RUMOR_GOSSIP_POSTS_TODAY_KEY\s*=\s*['"]schefter:rumor:gossip_posts_today['"]/);
  });

  it('increments the gossip counter only when postKind === "gossip"', () => {
    expect(src).toMatch(/if\s*\(\s*postKind\s*===\s*['"]gossip['"]\s*\)\s*\{[\s\S]*?redis\.incr\(RUMOR_GOSSIP_POSTS_TODAY_KEY\)/);
  });

  it('sets a TTL on the gossip counter so it resets at PT midnight', () => {
    expect(src).toMatch(/redis\.expire\(RUMOR_GOSSIP_POSTS_TODAY_KEY,\s*secondsUntilPtMidnight/);
  });
});

describe('rumor-scan bucketing — one topic per post', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');
  // classifyTipKind / buildTopicBuckets / bucketPriorityScore moved to a
  // shared module so the admin dashboard can preview the next bucket.
  // The scanner imports from there; function-body assertions now read
  // the shared module's source.
  const bucketSrc = read('scripts/lib/schefter-bucket-logic.mjs');

  it('defines a buildTopicBuckets helper that groups tips by topic/thread', () => {
    expect(bucketSrc).toMatch(/function\s+buildTopicBuckets\(/);
  });

  it('defines a pickPrimaryBucket helper that honors the gossip budget', () => {
    // Signature takes the buckets array plus an options object carrying
    // the day's gossip-allowed flag (and now the cycle clock for age boost).
    expect(src).toMatch(/function\s+pickPrimaryBucket\(\s*buckets\s*,\s*\{\s*gossipAllowedToday[^}]*\}/);
  });

  it('classifies ONLY trade_offer tips as the trade kind (web/groupme trade rumors are gossip)', () => {
    // Real MFL pending offers are the trade-rumor headline material.
    // Web/groupme tips with topic === 'trade' are speculation and ride
    // the gossip lane subject to the gossip cap.
    const fn = bucketSrc.match(/function\s+classifyTipKind[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/source\s*===\s*['"]trade_offer['"]\)\s*return\s+['"]trade['"]/);
    // No fall-through that promotes topic === 'trade' to 'trade' kind.
    expect(body).not.toMatch(/topic\s*===\s*['"]trade['"]\)\s*return\s+['"]trade['"]/);
  });

  it('web/groupme bucket key includes the franchise scope so different scopes split into separate posts', () => {
    // Two `topic: 'trade'` web tips — one naming a franchise, one
    // league-wide — must NOT collapse into one post. The key is
    // `topic:<topic>:<franchiseHint || 'league-wide'>` so they bucket
    // independently and ship as two separate posts (subject to the
    // pressure gate).
    const fn = bucketSrc.match(/function\s+buildTopicBuckets[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/key\s*=\s*`topic:\$\{topic\}:\$\{scope\}`/);
    expect(body).toMatch(/scope\s*=\s*tip\.franchiseHint[\s\S]*?['"]league-wide['"]/);
  });

  it('only considers gossip buckets when the gossip daily budget is still open', () => {
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    expect(pickFn![0]).toMatch(/if\s*\(\s*!gossipAllowedToday\s*\)\s*return\s+null/);
  });

  it('batches tips FROM THE CHOSEN BUCKET ONLY (not the full freshTips list)', () => {
    // The old code did `const batch = freshTips.slice(0, MAX_TIPS_PER_BATCH)`
    // which blended every unrelated topic into one post. We now take the
    // bucket's tips. (The assignment may be a later `let`-based reassignment
    // because the mailbag path rebinds `batch` without `const`.)
    expect(src).not.toMatch(/const\s+batch\s*=\s*freshTips\.slice/);
    expect(src).toMatch(/batch\s*=\s*primaryBucket\.tips\.slice/);
  });

  it('holds unused tips in Redis for the next cycle instead of DELing them', () => {
    // The old drain was `redis.del(TIPS_QUEUE_KEY)` followed by DEL on
    // first_tip_ts. We now RPUSH any leftover tips back so slow-news days
    // can surface them later.
    expect(src).toMatch(/const\s+unusedTips\s*=\s*freshTips\.filter/);
    expect(src).toMatch(/redis\.rpush\(TIPS_QUEUE_KEY,\s*\.\.\.serialized\)/);
  });

  it('preserves the oldest leftover tip as the new first_tip_ts anchor', () => {
    // Without this, the marinate gate would stay cleared after a partial
    // drain and the next cycle would re-fire immediately.
    expect(src).toMatch(/redis\.set\(FIRST_TIP_TS_KEY,\s*oldest\)/);
  });
});

describe('rumor-scan LLM prompt — one topic per post', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('tells the LLM to stay on ONE TOPIC per post and refuses "meanwhile…" pivots', () => {
    expect(src).toMatch(/ONE TOPIC per post/);
    expect(src).toMatch(/No "meanwhile/);
  });

  it('references the two-separate-posts behavior in the one-topic rule', () => {
    // The rule explicitly mentions that unrelated gossip ships as TWO
    // posts rather than one blended post — prevents the LLM from
    // "helpfully" stitching them back together.
    expect(src).toMatch(/ships them as TWO separate posts/);
  });

  it('caps post length at 1–2 sentences', () => {
    // HARD RULE 8 is the authoritative cap; the trade-offer playbook
    // must defer to it as well.
    expect(src).toMatch(/Length:\s*1[–-]2 sentences\./);
    expect(src).toMatch(/1[–-]2 sentences TOTAL/);
  });

  it('does not retain the old "mixed batches" multi-topic rule', () => {
    // The old rule 7 explicitly encouraged blending GroupMe + web tips
    // across topics — incompatible with single-topic focus.
    expect(src).not.toMatch(/It's okay for a single post to blend/);
  });
});

describe('rumor-scan tip-page link — every post sends readers back to /tip', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('defines the tip page path constant (canonical /schefter/tip on theleague.us)', () => {
    expect(src).toMatch(/const\s+TIP_PAGE_PATH\s*=\s*['"]\/schefter\/tip['"]/);
  });

  it('defines a user-facing CTA label', () => {
    expect(src).toMatch(/const\s+TIP_PAGE_LINK_LABEL\s*=\s*['"]Got a tip\? Whisper to Schefter →['"]/);
  });

  it('derives an absolute tip-page URL from SCHEFTER_PUBLIC_BASE_URL (defaults to theleague.us)', () => {
    expect(src).toMatch(/process\.env\.SCHEFTER_PUBLIC_BASE_URL/);
    expect(src).toMatch(/https:\/\/theleague\.us/);
    expect(src).toMatch(/const\s+TIP_PAGE_ABSOLUTE_URL\s*=/);
  });

  it('attaches link + linkLabel to every feed post it generates', () => {
    // Default CTA for non-trade-bait posts still resolves to the tip page.
    expect(src).toMatch(/const\s+TIP_PAGE_PATH\s*=\s*['"]\/schefter\/tip['"]/);
    expect(src).toMatch(/const\s+TIP_PAGE_LINK_LABEL\s*=/);
    // Post builder pulls link/linkLabel from a per-beat CTA object, which
    // falls back to the tip-page default for everything that isn't
    // trade_bait with a single franchise.
    expect(src).toMatch(/link:\s*cta\.link/);
    expect(src).toMatch(/linkLabel:\s*cta\.linkLabel/);
    expect(src).toMatch(/link:\s*TIP_PAGE_PATH,\s*\n\s*linkLabel:\s*TIP_PAGE_LINK_LABEL/);
  });

  it('appends a per-post CTA URL to every GroupMe post (tip page by default)', () => {
    // Each beat ships its own GroupMe message via groupMeTextFor(p), which
    // resolves the CTA per-post through ctaByPostId. Trade-bait posts swap
    // the tip-page URL for a Trade Builder deep-link; everything else
    // falls back to the tip-page CTA.
    expect(src).toMatch(/const\s+groupMeTextFor\s*=\s*\(p\)\s*=>\s*\{/);
    expect(src).toMatch(/ctaByPostId\.get\(p\.id\)/);
    expect(src).toMatch(/groupMeUrl:\s*TIP_PAGE_ABSOLUTE_URL/);
    expect(src).toMatch(/\$\{cta\.groupMePrefix\}\s*\$\{cta\.groupMeUrl\}/);
    expect(src).toMatch(/await\s+postToGroupMe\(groupMeTextFor\(allowedPosts\[i\]\)\)/);
    // No raw-body GroupMe calls remain — every rumor post gets the CTA.
    expect(src).not.toMatch(/await\s+postToGroupMe\(post\.body\)/);
  });
});

describe('rumor-scan text redaction — franchise names cannot leak through tip text', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('exposes a redactFranchiseNamesInText helper', () => {
    expect(src).toMatch(/function\s+redactFranchiseNamesInText\(/);
  });

  it('collects every franchise name form (long/medium/short/abbrev) for matching', () => {
    expect(src).toMatch(/function\s+collectFranchiseNameTokens\(/);
    const fn = src.match(/function\s+collectFranchiseNameTokens[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/['"]name['"],\s*['"]nameMedium['"],\s*['"]nameShort['"],\s*['"]abbrev['"]/);
  });

  it('replaces matched franchise names with a generic "[a team]" placeholder', () => {
    const fn = src.match(/function\s+redactFranchiseNamesInText[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/replace\(re,\s*['"]\[a team\]['"]\)/);
  });

  it('keeps the named franchise on multi-source scope, redacts everything else', () => {
    // The keepFranchise param lets HARD RULE 4's named-franchise stay
    // while still scrubbing collateral mentions of OTHER teams.
    const fn = src.match(/function\s+redactFranchiseNamesInText[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/keepFranchise/);
  });

  it('uses word-boundary case-insensitive regex (so "Geeks" matches but "geeky" does not)', () => {
    const fn = src.match(/function\s+redactFranchiseNamesInText[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/new RegExp\(`\\\\b\$\{escapeRegExp\(token\)\}\\\\b`,\s*['"]gi['"]\)/);
  });

  it('runs redaction at the end of the web-tip anonymization path', () => {
    // The keep-franchise lookup uses the just-set safe.scope so the
    // multi-source named franchise survives while every other team
    // gets stripped from the raw text the LLM sees.
    expect(src).toMatch(/safe\.scope\?\.kind\s*===\s*['"]franchise-multi-source['"]/);
    expect(src).toMatch(/safe\.text\s*=\s*redactFranchiseNamesInText\(safe\.text,\s*teams,/);
  });
});

describe('rumor-scan queue TTL — tips survive a full week', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('keeps tips alive for 7 days so the queue can ride a slow news cycle', () => {
    expect(src).toMatch(/const\s+TIP_EXPIRY_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('defines a 3-day staleness threshold for age-aware voice', () => {
    expect(src).toMatch(/const\s+TIP_STALE_THRESHOLD_MS\s*=\s*3\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
});

describe('rumor-scan age metadata — tips carry ageDays + isStale to the LLM', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('surfaces ageDays on every anonymized tip', () => {
    expect(src).toMatch(/ageDays,/);
  });

  it('surfaces an isStale flag for tips ≥ 3 days old', () => {
    expect(src).toMatch(/isStale:\s*ageMs\s*>=\s*TIP_STALE_THRESHOLD_MS/);
  });

  it('passes now into anonymizeTips so age is computed against the cycle clock', () => {
    // Updated for Phase-2 explicit-pick feature: anonymizeTips is now async
    // and accepts a 5th `redis` argument for naming-rate-limit + name-count
    // reads. Both call sites still pass `now` as the 4th arg.
    expect(src).toMatch(/await anonymizeTips\(batch,\s*teams,\s*feedForAnonymize\.posts[^,]*,\s*now,\s*redis\)/);
  });
});

describe('rumor-scan LLM — age-aware framing rule', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('requires age-reference or hedge phrasing on stale tips (HARD RULE 17)', () => {
    expect(src).toMatch(/17\.\s*AGE-AWARE FRAMING/);
    expect(src).toMatch(/NEVER claim a stale tip is fresh/);
    expect(src).toMatch(/still hearing about/);
  });

  it('forbids inventing specific calendar labels (only relative phrasing allowed)', () => {
    expect(src).toMatch(/Never invent a specific date the tip doesn't have/);
  });
});

describe('rumor-scan bucket priority — age boost so old tips rise', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');
  const bucketSrc = read('scripts/lib/schefter-bucket-logic.mjs');

  it('exposes a bucketPriorityScore helper that adds a per-day age boost', () => {
    expect(bucketSrc).toMatch(/function\s+bucketPriorityScore\(/);
    expect(bucketSrc).toMatch(/oldestAgeDays/);
    expect(bucketSrc).toMatch(/return\s+sizeScore\s*\+\s*oldestAgeDays/);
  });

  it('sorts both trade and gossip buckets by bucketPriorityScore (descending)', () => {
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    const body = pickFn![0];
    // Used in both the trade-branch and the gossip-branch sort comparators.
    const scoreCalls = body.match(/bucketPriorityScore\(/g) ?? [];
    expect(scoreCalls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('rumor-scan two-post gossip — second bucket ships as its own feed post', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('pickPrimaryBucket returns {primary, secondary} so a second gossip bucket can ride along', () => {
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    expect(pickFn![0]).toMatch(/return\s*\{\s*primary:[^,]+,\s*secondary/);
  });

  it('trade-rumor posts never carry a secondary (stays strictly one-topic)', () => {
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    // Trade-branch returns secondary: null explicitly.
    expect(pickFn![0]).toMatch(/primary:\s*tradeBuckets\[0\],\s*secondary:\s*null/);
  });

  it('main flow only adds a secondary beat for gossip posts (never trade)', () => {
    expect(src).toMatch(/if\s*\(postKind\s*===\s*['"]gossip['"]\s*&&\s*secondaryBucket\)/);
  });

  it('gates the secondary post on real pile-up (>= SECONDARY_GOSSIP_POST_PRESSURE gossip tips queued)', () => {
    // Under the threshold the scanner ships ONE post and holds the second
    // bucket for the next cycle. The double-post is a catch-up mechanism,
    // not the default cadence.
    expect(src).toMatch(/const\s+SECONDARY_GOSSIP_POST_PRESSURE\s*=\s*4\b/);
    expect(src).toMatch(/if\s*\(gossipQueueDepth\s*>=\s*SECONDARY_GOSSIP_POST_PRESSURE\)/);
  });

  it('explicitly holds the secondary bucket for the next cycle when pressure is low', () => {
    // The "else" branch of the pressure gate logs a hold; we assert the
    // hold-for-next-cycle path exists so a later refactor can't silently
    // drop it and fall back to always-ship-two.
    expect(src).toMatch(/Holding\s+\$\{secondaryBucket\.key\}\s+for next cycle/);
  });

  it('builds a beats[] array so each beat turns into an independent post', () => {
    expect(src).toMatch(/const\s+beats\s*=\s*\[\s*\{\s*batch,\s*anonymized,\s*kind:\s*postKind[^}]*\}/);
    expect(src).toMatch(/beats\.push\(\s*\{\s*batch:\s*secondaryBatch/);
  });

  it('generates one LLM body per beat, in parallel', () => {
    expect(src).toMatch(/Promise\.all\(\s*beats\.map\(/);
  });

  it('gives the Roger riff to the PRIMARY beat only (never doubles up)', () => {
    expect(src).toMatch(/rogerQuote:\s*i\s*===\s*0\s*\?\s*rogerQuote\s*:\s*null/);
    expect(src).toMatch(/hadRogerRiff:\s*i\s*===\s*0\s*\?\s*hadRogerRiff\s*:\s*false/);
  });

  it('stamps distinct timestamps per beat so feed ordering is stable', () => {
    expect(src).toMatch(/new Date\(now\.getTime\(\)\s*\+\s*i\s*\*\s*1000\)/);
  });

  it('each beat resolves its own whisper-back thread independently', () => {
    // The thread-resolution loop runs per beat — parent counts are local
    // to the beat's batch, not the combined batch.
    expect(src).toMatch(/for \(const tip of beat\.batch\)/);
  });

  it('writes both posts to the feed in one atomic fs.writeFile call', () => {
    // Prepend allowedPosts (gate-allowed beats only) in array order so the
    // primary lands at index 0 (top of the feed). Held / suppressed posts
    // never enter the feed — Option A holds their tips back for re-eval.
    expect(src).toMatch(/feed\.posts\s*=\s*\[\s*\.\.\.allowedPosts,\s*\.\.\.existingPosts\s*\]/);
    const feedWrites = (src.match(/await fs\.writeFile\(FEED_PATH/g) ?? []).length;
    expect(feedWrites).toBe(1);
  });

  it('sends a separate GroupMe message per post (so each is independently replyable)', () => {
    expect(src).toMatch(/for\s*\(let i\s*=\s*0;\s*i\s*<\s*allowedPosts\.length;\s*i\+\+\)\s*\{[\s\S]*?postToGroupMe\(groupMeTextFor\(allowedPosts\[i\]\)\)/);
  });

  it('counts both posts as ONE slot against posts_today and gossip counters', () => {
    // INCR runs once per cycle even when we ship two posts.
    const incrCount = (src.match(/redis\.incr\(RUMOR_POSTS_TODAY_KEY\)/g) ?? []).length;
    expect(incrCount).toBe(1);
    const gossipIncr = (src.match(/redis\.incr\(RUMOR_GOSSIP_POSTS_TODAY_KEY\)/g) ?? []).length;
    expect(gossipIncr).toBe(1);
  });

  it('drops the old HARD RULE 18 "TWO-BEAT" rule (posts are now independent)', () => {
    expect(src).not.toMatch(/TWO-BEAT GOSSIP POSTS/);
    expect(src).not.toMatch(/Separate the beats with a line break/);
  });

  it('does not ship SECONDARY_TIPS through the LLM (each beat is a single-topic prompt)', () => {
    expect(src).not.toMatch(/SECONDARY_TIPS/);
    expect(src).not.toMatch(/PRIMARY_TIPS/);
  });

  it('feed posts do NOT leak internal parent-id marker (kept in a side Map)', () => {
    expect(src).not.toMatch(/_dominantParentId/);
    expect(src).toMatch(/parentIdByPostId/);
  });
});

describe('rumor-scan adaptive gossip cap — bumps to 2 when queue piles up', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('defines a base cap of 1 and an adaptive cap of 2', () => {
    expect(src).toMatch(/const\s+MAX_GOSSIP_POSTS_PER_DAY\s*=\s*1\b/);
    expect(src).toMatch(/const\s+MAX_GOSSIP_POSTS_PER_DAY_ADAPTIVE\s*=\s*2\b/);
  });

  it('defines the trigger thresholds (queue depth + oldest-tip age)', () => {
    expect(src).toMatch(/const\s+GOSSIP_BOOST_QUEUE_DEPTH\s*=\s*6\b/);
    expect(src).toMatch(/const\s+GOSSIP_BOOST_TIP_AGE_MS\s*=\s*3\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('exports a computeAdaptiveGossipCap helper that returns {cap, reason}', () => {
    expect(src).toMatch(/function\s+computeAdaptiveGossipCap\(/);
    expect(src).toMatch(/return\s*\{\s*cap:\s*MAX_GOSSIP_POSTS_PER_DAY_ADAPTIVE/);
    expect(src).toMatch(/return\s*\{\s*cap:\s*MAX_GOSSIP_POSTS_PER_DAY,\s*reason:\s*['"]default['"]/);
  });

  it('main() uses the adaptive cap value (not the hard-coded base) for the gate check', () => {
    expect(src).toMatch(/gossipAllowedToday\s*=\s*gossipToday\s*<\s*adaptiveGossipCap/);
  });
});

describe('rumor-scan Friday mailbag — once-a-week sweep of pending gossip', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('defines the mailbag done-date key and weekday index', () => {
    expect(src).toMatch(/const\s+FRIDAY_MAILBAG_DONE_KEY\s*=\s*['"]schefter:mailbag:done_date['"]/);
    expect(src).toMatch(/const\s+FRIDAY_WEEKDAY_INDEX\s*=\s*5/);
  });

  it('exports an isFridayPt helper keyed to America/Los_Angeles', () => {
    expect(src).toMatch(/function\s+isFridayPt\(/);
    expect(src).toMatch(/timeZone:\s*['"]America\/Los_Angeles['"]/);
  });

  it('main() runs the mailbag at most once per Friday PT (short-circuits on stored date)', () => {
    expect(src).toMatch(/if\s*\(isFridayPt\(now\)\)/);
    expect(src).toMatch(/mailbagDoneDate\s*===\s*todayPtDate/);
  });

  it('mailbag sweeps the entire gossip pool (up to MAX_TIPS_PER_BATCH)', () => {
    expect(src).toMatch(/gossipPool\s*=\s*freshTips\.filter\(\(t\)\s*=>\s*classifyTipKind\(t\)\s*===\s*['"]gossip['"]\)/);
    expect(src).toMatch(/mailbagBatch\s*=\s*gossipPool\.slice\(0,\s*MAX_TIPS_PER_BATCH\)/);
  });

  it('stamps FRIDAY_MAILBAG_DONE_KEY after a successful mailbag post', () => {
    expect(src).toMatch(/redis\.set\(FRIDAY_MAILBAG_DONE_KEY,\s*todayPtDate/);
  });

  it('HARD RULE 20 prescribes bullet-style mailbag voice and caps length', () => {
    // Rule was renumbered from 18 → 20 when the trade-bait directive
    // (rule 19) was inserted between age-aware framing and the mailbag.
    expect(src).toMatch(/20\.\s*MAILBAG POSTS/);
    expect(src).toMatch(/bullet-style one-liners/);
    expect(src).toMatch(/Length cap:\s*180 words/);
  });

  it('user-prompt mode is "mailbag" on Friday mailbag cycles', () => {
    expect(src).toMatch(/const\s+aiMode\s*=\s*postKind\s*===\s*['"]mailbag['"]/);
    expect(src).toMatch(/if\s*\(mode\s*===\s*['"]mailbag['"]\)/);
    expect(src).toMatch(/GOSSIP_TIPS:/);
  });
});

