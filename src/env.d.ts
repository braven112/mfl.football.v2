/// <reference types="astro/client" />

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

/** Compile-time: true only in a custom-site demo build (astro.config.ts `vite.define`). */
declare const __DEMO_BUILD__: boolean;
