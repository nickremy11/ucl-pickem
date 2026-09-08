import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Contest, type RoundDetail, type Selection } from "../lib/api";
import { Card, Spinner, Empty, Alert, Crest } from "../components/ui";
import { MatchScore } from "../components/MatchScore";
import { RevealedPicks } from "../components/RevealedPicks";
import { useAuth } from "../lib/auth";
import { kickoffLabel, dayLabel, countdown, isUrgent, signed } from "../lib/format";
import { useNow } from "../lib/useNow";

export function Round() {
  const { slug = "", code = "" } = useParams();
  const qc = useQueryClient();
  const key = ["round", slug, code];

  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.round(slug, code),
    // Poll only while a match is actually in play. Outside those windows the
    // data is static for days, and polling it would be pure waste.
    refetchInterval: (q) =>
      q.state.data?.contests.some((x) => x.match?.status === "live") ? 30_000 : false,
    refetchOnWindowFocus: true,
  });

  const [failed, setFailed] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (v: { contestId: string; selection: Selection }) =>
      api.submitPicks(slug, [v]),

    // Optimistic: tapping a pick should feel instant on a phone.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RoundDetail>(key);
      qc.setQueryData<RoundDetail>(key, (old) =>
        old
          ? {
              ...old,
              contests: old.contests.map((x) =>
                x.id === v.contestId
                  ? { ...x, myPick: { ...(x.myPick ?? { lineAtPick: null, isCorrect: null, pointsAwarded: null }), selection: v.selection } }
                  : x,
              ),
            }
          : old,
      );
      return { prev };
    },

    onError: (err, _v, ctx) => {
      // Roll back and say why — the usual cause is the match having kicked off.
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      setFailed(err instanceof ApiError ? err.message : "Could not save that pick.");
    },

    onSuccess: () => setFailed(null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <Empty title="Round not found" />;

  if (data.awaitingDraw) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Header slug={slug} data={data} />
        <div className="mt-6">
          <Empty
            title="Awaiting the draw"
            body="These ties do not exist yet. Fixtures appear here automatically once UEFA makes the draw."
          />
        </div>
      </div>
    );
  }

  // Group by calendar day so a matchday spread over Tue/Wed reads correctly.
  const groups = new Map<string, Contest[]>();
  for (const contest of data.contests) {
    const day = dayLabel(contest.locksAt);
    groups.set(day, [...(groups.get(day) ?? []), contest]);
  }

  const picked = data.contests.filter((x) => x.myPick).length;
  const total = data.contests.length;
  const complete = picked === total;
  // The soonest lock still ahead is the deadline that actually matters.
  const nextLock = data.contests
    .map((x) => x.locksAt)
    .filter((iso) => new Date(iso).getTime() > Date.now())
    .sort()[0];

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Header slug={slug} data={data} />

      <div className="mt-4 rounded-2xl border border-pitch-700/60 bg-pitch-900/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="tnum text-lg font-black">
              {picked}
              <span className="text-chalk-500">/{total}</span>
              <span className="ml-1.5 text-xs font-semibold text-chalk-400">picked</span>
            </p>
            <p className="mt-0.5 text-[11px] text-chalk-500">
              {data.round.pointsPerPick} pt{data.round.pointsPerPick > 1 ? "s" : ""} per correct
              pick
            </p>
          </div>
          {complete ? (
            <span className="rounded-lg bg-win-500/15 px-2.5 py-1 text-xs font-bold text-win-500">
              ✓ All in
            </span>
          ) : nextLock ? (
            <div className="text-right">
              <p className="text-[10px] font-bold tracking-[0.12em] text-chalk-500 uppercase">
                First lock
              </p>
              <NextLock iso={nextLock} />
            </div>
          ) : null}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pitch-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              complete ? "bg-win-500" : "bg-gradient-to-r from-star-500 to-nebula-500"
            }`}
            style={{ width: `${total > 0 ? (picked / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {failed && (
        <div className="mt-4">
          <Alert>{failed}</Alert>
        </div>
      )}

      <div className="mt-5 space-y-6">
        {[...groups.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="mb-2.5">
              <h2 className="text-[11px] font-bold tracking-[0.14em] text-chalk-400 uppercase">
                {day}
              </h2>
              <div className="rule mt-1.5" />
            </div>
            <div className="space-y-2.5">
              {list.map((contest) => (
                <ContestRow
                  key={contest.id}
                  contest={contest}
                  memberCount={data.memberCount}
                  meId={user?.id}
                  saving={save.isPending && save.variables?.contestId === contest.id}
                  onPick={(selection) => save.mutate({ contestId: contest.id, selection })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextLock({ iso }: { iso: string }) {
  const now = useNow();
  const left = countdown(iso, now);
  const urgent = isUrgent(iso, now);

  return (
    <p
      className={`tnum text-sm font-bold ${urgent ? "animate-pulse text-lose-500" : "text-warn-500"}`}
    >
      {left ?? "Locked"}
    </p>
  );
}

function Header({ slug, data }: { slug: string; data: RoundDetail }) {
  return (
    <>
      <Link to={`/p/${slug}`} className="text-sm text-chalk-400 hover:text-chalk-200">
        ‹ Back
      </Link>
      <h1 className="mt-2 text-2xl font-black tracking-tight">{data.round.name}</h1>
    </>
  );
}

function ContestRow({
  contest,
  memberCount,
  meId,
  saving,
  onPick,
}: {
  contest: Contest;
  memberCount: number;
  meId?: string;
  saving: boolean;
  onPick: (s: Selection) => void;
}) {
  const now = useNow();
  const { myPick, line, awaitingLine } = contest;
  // Derive from the ticking clock rather than the server's snapshot, so a card
  // locks itself the moment kickoff passes without needing a refetch.
  const locked = contest.locked || new Date(contest.locksAt).getTime() <= now;
  const urgent = !locked && isUrgent(contest.locksAt, now);
  const selection = myPick?.selection;
  const graded = myPick?.pointsAwarded !== null && myPick?.pointsAwarded !== undefined;
  const disabled = locked || awaitingLine || saving;

  return (
    <Card
      className={`relative overflow-hidden ${locked ? "opacity-85" : ""} ${
        graded && myPick?.isCorrect
          ? "border-win-500/40 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-win-500"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 text-[11px] text-chalk-500">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{kickoffLabel(contest.locksAt)}</span>
          {contest.match && <MatchScore match={contest.match} />}
        </span>
        {locked ? (
          graded ? (
            <span
              className={`rounded-md px-1.5 py-0.5 font-bold ${
                myPick?.isCorrect
                  ? "bg-win-500/15 text-win-500"
                  : "bg-pitch-800 text-chalk-500"
              }`}
            >
              {myPick?.isCorrect ? `+${myPick.pointsAwarded}` : "0"} PT
            </span>
          ) : (
            <span>Locked</span>
          )
        ) : (
          <span
            className={`tnum font-semibold ${
              urgent ? "animate-pulse text-lose-500" : "text-warn-500"
            }`}
          >
            {countdown(contest.locksAt, now)} left
          </span>
        )}
      </div>

      {contest.kind === "tie" && (
        <p className="px-4 pt-1.5 text-[11px] text-star-400">Pick who advances</p>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3">
        <SideButton
          contest={contest}
          side="SIDE_A"
          active={selection === "SIDE_A"}
          disabled={disabled}
          onPick={onPick}
          point={line?.sideA}
        />

        {contest.allowedSelections.includes("DRAW") ? (
          <DrawButton
            active={selection === "DRAW"}
            disabled={disabled}
            outcome={contest.outcome}
            onPick={onPick}
          />
        ) : (
          <span className="px-1 text-xs text-chalk-500">v</span>
        )}

        <SideButton
          contest={contest}
          side="SIDE_B"
          active={selection === "SIDE_B"}
          disabled={disabled}
          onPick={onPick}
          point={line?.sideB}
        />
      </div>

      {awaitingLine && (
        <p className="border-t border-pitch-800 px-4 py-2 text-[11px] text-chalk-500">
          Waiting on Monday&rsquo;s line before picks open.
        </p>
      )}

      <RevealedPicks contest={contest} memberCount={memberCount} meId={meId} />
    </Card>
  );
}

function SideButton({
  contest,
  side,
  active,
  disabled,
  onPick,
  point,
}: {
  contest: Contest;
  side: "SIDE_A" | "SIDE_B";
  active: boolean;
  disabled: boolean;
  onPick: (s: Selection) => void;
  point?: number;
}) {
  const team = side === "SIDE_A" ? contest.sideA : contest.sideB;
  const won = contest.outcome === side;
  const alignRight = side === "SIDE_B";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(side)}
      className={`flex min-h-[4.5rem] items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all disabled:cursor-not-allowed ${
        alignRight ? "flex-row-reverse text-right" : "text-left"
      } ${
        active
          ? "border-star-400 bg-gradient-to-br from-star-500/25 to-nebula-500/15 shadow-[0_0_20px_-4px] shadow-star-500/50"
          : "border-pitch-700 bg-pitch-950/50 enabled:hover:border-star-500/40 enabled:hover:bg-pitch-850/60"
      }`}
    >
      <Crest team={team} size={32} />
      <span className="min-w-0">
        <span
          className={`block truncate text-sm font-bold ${
            won ? "text-win-500" : active ? "text-white" : "text-chalk-200"
          }`}
        >
          {team.shortName}
        </span>
        {point !== undefined && (
          <span className="tnum block text-[11px] text-chalk-400">{signed(point)}</span>
        )}
      </span>
    </button>
  );
}

function DrawButton({
  active,
  disabled,
  outcome,
  onPick,
}: {
  active: boolean;
  disabled: boolean;
  outcome: Selection | null;
  onPick: (s: Selection) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick("DRAW")}
      className={`min-h-[4.5rem] rounded-xl border px-2.5 text-[11px] font-bold tracking-wide transition-all disabled:cursor-not-allowed ${
        active
          ? "border-star-400 bg-gradient-to-br from-star-500/25 to-nebula-500/15 text-white shadow-[0_0_20px_-4px] shadow-star-500/50"
          : "border-pitch-700 bg-pitch-950/50 text-chalk-400 enabled:hover:border-star-500/40"
      } ${outcome === "DRAW" ? "text-win-500" : ""}`}
    >
      DRAW
    </button>
  );
}
