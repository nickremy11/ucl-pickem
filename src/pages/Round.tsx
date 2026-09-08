import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Contest, type RoundDetail, type Selection } from "../lib/api";
import { Card, Spinner, Empty, Alert, Crest } from "../components/ui";
import { kickoffLabel, dayLabel, countdown, signed } from "../lib/format";

export function Round() {
  const { slug = "", code = "" } = useParams();
  const qc = useQueryClient();
  const key = ["round", slug, code];

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.round(slug, code),
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

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Header slug={slug} data={data} />

      <div className="mt-4 flex items-center justify-between text-xs text-chalk-500">
        <span>
          {picked}/{data.contests.length} picked
        </span>
        <span>
          {data.round.pointsPerPick} pt{data.round.pointsPerPick > 1 ? "s" : ""} per correct pick
        </span>
      </div>

      {failed && (
        <div className="mt-4">
          <Alert>{failed}</Alert>
        </div>
      )}

      <div className="mt-5 space-y-6">
        {[...groups.entries()].map(([day, list]) => (
          <div key={day}>
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-chalk-400 uppercase">
              {day}
            </h2>
            <div className="space-y-2.5">
              {list.map((contest) => (
                <ContestRow
                  key={contest.id}
                  contest={contest}
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

function Header({ slug, data }: { slug: string; data: RoundDetail }) {
  return (
    <>
      <Link to={`/p/${slug}`} className="text-sm text-chalk-400 hover:text-chalk-200">
        ‹ Back
      </Link>
      <h1 className="mt-2 text-xl font-bold tracking-tight">{data.round.name}</h1>
    </>
  );
}

function ContestRow({
  contest,
  saving,
  onPick,
}: {
  contest: Contest;
  saving: boolean;
  onPick: (s: Selection) => void;
}) {
  const { locked, myPick, line, awaitingLine } = contest;
  const selection = myPick?.selection;
  const graded = myPick?.pointsAwarded !== null && myPick?.pointsAwarded !== undefined;
  const disabled = locked || awaitingLine || saving;

  return (
    <Card className={`overflow-hidden ${locked ? "opacity-80" : ""}`}>
      <div className="flex items-center justify-between px-4 pt-3 text-[11px] text-chalk-500">
        <span>{kickoffLabel(contest.locksAt)}</span>
        {locked ? (
          graded ? (
            <span className={myPick?.isCorrect ? "font-semibold text-win-500" : "text-chalk-500"}>
              {myPick?.isCorrect ? `+${myPick.pointsAwarded}` : "0"} pt
            </span>
          ) : (
            <span>Locked</span>
          )
        ) : (
          <span className="text-warn-500">{countdown(contest.locksAt)} left</span>
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
      className={`flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors disabled:cursor-not-allowed ${
        alignRight ? "flex-row-reverse text-right" : "text-left"
      } ${
        active
          ? "border-star-500 bg-star-500/15"
          : "border-pitch-700 bg-pitch-950/40 enabled:hover:border-pitch-600"
      }`}
    >
      <Crest team={team} size={26} />
      <span className="min-w-0">
        <span className={`block truncate text-sm font-semibold ${won ? "text-win-500" : ""}`}>
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
      className={`min-h-16 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
        active
          ? "border-star-500 bg-star-500/15 text-chalk-50"
          : "border-pitch-700 bg-pitch-950/40 text-chalk-400 enabled:hover:border-pitch-600"
      } ${outcome === "DRAW" ? "text-win-500" : ""}`}
    >
      DRAW
    </button>
  );
}
