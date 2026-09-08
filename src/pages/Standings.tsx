import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, Spinner, Empty } from "../components/ui";
import { Avatar } from "../components/Avatar";

export function Standings() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["standings", slug],
    queryFn: () => api.standings(slug),
  });

  const [tab, setTab] = useState<string>("TOTAL");

  if (isLoading) return <Spinner />;
  if (error || !data) return <Empty title="Standings unavailable" />;

  // Only rounds that have actually started are worth a tab.
  const playedRounds = data.rounds.filter((r) => r.status !== "scheduled");
  const showing = tab === "TOTAL" ? null : tab;

  const rows = [...data.standings].sort((a, b) => {
    if (!showing) return b.total - a.total || a.name.localeCompare(b.name);
    const av = a.rounds[showing]?.points ?? 0;
    const bv = b.rounds[showing]?.points ?? 0;
    return bv - av || a.name.localeCompare(b.name);
  });

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Link to={`/p/${slug}`} className="text-sm text-chalk-400 hover:text-chalk-200">
        ‹ Back
      </Link>
      <h1 className="mt-2 text-2xl font-black tracking-tight">Standings</h1>
      <p className="mt-0.5 text-xs text-chalk-500">{data.pool.name}</p>

      <div className="mt-5 -mx-5 overflow-x-auto px-5">
        <div className="flex w-max gap-1.5">
          <Tab active={tab === "TOTAL"} onClick={() => setTab("TOTAL")} label="Total" />
          {playedRounds.map((r) => (
            <Tab
              key={r.code}
              active={tab === r.code}
              onClick={() => setTab(r.code)}
              label={r.code.startsWith("MD") ? r.code : r.name}
            />
          ))}
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-chalk-500">No members yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pitch-800 text-[11px] tracking-wide text-chalk-500 uppercase">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-1 py-2.5 text-left font-medium">Player</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  {showing ? "Round" : "Total"}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Picks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const cell = showing ? row.rounds[showing] : null;
                const points = showing ? (cell?.points ?? 0) : row.total;

                // On Total, sum picks across every round that has fixtures,
                // rather than leaving the column blank.
                const picks = showing
                  ? cell && `${cell.picksMade}/${cell.picksPossible}`
                  : (() => {
                      let made = 0;
                      let possible = 0;
                      for (const r of data.rounds) {
                        const c = row.rounds[r.code];
                        if (!c) continue;
                        made += c.picksMade;
                        possible += c.picksPossible;
                      }
                      return possible > 0 ? `${made}/${possible}` : null;
                    })();

                const isMe = row.userId === user?.id;
                // Podium colours only mean anything on the running total.
                const medal = !showing
                  ? ["text-gold-400", "text-silver-400", "text-bronze-400"][i]
                  : undefined;

                return (
                  <tr
                    key={row.userId}
                    className={`border-b border-pitch-800/60 last:border-0 ${
                      isMe ? "bg-star-500/8" : ""
                    }`}
                  >
                    <td className={`tnum px-4 py-3 font-bold ${medal ?? "text-chalk-500"}`}>
                      {i + 1}
                    </td>
                    <td className="px-1 py-3">
                      <span className="flex items-center gap-2.5">
                        <Avatar userId={row.userId} name={row.name} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{row.name}</span>
                          {isMe && (
                            <span className="text-[10px] font-bold tracking-wide text-star-400">
                              YOU
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="tnum px-4 py-3 text-right text-base font-black">{points}</td>
                    <td className="tnum px-4 py-3 text-right text-xs text-chalk-500">
                      {picks ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {showing && (
        <p className="mt-3 text-xs text-chalk-500">
          Showing points earned in this round only. Tap Total for the running score.
        </p>
      )}
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
        active
          ? "bg-gradient-to-r from-star-500 to-nebula-500 text-white shadow-[0_0_16px_-4px] shadow-star-500/60"
          : "bg-pitch-800 text-chalk-400 hover:bg-pitch-700"
      }`}
    >
      {label}
    </button>
  );
}
