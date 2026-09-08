/**
 * Post-login destinations arrive from the client (`?next=`) and are replayed
 * into a `Location` header after the magic link is consumed. That is textbook
 * open-redirect territory: an attacker who can get `next=https://evil.example`
 * accepted gets a phishing page served from a link that genuinely came from
 * our domain, right after the victim proved they trust us.
 *
 * So the rule is allowlist-shaped, not blocklist-shaped: a destination must be
 * a plain same-origin path, or it is dropped entirely.
 */

const MAX_LENGTH = 512;

/**
 * Reject control characters (CR/LF header injection included), DEL, and
 * backslash. Checked by code point rather than a regex class, because an
 * escaped range here is easy to write wrong in a way that silently spans
 * printable characters and rejects every legitimate path.
 */
function hasForbiddenCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true; // control characters, DEL
    if (code === 0x5c) return true; // backslash
  }
  return false;
}

export function safeRedirect(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (next.length === 0 || next.length > MAX_LENGTH) return null;

  // Must be a rooted path, so an absolute URL can never appear.
  if (!next.startsWith("/")) return null;

  // "//evil.example" is a protocol-relative URL that browsers resolve
  // off-origin despite starting with a slash.
  if (next.startsWith("//")) return null;

  if (hasForbiddenCharacter(next)) return null;

  return next;
}
