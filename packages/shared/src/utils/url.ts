const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "ref_src"
]);

export function canonicalizeUrl(urlString: string): string {
  const url = new URL(urlString);
  url.hash = "";

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  url.search = "";
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  return url.toString();
}
