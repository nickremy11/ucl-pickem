import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Spinner, Empty } from "../components/ui";
import { kickoffLabel, countdown } from "../lib/format";

export function Pool() {
  const { slug = "" } = useParams();
  const pool = useQuery({ queryKey: ["pool", slug], queryFn: () => api.pool(slug) });
  const rounds = useQuery({ queryKey: ["rounds", slug], queryFn: () => api.rounds(slug) });

  if (pool.isLoading || rounds.isLoading) return <Spinner />;
  if (pool.error || !pool.data) return <Empty title="Pool not found" />;

  const { pool: p } = pool.data;

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">{p.name}</h1>
          <p className="mt-0.5 text-xs text-chalk-500">
            {p.pickMode === "full" ? "Full choice" : "Against the spread"}
            {p.inviteCode && ` · code ${p.inviteCode}`}
          </p>
        </div>
        <Link
          to={`/p/${slug}/standings`}
          className="shrink-0 rounded-xl border border-pitch-700 bg-pitch-800 px-3.5 py-2 text-sm font-semibold text-chalk-200 hover:bg-pitch-700"
        >
          Standings
        </Link>
      </div>

      <div className="mt-6 space-y-2.5">
        {rounds.data?.rounds.map((r) => {
          const undrawn = r.contestCount === 0;
          const allPicked = r.contestCount > 0 && r.pickedCount >= r.contestCount;
          const missing = r.openCount > 0 && r.pickedCount < r.contestCount;

          const body = (
            <Card
              className={`p-4 ${
                undrawn ? "opacity-55" : "transition-colors hover:border-star-500/50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{r.name}</p>
                    <span className="rounded-md bg-pitch-800 px-1.5 py-0.5 text-[10px] font-semibold text-chalk-400">
                      {r.pointsPerPick} PT{r.pointsPerPick > 1 ? "S" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-chalk-500">
                    {undrawn
                      ? "Awaiting the draw"
                      : `${r.pickedCount}/${r.contestCount} picked${
                          r.firstKickoffAt ? ` · ${kickoffLabel(r.firstKickoffAt)}` : ""
                        }`}
                  </p>
                </div>

                {!undrawn && (
                  <div className="shrink-0 text-right">
                    {allPicked ? (
                      <span className="text-xs font-semibold text-win-500">✓ In</span>
                    ) : missing ? (
                      <span className="text-xs font-semibold text-warn-500">
                        {r.firstKickoffAt && countdown(r.firstKickoffAt)
                          ? `${countdown(r.firstKickoffAt)} left`
                          : "Open"}
                      </span>
                    ) : (
                      <span className="text-xs text-chalk-500">Locked</span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );

          return undrawn ? (
            <div key={r.code}>{body}</div>
          ) : (
            <Link key={r.code} to={`/p/${slug}/r/${r.code}`} className="block">
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
