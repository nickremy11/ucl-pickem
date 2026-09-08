import type { Contest, RevealedPick, Selection } from "../lib/api";
import { Avatar } from "./Avatar";

/**
 * Everyone's picks for a contest, shown only once it has locked.
 *
 * The server withholds unlocked picks entirely rather than relying on this
 * component to hide them, so there is nothing here to leak.
 */
export function RevealedPicks({
  contest,
  memberCount,
  meId,
}: {
  contest: Contest;
  memberCount: number;
  meId?: string;
}) {
  if (!contest.locked || contest.picks.length === 0) return null;

  const groups: { selection: Selection; label: string; picks: RevealedPick[] }[] = [
    { selection: "SIDE_A", label: contest.sideA.shortName, picks: [] },
    { selection: "DRAW", label: "Draw", picks: [] },
    { selection: "SIDE_B", label: contest.sideB.shortName, picks: [] },
  ];
  for (const pick of contest.picks) {
    groups.find((g) => g.selection === pick.selection)?.picks.push(pick);
  }

  const shown = groups.filter(
    (g) => g.picks.length > 0 || contest.allowedSelections.includes(g.selection),
  );
  const missing = memberCount - contest.picks.length;

  return (
    <div className="border-t border-pitch-800 px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        {shown.map((group) => {
          const won = contest.outcome === group.selection;
          return (
            <div key={group.selection} className="min-w-0">
              <p
                className={`text-[10px] font-bold tracking-wide uppercase ${
                  won ? "text-win-500" : "text-chalk-500"
                }`}
              >
                {group.label}
                <span className="ml-1 opacity-70">{group.picks.length}</span>
              </p>

              {group.picks.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-chalk-500">—</p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.picks.map((pick) => (
                    <span
                      key={pick.userId}
                      title={pick.name}
                      className={`inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 ${
                        pick.userId === meId ? "bg-star-500/20" : "bg-pitch-800"
                      }`}
                    >
                      <Avatar userId={pick.userId} name={pick.name} size={18} />
                      <span className="max-w-20 truncate text-[11px] font-medium text-chalk-200">
                        {pick.name}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {missing > 0 && (
        <p className="mt-2.5 text-[11px] text-chalk-500">
          {missing} {missing === 1 ? "player" : "players"} didn&rsquo;t pick this one.
        </p>
      )}
    </div>
  );
}
