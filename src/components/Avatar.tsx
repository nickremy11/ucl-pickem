/**
 * Deterministic avatar for a pool member.
 *
 * Colour is derived from the user id, so the same person is the same colour on
 * every device and across reloads without storing anything. Initials come from
 * the display name the pool already shows.
 */
const PALETTE = [
  ["#3b6ef5", "#7c4dff"],
  ["#34d399", "#0ea5a5"],
  ["#f0b542", "#e2764b"],
  ["#f0645a", "#c2417c"],
  ["#6ea8ff", "#2b56cc"],
  ["#a78bfa", "#6d28d9"],
  ["#2dd4bf", "#3b82f6"],
  ["#fb923c", "#ef4444"],
] as const;

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  userId,
  name,
  size = 32,
}: {
  userId: string;
  name: string;
  size?: number;
}) {
  const [from, to] = PALETTE[hash(userId) % PALETTE.length];

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: Math.round(size * 0.36),
      }}
      className="grid shrink-0 place-items-center rounded-full font-bold text-white/95"
    >
      {initials(name)}
    </span>
  );
}
