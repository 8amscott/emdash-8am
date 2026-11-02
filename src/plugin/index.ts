import { definePlugin, getRequestContext } from "emdash";
import type { PageFragmentContribution, PluginContext, PluginDescriptor, PublicPageContext, ResolvedPlugin } from "emdash";

export const PLUGIN_ID = "8am";
const VERSION = "0.2.2";
const PACKAGE_NAME = "emdash-8am";

export function eightAm(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: PACKAGE_NAME,
		adminEntry: `${PACKAGE_NAME}/admin`,
		options: {},
	};
}

// Turnstile renders every .cf-turnstile as soon as its script loads, and the
// widget's challenge is the cost (headless browsers, PageSpeed's included, get
// the heavy one). Widgets are renamed as the page parses, then rendered on the
// visitor's first interaction. A <script> the parser has reached can't be
// stopped, so this holds the widgets, not the script.
const DELAY_CAPTCHA = `(function () {
	var EVENTS = ["pointerdown", "keydown", "touchstart", "scroll", "focusin"];
	var held = [];
	var observer = new MutationObserver(function (records) {
		records.forEach(function (r) {
			r.addedNodes.forEach(function (n) {
				if (n.nodeType !== 1) return;
				Array.prototype.forEach.call(n.matches(".cf-turnstile") ? [n] : n.querySelectorAll(".cf-turnstile"), function (el) {
					el.classList.replace("cf-turnstile", "cf-turnstile-held");
					held.push(el);
				});
			});
		});
	});
	function stop() {
		observer.disconnect();
		EVENTS.forEach(function (e) { removeEventListener(e, release, true); });
	}
	function render() {
		if (!window.turnstile) return setTimeout(render, 100);
		held.forEach(function (el) {
			el.classList.replace("cf-turnstile-held", "cf-turnstile");
			window.turnstile.render(el);
		});
	}
	function release() {
		stop();
		render();
	}
	observer.observe(document.documentElement, { childList: true, subtree: true });
	EVENTS.forEach(function (e) { addEventListener(e, release, { capture: true, passive: true }); });
	document.addEventListener("DOMContentLoaded", function () { if (!held.length) stop(); });
})();`;

// The edit toolbar only offers Open in admin and Publish when the page carries an
// entry-level data-emdash-ref. Templates would have to spread {...entry.edit} to
// get one; this prints it from the page context instead, and like entry.edit only
// in edit mode, so visitors and cached pages never carry it. Field-level refs are
// not worth adding: the toolbar can't inline-edit page-builder block fields.
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
async function entryRef(page: PublicPageContext, ctx: PluginContext): Promise<string | null> {
	const content = page.content;
	if (!content || !ctx.content || !getRequestContext()?.editMode) return null;
	const entry = await ctx.content.get(content.collection, content.id);
	if (!entry) return null;
	const ref: Record<string, unknown> = { collection: content.collection, id: content.id, status: entry.status };
	if (entry.draftRevisionId && entry.draftRevisionId !== entry.liveRevisionId) ref.hasDraft = true;
	return `<span hidden data-emdash-ref='${escapeAttr(JSON.stringify(ref))}'></span>`;
}

export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		capabilities: ["hooks.page-fragments:register", "content:read"],
		hooks: {
			"page:fragments": async (event, ctx) => {
				const out: PageFragmentContribution[] = [];
				if ((await ctx.settings.get<boolean>("delayCaptcha")) !== false) {
					out.push({ kind: "inline-script", placement: "head", code: DELAY_CAPTCHA, key: "8am-delay-captcha" });
				}
				if ((await ctx.settings.get<boolean>("entryToolbar")) !== false) {
					const html = await entryRef(event.page, ctx);
					if (html) out.push({ kind: "html", placement: "body:start", html, key: "8am-entry-ref" });
				}
				return out.length ? out : null;
			},
		},
		admin: {
			entry: `${PACKAGE_NAME}/admin`,
			pages: [{ path: "/", label: "8AM", icon: "gear" }],
			settingsSchema: {
				optionsPage: {
					type: "boolean",
					label: "Options Page",
					description: "Options opens its single entry directly, like an options page, instead of a list.",
					default: true,
				},
				delayCaptcha: {
					type: "boolean",
					label: "Delay Captcha",
					description: "Holds each form's Turnstile check until user interaction, so it doesn't slow the page load.",
					default: true,
				},
				entryToolbar: {
					type: "boolean",
					label: "Entry Toolbar",
					description: "Gives the site's edit toolbar an Open in admin link and a Publish button for the page being viewed. Page-builder content can't be edited in place either way.",
					default: true,
				},
				refreshCache: {
					type: "boolean",
					label: "Refresh Cache",
					description: "Clears the site's cached pages when a form or a plugin's settings are saved, so the change shows right away. EmDash already does this for content, menus and site settings.",
					default: true,
				},
				pluginNames: {
					type: "boolean",
					label: "Plugin Names",
					description: "Shows plugins by name instead of their lowercase ids. Takes effect on the next page load.",
					default: true,
				},
				hideTaxonomies: {
					type: "boolean",
					label: "Hide Categories & Tags",
					description: "Removes Categories and Tags from the sidebar. They group blog posts.",
					default: true,
				},
				hideBylines: {
					type: "boolean",
					label: "Hide Bylines",
					description: "Removes Bylines and Byline Schema from the sidebar, and the Bylines panel from the editor. Bylines are blog author credits.",
					default: true,
				},
				hideComments: {
					type: "boolean",
					label: "Hide Comments",
					description: "Removes Comments from the sidebar.",
					default: true,
				},
				hideOwnership: {
					type: "boolean",
					label: "Hide Ownership",
					description: "Removes the Ownership (entry author) panel from the editor. It only matters when Author or Contributor roles should be limited to their own entries.",
					default: true,
				},
				hideSections: {
					type: "boolean",
					label: "Hide Sections",
					description: "Removes Sections from the sidebar. Sections are reusable rich-text snippets inserted into a rich-text field with /section; inserting pastes a copy.",
					default: true,
				},
				hideWidgets: {
					type: "boolean",
					label: "Hide Widgets",
					description: "Removes Widgets from the sidebar. Widget areas only appear on the site where a template renders them.",
					default: true,
				},
				hideImport: {
					type: "boolean",
					label: "Hide Import",
					description: "Removes Import from the sidebar. It brings a WordPress site's content in, once, during a migration.",
					default: true,
				},
			},
		},
	});
}

export default createPlugin;
