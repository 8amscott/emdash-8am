import { useEffect } from "react";

// The site-wide options live in a single-entry collection, listed first in
// the sidebar. Opening its list jumps straight to the entry, like an options page.
const OPTIONS_COLLECTION = "site_options";

const ADMIN = "/_emdash/admin";
const OPTIONS_LIST = `${ADMIN}/content/${OPTIONS_COLLECTION}`;
const SETTINGS = `${ADMIN}/plugins-manager/8am/settings`;
// `?list` keeps the plain list reachable while the options page is on
const OPTIONS_LIST_BYPASS = `${OPTIONS_LIST}?list`;

// EmDash has no setting to hide built-in admin UI, so what this plugin's
// settings switch off is hidden here; every hidden page stays linked from its
// setting on the settings page.
const NAV_BY_SETTING: Record<string, string[]> = {
	hideTaxonomies: ["/taxonomies/category", "/taxonomies/tag"],
	hideBylines: ["/bylines", "/byline-schema"],
	hideComments: ["/comments"],
	hideSections: ["/sections"],
	hideWidgets: ["/widgets"],
	hideImport: ["/import/wordpress"],
};
// Other admin controls, by selector.
const SELECTORS_BY_SETTING: Record<string, string[]> = {
	hideBylines: ['button[aria-label="Filter by byline"]'],
};
// Entry-editor side panels, matched by their heading (they carry no stable id).
const PANELS_BY_SETTING: Record<string, string[]> = {
	hideBylines: ["Bylines"],
	hideOwnership: ["Ownership"],
};
// Mirrors the settings defaults, so nothing flashes in before the settings load
// and non-admin roles (who can't read plugin settings) get the same admin.
const DEFAULTS: Record<string, boolean> = {
	optionsPage: true,
	delayCaptcha: true,
	refreshCache: true,
	pluginNames: true,
	hideTaxonomies: true,
	hideBylines: true,
	hideComments: true,
	hideOwnership: true,
	hideSections: true,
	hideWidgets: true,
	hideImport: true,
};

// Links shown under each setting on the settings page; labels match settingsSchema.
const SETTING_LINKS: Array<{ label: string; links: Array<[string, string]> }> = [
	{ label: "Options Page", links: [["Options", OPTIONS_LIST], ["Options list", OPTIONS_LIST_BYPASS]] },
	{ label: "Hide Categories & Tags", links: [["Categories", `${ADMIN}/taxonomies/category`], ["Tags", `${ADMIN}/taxonomies/tag`]] },
	{ label: "Hide Bylines", links: [["Bylines", `${ADMIN}/bylines`], ["Byline Schema", `${ADMIN}/byline-schema`]] },
	{ label: "Hide Comments", links: [["Comments", `${ADMIN}/comments`]] },
	{ label: "Hide Sections", links: [["Sections", `${ADMIN}/sections`]] },
	{ label: "Hide Widgets", links: [["Widgets", `${ADMIN}/widgets`]] },
	{ label: "Hide Import", links: [["Import", `${ADMIN}/import/wordpress`]] },
];

let settings: Record<string, unknown> = DEFAULTS;
const on = (key: string) => Boolean(settings[key] ?? DEFAULTS[key]);

function applyNav() {
	let style = document.getElementById("emdash-8am-nav");
	if (!style) {
		style = document.createElement("style");
		style.id = "emdash-8am-nav";
		document.head.append(style);
	}
	const hidden = Object.entries(NAV_BY_SETTING).flatMap(([key, routes]) =>
		on(key) ? routes.map((path) => `li[data-sidebar="menu-item"]:has(> a[href="${ADMIN}${path}"])`) : [],
	);
	hidden.push(...Object.entries(SELECTORS_BY_SETTING).flatMap(([key, selectors]) => (on(key) ? selectors : [])));
	hidden.push("[data-8am-hidden]");
	style.textContent = `${hidden.join(",\n")} { display: none; }`;
}

// Plugin ids must be lowercase and code-registered plugins can't set a display
// name (only marketplace installs get one), so the admin shows raw ids.
const PLUGIN_NAMES: Record<string, string> = {
	"8am": "8AM",
	"core-forms": "Core Forms",
	"emdash-smtp": "EmDash SMTP",
};

// a relabel isn't undone, so it waits for the real settings
let settingsLoaded = false;

function applyBrand() {
	if (!settingsLoaded || !on("pluginNames")) return;
	for (const el of document.querySelectorAll("h1, h2, h3, span, p, div, a")) {
		if (el.childElementCount) continue;
		const text = el.textContent ?? "";
		const settingsOf = text.endsWith(" Settings") ? text.slice(0, -" Settings".length) : null;
		if (PLUGIN_NAMES[text]) el.textContent = PLUGIN_NAMES[text];
		else if (settingsOf && PLUGIN_NAMES[settingsOf]) el.textContent = `${PLUGIN_NAMES[settingsOf]} Settings`;
	}
}

