const ALPHABET = "0123456789abcdefghijkmnpqrstvwxyz"; // Crockford-ish: no i, l, o, u

/** URL-safe random id. 21 chars of this alphabet ≈ 105 bits of entropy. */
export function newId(length = 21): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Short, human-readable, unambiguous code for pool invites. */
export function newInviteCode(): string {
  return newId(8).toUpperCase();
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
