import { useState } from "react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-pitch-700/60 bg-pitch-900/70 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const styles = {
    primary: "bg-star-500 hover:bg-star-600 text-white",
    ghost: "bg-pitch-800 hover:bg-pitch-700 text-chalk-200 border border-pitch-700",
    danger: "bg-lose-500/90 hover:bg-lose-500 text-white",
  }[variant];

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      )}
      {children}
    </button>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full rounded-xl border border-pitch-700 bg-pitch-950/60 px-3.5 py-2.5 text-sm text-chalk-50 outline-none placeholder:text-chalk-500 focus:border-star-500 focus:ring-2 focus:ring-star-500/30 ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-chalk-400 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-chalk-500">{hint}</span>}
    </label>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "ok"; children: ReactNode }) {
  const styles = {
    error: "border-lose-500/40 bg-lose-500/10 text-lose-500",
    info: "border-star-500/40 bg-star-500/10 text-star-400",
    ok: "border-win-500/40 bg-win-500/10 text-win-500",
  }[kind];
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}>{children}</div>
  );
}

export function Crest({
  team,
  size = 28,
}: {
  team: { shortName: string; crestUrl: string | null };
  size?: number;
}) {
  // Provider crest URLs do occasionally 404. Falling back to initials keeps the
  // row readable instead of leaving a blank gap where a badge should be.
  const [broken, setBroken] = useState(false);

  if (!team.crestUrl || broken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-pitch-700 text-[9px] font-bold text-chalk-400"
      >
        {team.shortName.slice(0, 3).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={team.crestUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <span className="size-7 animate-spin rounded-full border-2 border-pitch-700 border-t-star-500" />
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-semibold text-chalk-200">{title}</p>
      {body && <p className="mt-1.5 text-sm text-chalk-500">{body}</p>}
    </Card>
  );
}
