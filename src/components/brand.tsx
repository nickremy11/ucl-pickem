/**
 * Brand marks.
 *
 * Deliberately *evocative* of European club football rather than a copy of any
 * UEFA asset — a starred ring and a starfield, not the competition's own
 * trademarked ball. Team crests are the real thing, served from the data
 * provider that licenses them.
 */

export function StarMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  // Eight stars around a ring, scaling with distance for a little depth.
  const stars = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return {
      x: 24 + Math.cos(angle) * 15,
      y: 24 + Math.sin(angle) * 15,
      r: i % 2 === 0 ? 3.6 : 2.6,
    };
  });

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <defs>
        <linearGradient id="starmark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9dc4ff" />
          <stop offset="55%" stopColor="#3b6ef5" />
          <stop offset="100%" stopColor="#7c4dff" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" stroke="url(#starmark-g)" strokeWidth="2" opacity="0.55" />
      {stars.map((s, i) => (
        <Star key={i} cx={s.x} cy={s.y} r={s.r} fill="url(#starmark-g)" />
      ))}
      <Star cx={24} cy={24} r={7} fill="url(#starmark-g)" />
    </svg>
  );
}

/** Five-pointed star as a single path, centred on (cx, cy). */
function Star({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return <polygon points={points.join(" ")} fill={fill} />;
}

/**
 * Fixed starfield behind the whole app. Pure CSS radial gradients rather than
 * an image, so it costs no request and stays crisp at any density.
 */
export function Starfield() {
  return <div aria-hidden="true" className="starfield" />;
}

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StarMark size={size === "lg" ? 40 : 24} />
      <span
        className={`font-black tracking-tight ${
          size === "lg" ? "text-3xl" : "text-sm"
        } bg-gradient-to-r from-white via-chalk-200 to-star-400 bg-clip-text text-transparent`}
      >
        UCL Pick&rsquo;em
      </span>
    </span>
  );
}
