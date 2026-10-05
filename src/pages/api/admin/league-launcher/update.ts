/**
 * POST /api/admin/league-launcher/update   { spec: { slug, features } }
 *
 * The League Launcher's "Change features" mode: validate the new boxes for an
 * existing package league (src/config/launch-spec.mjs#updateSpecErrors) and
 * dispatch .github/workflows/update-league.yml, which sets them in the
 * registry and adds or removes the league's pages, search entries and nav
 * links to match — on a fresh `features/<slug>-<stamp>` branch cut from
 * staging. Nothing merges by itself: the response carries the PR link.
 *
 * Who: a platform admin only. Where: production only — dispatchWorkflow
 * refuses on staging and previews, which share production's credentials.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { isPlatformAdmin } from '../../../../utils/league-admin';
import { json, JSON_HEADERS_NO_STORE } from '../../../../utils/api-response';
import { dispatchWorkflow } from '../../../../utils/workflow-dispatch';
import { cleanUpdateSpec, updateBranch, updateSpecErrors } from '../../../../config/launch-spec.mjs';
import { branchPrUrl } from '../../../../utils/league-launcher';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isPlatformAdmin(user)) {
    return json({ ok: false, errors: ["Only a platform admin can change a league's features."] }, 403, JSON_HEADERS_NO_STORE);
  }

  let body: { spec?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, errors: ['Send JSON: { "spec": { "slug": …, "features": { … } } }'] }, 400, JSON_HEADERS_NO_STORE);
  }
  const errors = updateSpecErrors(body.spec);
  if (errors.length) return json({ ok: false, errors }, 400, JSON_HEADERS_NO_STORE);
  const spec = cleanUpdateSpec(body.spec as { slug: string; features: Record<string, boolean> });
  const branch = updateBranch(spec.slug);

  const res = await dispatchWorkflow('update-league.yml', {
    ref: 'staging',
    inputs: { spec: JSON.stringify(spec), branch, requested_by: user.name ?? 'admin' },
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    return json(
      { ok: false, errors: [detail.error ?? 'Could not start the update.', detail.detail].filter(Boolean) },
      res.status === 503 ? 503 : 502,
      JSON_HEADERS_NO_STORE,
    );
  }
  return json(
    {
      ok: true,
      branch,
      prUrl: branchPrUrl(branch),
      message: 'Updating the league. The branch appears in about two minutes; open the PR to review it on a preview build.',
    },
    202,
    JSON_HEADERS_NO_STORE,
  );
};
