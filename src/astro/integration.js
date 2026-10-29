import { MEDIA_TRANSFORM_ORIGIN } from "./media-origin.js";

// Pages are cached at Cloudflare's edge; EmDash purges them by tag on every publish,
// menu or settings change (and the 8AM plugin on form and plugin-settings saves),
// so the long maxAge never serves stale content.
const DEFAULT_ROUTE_RULES = {
	"/": { maxAge: 86400, swr: 86400 },
	"/[slug]": { maxAge: 86400, swr: 86400 },
};

// Astro's JSX types lag the platform: disableremoteplayback is a real video attribute.
const VIDEO_TYPES = `declare namespace astroHTML.JSX {
	interface VideoHTMLAttributes {
		disableremoteplayback?: boolean | string | undefined | null;
	}
}
`;

/**
 * 8AM's site setup for EmDash on Cloudflare Workers: crawl block on review hosts,
 * resized WebP srcsets for EmDash media, edge cache rules, and video typing.
 *
 * The cache provider itself must stay in astro.config.mjs
 * (`cache: { provider: cacheCloudflare() }`): the Cloudflare adapter decides whether
 * to switch on Workers caching before this integration's hooks run.
 * @param {{ routeRules?: Record<string, { maxAge?: number, swr?: number }> }} [options]
 *   routeRules: cache rules per route pattern; add every public route the site has.
 */
export function eightAmSite({ routeRules = DEFAULT_ROUTE_RULES } = {}) {
	return {
		name: "emdash-8am",
		hooks: {
			"astro:config:setup": ({ updateConfig, addMiddleware }) => {
				addMiddleware({ entrypoint: "emdash-8am/middleware", order: "pre" });
				updateConfig({
					routeRules,
					image: {
						remotePatterns: [
							{
								protocol: "https",
								hostname: new URL(MEDIA_TRANSFORM_ORIGIN).hostname,
								pathname: "/_emdash/api/media/file/**",
							},
						],
					},
				});
			},
			"astro:config:done": ({ config, injectTypes, logger }) => {
				injectTypes({ filename: "video.d.ts", content: VIDEO_TYPES });
				if (config.cache?.provider?.name !== "cloudflare") {
					logger.warn('Pages won\'t be edge-cached: add `cache: { provider: cacheCloudflare() }` (from "@astrojs/cloudflare/cache") to astro.config.mjs.');
				}
			},
		},
	};
}
