// Placeholder origin for media handed to Astro's image service. EmDash's image
// endpoint resolves /_emdash/api/media/file/<key> from storage by path and never
// fetches the host, and .invalid can never resolve (RFC 2606), so authorizing it
// in image.remotePatterns opens nothing and works on every domain unchanged.
export const MEDIA_TRANSFORM_ORIGIN = "https://media.invalid";
