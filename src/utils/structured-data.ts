/**
 * schema.org JSON-LD for the shared host's public pages.
 *
 * This is how search engines and AI answer tools learn, without guessing,
 * that MFL.football and MFL Addons are one brand, what each service is, and
 * which questions a page answers. Pure builders: the layout serializes them
 * with `jsonLdScript`, which is the one place the `</script>` escape lives.
 */
import { SHARED_APP_ORIGIN } from '../config/leagues';
import { FORMER_BRAND, FORMER_DOMAIN, type Faq, type Service } from '../data/mfl-services';

export type JsonLd = Record<string, unknown>;

const ORG_ID = `${SHARED_APP_ORIGIN}/#organization`;
const SITE_ID = `${SHARED_APP_ORIGIN}/#website`;

/** An absolute URL on the canonical origin, never the host being served. */
export function canonicalUrl(path: string): string {
	return new URL(path, SHARED_APP_ORIGIN).href;
}

export function organizationJsonLd(): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': ORG_ID,
		name: 'MFL.football',
		alternateName: [FORMER_BRAND, 'MFL Football'],
		url: canonicalUrl('/'),
		logo: canonicalUrl('/assets/mfl-live/apple-touch-icon-v2.png'),
		description:
			'Skins, commissioner automation, league history and custom league websites for MyFantasyLeague (MFL) fantasy football leagues. Formerly MFL Addons.',
		sameAs: [`https://${FORMER_DOMAIN}`],
		knowsAbout: ['MyFantasyLeague', 'MFL', 'fantasy football', 'dynasty fantasy football', 'fantasy football league history'],
	};
}

export function websiteJsonLd(): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		'@id': SITE_ID,
		name: 'MFL.football',
		alternateName: FORMER_BRAND,
		url: canonicalUrl('/'),
		publisher: { '@id': ORG_ID },
	};
}

export function serviceJsonLd(service: Service): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'Service',
		name: service.eyebrow,
		serviceType: service.eyebrow,
		description: service.answer,
		url: canonicalUrl(service.path),
		provider: { '@id': ORG_ID },
		areaServed: 'Worldwide',
		audience: { '@type': 'Audience', audienceType: 'MyFantasyLeague commissioners and owners' },
	};
}

export function faqJsonLd(faqs: Faq[]): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faqs.map((f) => ({
			'@type': 'Question',
			name: f.q,
			acceptedAnswer: { '@type': 'Answer', text: f.a },
		})),
	};
}

export function breadcrumbJsonLd(crumbs: Array<{ name: string; path: string }>): JsonLd {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: crumbs.map((c, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: c.name,
			item: canonicalUrl(c.path),
		})),
	};
}

/**
 * Serialize for a `<script type="application/ld+json">` body. `<` is escaped
 * so no string in the data can close the script element early.
 */
export function jsonLdScript(data: JsonLd | JsonLd[]): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}
