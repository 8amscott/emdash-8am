# emdash-8am

8AM Creative's toolkit for [EmDash](https://github.com/emdash-cms/emdash) sites on Cloudflare Workers. One package, four parts:

| Import | What it does |
|---|---|
| `emdash-8am` | **The 8AM admin plugin.** Settings under Plugins → 8AM, each with an on/off switch: Options opens as a settings page, Delay Captcha (Turnstile waits for the visitor's first interaction), Refresh Cache (form and plugin-settings saves clear cached pages), readable plugin names, and hiding admin items a marketing site doesn't use. |
| `emdash-8am/astro` | **Astro integration** `eightAmSite()`: blocks search crawlers on review hosts (`*.workers.dev`, localhost), lets Astro resize EmDash media into WebP srcsets, turns on Cloudflare's edge page cache, and types the theme's `disableremoteplayback` video attribute. |
| `emdash-8am/ResponsiveImage.astro`, `emdash-8am/chrome`, `emdash-8am/media` | **Shared code for themes:** `<ResponsiveImage>` for EmDash images, `loadChrome()` for the site-wide data each page renders (settings, menus, Options), and `mediaUrl()` / `inlineSvg()`. |
| `npx emdash-8am pull` / `push` | **Content sync** between local dev and live. Accounts, form submissions and plugin settings stay on each side. |

## Install

```bash
npm i github:8amscott/emdash-8am#v0.2.0
```

```js
// astro.config.mjs
import { eightAmSite } from "emdash-8am/astro";
import { eightAm } from "emdash-8am";

export default defineConfig({
	integrations: [
		eightAmSite(),          // optional: eightAmSite({ routeRules: { ... } })
		emdash({ plugins: [eightAm(), /* others */] }),
	],
});
```

```json
// package.json scripts
"pull:live": "emdash-8am pull",
"push:live": "emdash-8am push"
```

Pages load site-wide data in their own frontmatter, so cache tags reach the response:

```astro
---
import { loadChrome } from "emdash-8am/chrome";
const chrome = await loadChrome(Astro, { menus: { nav: "nav-menu", footer: "footer-menu" } });
---
```

## Updating a site

Bump the tag in the site's `package.json` (`#v0.2.0` → the new tag), `npm install`, commit and push.
