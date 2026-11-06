/**
 * GET /api/history-funnel/leads.csv — every league that started or finished
 * importing its full history: the potential client list. Site Insights'
 * one viewer only (`canViewSiteInsights`); anyone else gets a 404.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { canViewSiteInsights } from '../../../utils/site-insights';
import { leadsCsv, readFunnelReport } from '../../../utils/history-funnel';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	if (!canViewSiteInsights(getAuthUser(request))) return new Response(null, { status: 404 });
	const report = await readFunnelReport(1);
	if (!report) return new Response('Storage unavailable.', { status: 503 });
	return new Response(leadsCsv(report.leads), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="league-history-leads.csv"',
			'Cache-Control': 'no-store',
		},
	});
};
