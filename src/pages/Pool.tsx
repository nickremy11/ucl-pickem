import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type RoundSummary } from "../lib/api";
import { Card, Spinner, Empty } from "../components/ui";
import { StarMark } from "../components/brand";
import { InviteLink } from "../components/InviteLink";
import { kickoffLabel, countdown } from "../lib/format";

export function Pool() {
  const { slug = "" } = useParams();
  const pool = useQuery({ queryKey: ["pool", slug], queryFn: () => api.pool(slug) });
  const rounds = useQuery({ queryKey: ["rounds", slug], queryFn: () => api.rounds(slug) });

  if (pool.isLoading || rounds.isLoading) return <Spinner />;
  if (pool.error || !pool.data) return <Empty title="Pool not found" />;

  const { pool: p } = pool.data;
  const list = rounds.data?.rounds ?? [];
  const league = list.filter((r) => r.kind === "league");
  const knockout = list.filter((r) => r.kind === "knockout");

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight">{p.name}</h1>
          <p className="mt-1 text-xs text-chalk-500">
            {p.pickMode === "full" ? "Full choice" : "Against the spread"}
          </p>
        </div>
        <Link
          to={`/p/${slug}/standings`}
          className="shrink-0 rounded-xl border border-star-500/40 bg-star-500/10 px-3.5 py-2 text-sm font-semibold text-star-300 transition-colors hover:bg-star-500/20"
        >
          Standings
        </Link>
      </div>

      {p.inviteCode && p.joinOpen && (
        <div className="mt-5">
          <InviteLink code={p.inviteCode} poolName={p.name} />
        </div>
      )}

      <Section title="League phase" />
      <div className="space-y-2.5">
        {league.map((r) => (
          <RoundCard key={r.code} round={r} slug={slug} />
        ))}
      </div>

      <Section title="Knockouts" />
      <div className="space-y-2.5">
        {knockout.map((r) => (
          <RoundCard key={r.code} round={r} slug={slug} />
        ))}
      </div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="mt-8 mb-3">
      <h2 className="text-[11px] font-bold tracking-[0.14em] text-chalk-400 uppercase">{title}</h2>
      <div className="rule mt-2" />
    </div>
  );
}

function RoundCard({ round: r, slug }: { round: RoundSummary; slug: string }) {
  const undrawn = r.contestCount === 0;
  const allPicked = r.contestCount > 0 && r.pickedCount >= r.contestCount;
  const open = r.openCount > 0;
  const missing = open && r.pickedCount < r.contestCount;
  const pct = r.contestCount > 0 ? (r.pickedCount / r.contestCount) * 100 : 0;

  const body = (
    <Card
      className={`relative overflow-hidden p-4 ${
        undrawn ? "opacity-50" : "transition-all hover:border-star-500/50 hover:bg-pitch-850/70"
      }`}
    >
      <div className="flex items-center gap-3.5">
        <Badge round={r} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-bold">{r.name}</p>
            <span className="shrink-0 rounded-md border border-star-500/30 bg-star-500/10 px-1.5 py-0.5 text-[10px] font-bold text-star-300">
              {r.pointsPerPick} PT{r.pointsPerPick > 1 ? "S" : ""}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-chalk-500">
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
              <span className="text-xs font-bold text-win-500">✓ In</span>
            ) : missing ? (
              <span className="text-xs font-bold text-warn-500">
                {r.firstKickoffAt && countdown(r.firstKickoffAt)
                  ? countdown(r.firstKickoffAt)
                  : "Open"}
              </span>
            ) : (
              <span className="text-xs text-chalk-500">Locked</span>
            )}
          </div>
        )}
      </div>

      {!undrawn && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-pitch-800">
          <div
            className={`h-full rounded-full transition-all ${
              allPicked ? "bg-win-500" : "bg-gradient-to-r from-star-500 to-nebula-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </Card>
  );

  return undrawn ? (
    <div>{body}</div>
  ) : (
    <Link to={`/p/${slug}/r/${r.code}`} className="block">
      {body}
    </Link>
  );
}

/** Matchday number for the league phase, a star for the knockout rounds. */
function Badge({ round: r }: { round: RoundSummary }) {
  const md = r.code.startsWith("MD") ? r.code.slice(2) : null;

  return (
    <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-pitch-700 bg-gradient-to-br from-pitch-800 to-pitch-900">
      {md ? (
        <span className="tnum text-base font-black text-star-300">{md}</span>
      ) : (
        <StarMark size={22} />
      )}
    </div>
  );
}
