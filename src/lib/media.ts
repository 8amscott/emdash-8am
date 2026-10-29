import sanitizeHtml from "sanitize-html";

type MediaRef = {
	id?: string;
	src?: string;
	url?: string;
	alt?: string;
	width?: number;
	height?: number;
	filename?: string;
	meta?: { storageKey?: string };
} | null | undefined;

type EmdashLocals = {
	getPublicMediaUrl?: (storageKey: string) => string;
	storage?: { download(key: string): Promise<{ body: BodyInit }> } | null;
};

// Resolve a media field value (image or file) to a servable URL.
export function mediaUrl(emdash: EmdashLocals | undefined, media: MediaRef): string {
	if (!media) return "";
	const key = media.meta?.storageKey;
	if (key && emdash?.getPublicMediaUrl) return emdash.getPublicMediaUrl(key);
	return media.src ?? media.url ?? "";
}

// Read an SVG media file from storage, sanitize it, and cache it per storage key.
// Reads storage directly: a Worker can't fetch its own workers.dev URL.
const svgCache = new Map<string, string>();

export async function inlineSvg(emdash: EmdashLocals | undefined, media: MediaRef): Promise<string> {
	const key = media?.meta?.storageKey;
	if (!key || !emdash?.storage) return "";
	const hit = svgCache.get(key);
	if (hit !== undefined) return hit;
	try {
		const { body } = await emdash.storage.download(key);
		const svg = sanitizeHtml(await new Response(body).text(), {
			allowedTags: false,
			allowedAttributes: false,
			disallowedTagsMode: "discard",
			nonBooleanAttributes: [],
			exclusiveFilter: (f) => ["script", "foreignObject"].includes(f.tag),
			parser: { lowerCaseAttributeNames: false },
		});
		svgCache.set(key, svg);
		return svg;
	} catch {
		return "";
	}
}