function applySettingLinks() {
	if (location.pathname !== SETTINGS) return;
	for (const { label, links } of SETTING_LINKS) {
		const title = [...document.querySelectorAll("main form *")].find(
			(el) => !el.childElementCount && el.textContent === label,
		);
		const description = title?.nextElementSibling;
		if (!description || description.querySelector("[data-8am-links]")) continue;
		const span = document.createElement("span");
		span.setAttribute("data-8am-links", "");
		span.append(" Open: ");
		links.forEach(([text, href], i) => {
			if (i) span.append(" · ");
			const a = document.createElement("a");
			a.href = href;
			a.textContent = text;
			a.style.textDecoration = "underline";
			span.append(a);
		});
		description.append(span);
	}
}

function applyPanels() {
	applyBrand();
	applySettingLinks();
	const titles = new Set(Object.entries(PANELS_BY_SETTING).flatMap(([key, names]) => (on(key) ? names : [])));
	for (const heading of document.querySelectorAll("section h3")) {
		const panel = heading.closest("section");
		if (!panel) continue;
		const hide = titles.has(heading.textContent?.trim() ?? "");
		if (hide !== panel.hasAttribute("data-8am-hidden")) panel.toggleAttribute("data-8am-hidden", hide);
	}
}

// Form definitions and plugin settings change what pages render, but EmDash only
// purges the page cache for content, menus and site settings. Saving site settings
// unchanged purges every cached page (each carries the site-settings tag).
const PURGE_AFTER = [
	/^\/_emdash\/api\/plugins\/core-forms\/forms\/(save|delete|import)$/,
	/^\/_emdash\/api\/admin\/plugins\/[^/]+\/settings$/,
];

function watchCacheChanges() {
	const original = window.fetch;
	window.fetch = async (input, init) => {
		const res = await original(input, init);
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		if (res.ok && method !== "GET" && on("refreshCache") && PURGE_AFTER.some((r) => r.test(url.pathname))) {
			void original("/_emdash/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				credentials: "same-origin",
				body: "{}",
			}).catch(() => {});
		}
		return res;
	};
}

let optionsId: string | null = null;

async function fetchOptionsId(): Promise<string | null> {
	if (optionsId) return optionsId;
	const res = await fetch(`/_emdash/api/content/${OPTIONS_COLLECTION}?limit=1`, {
		headers: { "X-EmDash-Request": "1" },
		credentials: "same-origin",
	}).catch(() => null);
	optionsId = (await res?.json().catch(() => null))?.data?.items?.[0]?.id ?? null;
	return optionsId;
}

let settingsReady: Promise<void> = Promise.resolve();
const atOptionsList = () =>
	location.pathname.replace(/\/$/, "") === OPTIONS_LIST && !new URLSearchParams(location.search).has("list");

// In-app navigation swaps the URL and lets the admin router follow popstate (no
// reload); a fresh page load does a plain redirect, since the router may not be
// listening yet.
async function openOptionsEntry(freshLoad = false) {
	if (!atOptionsList()) return;
	await settingsReady;
	if (!on("optionsPage")) return;
	const id = await fetchOptionsId();
	if (!id || !atOptionsList()) return;
	const target = `${OPTIONS_LIST}/${id}`;
	if (freshLoad) {
		location.replace(target);
		return;
	}
	history.replaceState(history.state, "", target);
	dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

if (typeof document !== "undefined") {
	applyNav();
	settingsReady = fetch("/_emdash/api/admin/plugins/8am/settings", { headers: { "X-EmDash-Request": "1" }, credentials: "same-origin" })
		.then((res) => (res.ok ? res.json() : null))
		.then((json) => {
			if (json?.data?.values) settings = json.data.values;
		})
		.catch(() => {})
		.finally(() => {
			settingsLoaded = true;
			applyNav();
			applyPanels();
		});
	// the admin re-renders constantly: scan at most once per frame
	let queued = false;
	new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			applyPanels();
		});
	}).observe(document.documentElement, { childList: true, subtree: true });

	for (const method of ["pushState", "replaceState"] as const) {
		const original = history[method];
		history[method] = function (...args: Parameters<History["pushState"]>) {
			const result = original.apply(this, args);
			queueMicrotask(() => void openOptionsEntry());
			return result;
		};
	}
	addEventListener("popstate", () => void openOptionsEntry());
	void openOptionsEntry(true);
	watchCacheChanges();
}

// The "8AM" sidebar item opens this plugin's settings. Guarded to its own route,
// so a stray mount can never redirect another page.
function SettingsPage() {
	useEffect(() => {
		if (!location.pathname.startsWith(`${ADMIN}/plugins/8am`)) return;
		history.replaceState(history.state, "", SETTINGS);
		dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
	}, []);
	return null;
}

export const pages = {
	"/": SettingsPage,
};
