const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const HTTPS_PROTOCOL = "https:";
const MAX_URL_LENGTH = 2048;
const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = appEnv === "production";

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPrivateHostname(hostname: string): boolean {
  const value = normalizeHostname(hostname);
  if (
    value === "localhost" ||
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  ) {
    return true;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return true;
    }
    if (octets[0] === 10) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  }

  if (value.includes(":") && (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd"))) {
    return true;
  }

  return false;
}

/**
 * Parse and validate only HTTP(S) URLs to avoid opening unsupported or unsafe schemes.
 */
export function parseHttpUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (value.length > MAX_URL_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    if (!parsed.hostname || parsed.hostname.length > 253) {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (isProduction && parsed.protocol !== HTTPS_PROTOCOL) {
      return null;
    }
    if (isProduction && isPrivateHostname(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
