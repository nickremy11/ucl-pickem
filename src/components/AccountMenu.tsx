import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";
import { Button, Input, Alert } from "./ui";

/** Mirrors the server's rule, so the error shows before a round trip. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

/**
 * Account menu hanging off the nav.
 *
 * Deliberately not a profile page: the only thing worth setting is a display
 * name, and burying that behind a route nobody visits means everyone stays
 * listed by their email address.
 */
export function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a panel that can only be dismissed
  // by re-clicking its trigger feels broken on a phone.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const displayName = user.username ?? user.email;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-full border border-pitch-700 bg-pitch-900/70 py-1 pr-3 pl-1 transition-colors hover:border-star-500/50"
      >
        <Avatar userId={user.id} name={displayName} size={24} />
        <span className="max-w-32 truncate text-xs font-semibold text-chalk-200">
          {user.username ?? user.email.split("@")[0]}
        </span>
        {!user.username && (
          // Quiet nudge: without a username you show up as your email address
          // to everyone else in the pool.
          <span className="size-1.5 rounded-full bg-warn-500" aria-label="Set a username" />
        )}
      </button>

      {open && <AccountPanel user={user} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AccountPanel({ user, onClose }: { user: User; onClose: () => void }) {
  const { refresh } = useAuth();
  const qc = useQueryClient();

  const [username, setUsername] = useState(user.username ?? "");
  const [saved, setSaved] = useState(false);

  const trimmed = username.trim();
  const unchanged = trimmed === (user.username ?? "");
  const invalid = trimmed.length > 0 && !USERNAME_PATTERN.test(trimmed);

  const save = useMutation({
    mutationFn: () => api.updateProfile({ username: trimmed }),
    onSuccess: () => {
      refresh();
      // Standings and member lists render this name server-side.
      qc.invalidateQueries({ queryKey: ["standings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  return (
    <div
      role="dialog"
      aria-label="Account"
      className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-pitch-700 bg-pitch-900 p-4 shadow-2xl shadow-black/60"
    >
      <p className="text-[11px] font-bold tracking-[0.14em] text-chalk-500 uppercase">
        Signed in as
      </p>
      <p className="mt-1 truncate text-sm text-chalk-200">{user.email}</p>

      <div className="mt-4">
        <label className="mb-1.5 block text-[11px] font-bold tracking-[0.14em] text-chalk-400 uppercase">
          Username
        </label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. nickr"
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !invalid && !unchanged) save.mutate();
          }}
        />
        <p className="mt-1.5 text-[11px] text-chalk-500">
          {invalid
            ? "3–20 characters: letters, numbers, underscore or hyphen."
            : "Shown instead of your email in standings and picks."}
        </p>
      </div>

      {save.error && (
        <div className="mt-3">
          <Alert>{(save.error as ApiError).message}</Alert>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          loading={save.isPending}
          disabled={invalid || unchanged || trimmed.length === 0}
          onClick={() => save.mutate()}
        >
          {saved ? "Saved" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mt-4 border-t border-pitch-800 pt-3">
        <button
          type="button"
          onClick={async () => {
            await api.logout();
            qc.clear();
            refresh();
          }}
          className="text-xs text-chalk-400 underline-offset-4 hover:text-chalk-200 hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
