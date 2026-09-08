const ALPHABET = "0123456789abcdefghijkmnpqrstvwxyz"; // Crockford-ish: no i, l, o, u

/** URL-safe random id. 21 chars of this alphabet ≈ 105 bits of entropy. */
export function newId(length = 21): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Pool invite code.
 *
 * Possession of this is what authorises joining through an invite link, so it
 * is sized as a credential, not a convenience: 12 characters of a 33-symbol
 * alphabet is about 60 bits. Still short enough to read aloud, and a pool admin
 * can regenerate it to revoke every outstanding link.
 */
export function newInviteCode(): string {
  return newId(12).toUpperCase();
}

/** Slug from a pool name, with a random suffix so names can collide freely. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "pool"}-${newId(5)}`;
}
