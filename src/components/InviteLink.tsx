import { useState } from "react";
import { Card } from "./ui";

/**
 * Share control for a pool's invite link.
 *
 * Uses the native share sheet where it exists (that is the path on a phone,
 * straight into a group chat) and falls back to clipboard. Both are wrapped:
 * `navigator.share` rejects on user cancel, and clipboard access throws
 * outright in some embedded browsers.
 */
export function InviteLink({ code, poolName }: { code: string; poolName: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const url = `${window.location.origin}/join/${code}`;

  async function share() {
    setFailed(false);

    if (navigator.share) {
      try {
        await navigator.share({
          title: poolName,
          text: `Join ${poolName} on UCL Pick'em`,
          url,
        });
        return;
      } catch {
        // Cancelled, or unavailable in this context — fall through to copy.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: show the URL so it can be selected by hand.
      setFailed(true);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.14em] text-chalk-400 uppercase">
            Invite link
          </p>
          <p className="mt-1 truncate font-mono text-xs text-star-300">{url}</p>
        </div>
        <button
          type="button"
          onClick={share}
          className="shrink-0 rounded-xl border border-star-500/40 bg-star-500/10 px-3.5 py-2 text-sm font-semibold text-star-300 transition-colors hover:bg-star-500/20 active:scale-95"
        >
          {copied ? "Copied" : "Share"}
        </button>
      </div>

      {failed && (
        <p className="border-t border-pitch-800 px-4 py-2 text-[11px] text-chalk-500">
          Copying was blocked — select the link above and copy it manually.
        </p>
      )}

      <p className="border-t border-pitch-800 px-4 py-2 text-[11px] text-chalk-500">
        Anyone with this link can join without a password, until the season kicks off.
      </p>
    </Card>
  );
}
