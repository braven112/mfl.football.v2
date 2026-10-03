/**
 * POST /api/admin/league-launcher/launch   { spec: { mflId, slug, name, … } }
 *
 * Step 3 of the League Launcher: validate the checked boxes as a launch spec
 * (src/config/launch-spec.mjs — the same checks the generator runs) and
 * dispatch .github/workflows/launch-league.yml, which generates the league on
 * a `launch/<slug>` branch cut from staging. Nothing merges by itself: the
 * response carries the "Open PR to staging" link.
 *
 * Who: a platform admin only. Where: production only — dispatchWorkflow
 * refuses on staging and previews, which share production's credentials.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { isPlatformAdmin } from '../../../../utils/league-admin';
import { json, JSON_HEADERS_NO_STORE } from '../../../../utils/api-response';
import { dispatchWorkflow } from '../../../../utils/workflow-dispatch';
import { cleanSpec, specErrors } from '../../../../config/launch-spec.mjs';
import { launchPrUrl } from '../../../../utils/league-launcher';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user || !isPlatformAdmin(user)) {
    return json({ ok: false, errors: ['Only a platform admin can launch a league.'] }, 403, JSON_HEADERS_NO_STORE);
  }

  let body: { spec?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, errors: ['Send JSON: { "spec": { … } }'] }, 400, JSON_HEADERS_NO_STORE);
  }
  const errors = specErrors(body.spec);
  if (errors.length) return json({ ok: false, errors }, 400, JSON_HEADERS_NO_STORE);
  const spec = cleanSpec(body.spec);

  const res = await dispatchWorkflow('launch-league.yml', {
    ref: 'staging',
    inputs: { spec: JSON.stringify(spec), requested_by: user.name ?? 'admin' },
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    return json(
      { ok: false, errors: [detail.error ?? 'Could not start the launch.', detail.detail].filter(Boolean) },
      res.status === 503 ? 503 : 502,
      JSON_HEADERS_NO_STORE,
    );
  }
  return json(
    {
      ok: true,
      branch: `launch/${spec.slug}`,
      prUrl: launchPrUrl(spec.slug),
      message: `Launching ${spec.name}. The branch appears in about five minutes; open the PR to review it on a preview build.`,
    },
    202,
    JSON_HEADERS_NO_STORE,
  );
};
