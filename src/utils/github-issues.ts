/**
 * File a GitHub issue in the site repo.
 *
 * The one place the "an owner asked for this" → "an agent can work on it"
 * handoff happens. The Board already collects the structured fields a good
 * issue needs (page/feature, the problem, the desired behavior); this turns
 * them into an issue body an agent can pick up without going back to ask what
 * was meant.
 *
 * Deliberately NOT a general GitHub client: it creates issues in one repo and
 * does nothing else. Anything wider is a token-scope question, and the token
 * here only needs Issues:Write on this repo.
 */

/**
 * The repo issues are filed against. Hardcoded rather than configurable: it is
 * this site's own repo, and a wrong value here files a league owner's bug
 * report into a stranger's tracker. Same literal the admin dashboard already
 * uses (`src/pages/api/admin/schefter-stats.ts`).
 */
export const SITE_REPO = 'braven112/mfl.football.v2';

/**
 * Token lookup, in the same fallback order as the admin dashboard so one
 * `GH_TOKEN` in the Vercel env serves both.
 */
export function getGitHubToken(): string | null {
  return (
    process.env.GITHUB_ADMIN_TOKEN ||
    process.env.GH_ADMIN_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    null
  );
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export type CreateIssueResult =
  | { ok: true; number: number; url: string }
  | { ok: false; status: number; error: string };

/**
 * Create an issue. Never throws — every failure comes back as `ok: false` with
 * a message the caller can show, because the caller is a button in the UI and
 * "nothing happened" is the worst possible outcome there.
 *
 * Labels are BEST EFFORT and deliberately not verified. GitHub's own docs say
 * only that they are "silently dropped" when the token lacks push access, and
 * do not state whether a name that does not yet exist in the repo is created
 * or ignored — so the one thing we can rely on is that a label problem does
 * not cost us the issue. That is the right trade here: the labels are for
 * triage convenience, the issue body is the actual handoff. If they turn out
 * not to auto-create, creating the four by hand once fixes it permanently and
 * nothing in this file changes.
 */
export async function createGitHubIssue(
  input: CreateIssueInput,
): Promise<CreateIssueResult> {
  const token = getGitHubToken();
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: 'No GitHub token configured on the server (set GH_TOKEN).',
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${SITE_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'mfl-suggestion-box',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        ...(input.labels?.length ? { labels: input.labels } : {}),
      }),
    });

    const payload = (await res.json().catch(() => null)) as
      | { number?: number; html_url?: string; message?: string }
      | null;

    if (!res.ok || typeof payload?.number !== 'number' || !payload.html_url) {
      return {
        ok: false,
        status: res.status || 502,
        // GitHub's own message is the useful half of a 403/422 (a bad token, a
        // repo with issues disabled), so surface it rather than a generic line.
        error: payload?.message || `GitHub returned HTTP ${res.status}`,
      };
    }

    return { ok: true, number: payload.number, url: payload.html_url };
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message };
  }
}
