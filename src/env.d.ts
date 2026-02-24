/// <reference types="astro/client-image" />

declare namespace App {
	interface Locals {
		/** True when accessed via theleague.us — omit /theleague prefix from links */
		hideLeaguePrefix: boolean;
	}
}

interface ImportMetaEnv {
	readonly PUBLIC_VERCEL_ANALYTICS_ID: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
