import type { AstroGlobal } from "astro";
import { getEmDashCollection, getMenuWithCacheHint, getSiteSettingsWithCacheHint } from "emdash";

// Site-wide data every page renders: settings, menus and the Options entry.
// Pages load it in their own frontmatter, before their own cache decisions:
// cache tags set in a layout arrive after the response headers have gone out,
// so edits to these would never purge cached pages.
export async function loadChrome<M extends Record<string, string>>(
	Astro: AstroGlobal,
	{ menus, optionsCollection = "site_options" }: { menus: M; optionsCollection?: string },
) {
	const names = Object.keys(menus) as (keyof M)[];
	const [settings, options, ...menuResults] = await Promise.all([
		getSiteSettingsWithCacheHint(),
		getEmDashCollection(optionsCollection, { limit: 1 }),
		...names.map((key) => getMenuWithCacheHint(menus[key])),
	]);
	if (Astro.cache?.enabled) {
		for (const r of [settings, options, ...menuResults]) Astro.cache.set(r.cacheHint);
	}
	return {
		settings: settings.data,
		menus: Object.fromEntries(names.map((key, i) => [key, menuResults[i].data])) as {
			[K in keyof M]: (typeof menuResults)[number]["data"];
		},
		options: options.entries?.[0]?.data ?? {},
	};
}
