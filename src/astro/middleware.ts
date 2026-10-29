import { defineMiddleware } from "astro:middleware";

// Review hosts are never indexable, whatever the admin SEO settings say. On the
// real domain this steps aside: EmDash serves robots.txt from Settings > SEO
// and each page's own noindex toggle applies.
const isReviewHost = (host: string) => host.endsWith(".workers.dev") || host === "localhost";

const NOINDEX = "noindex, nofollow";

export const onRequest = defineMiddleware(async (context, next) => {
	if (!isReviewHost(context.url.hostname)) return next();
	if (context.url.pathname === "/robots.txt") {
		return new Response("User-agent: *\nDisallow: /\n", {
			headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": NOINDEX },
		});
	}
	const response = await next();
	// redirects and fetched responses carry immutable headers; copy before setting
	const out = new Response(response.body, response);
	out.headers.set("X-Robots-Tag", NOINDEX);
	return out;
});
