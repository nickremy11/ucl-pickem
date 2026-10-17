import { useState, type ReactNode } from "react";
import type { FormEntry, TeamContext, TeamRef } from "../lib/api";
import { ordinal } from "../lib/format";

const FORM_STYLE: Record<FormEntry["result"], string> = {
  W: "bg-win-500/20 text-win-500",
  D: "bg-warn-500/20 text-warn-500",
  L: "bg-lose-500/20 text-lose-500",
};

function formTitle(f: FormEntry): string {
  const verdict = { W: "Win", D: "Draw", L: "Loss" }[f.result];
  return `${verdict} ${f.score} ${f.home ? "vs" : "at"} ${f.opponent} (${f.competition}, ${f.date})`;
}

export function FormDots({ form }: { form: FormEntry[] }) {
  if (form.length === 0) return <Dash />;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Last ${form.length}: ${form.map((f) => f.result).join(" ")}`}>
      {form.map((f, i) => (
        <span
          key={i}
          title={formTitle(f)}
          className={`grid size-[18px] place-items-center rounded text-[10px] font-black ${FORM_STYLE[f.result]}`}
        >
          {f.result}
        </span>
      ))}
    </span>
  );
}

const Dash = () => <span className="text-chalk-500">–</span>;

function Flag({ ctx }: { ctx: TeamContext }) {
  const [broken, setBroken] = useState(false);
  if (!ctx.flagUrl || broken) return null;
  return (
    <img
      src={ctx.flagUrl}
      alt=""
      width={16}
      height={12}
      onError={() => setBroken(true)}
      className="h-3 w-4 shrink-0 rounded-[2px] object-cover"
    />
  );
}

/** One side's value for each row, ready to drop into the comparison grid. */
function cells(ctx: TeamContext | null | undefined): ReactNode[] {
  if (!ctx) return [<Dash />, <Dash />, <Dash />, <Dash />];

  const league = ctx.league;
  const ucl = ctx.ucl;

  return [
    ctx.country ? (
      <span className="inline-flex items-center gap-1.5">
        <Flag ctx={ctx} />
        <span className="truncate">{ctx.country}</span>
      </span>
    ) : (
      <Dash />
    ),
    league ? (
      <span title={league.name ?? league.code}>
        <span className="text-chalk-500">{league.code}</span> {ordinal(league.position)}
        {league.points !== null && <span className="text-chalk-400"> · {league.points} pts</span>}
      </span>
    ) : (
      <span className="text-chalk-500" title="League table not available for this team">
        n/a
      </span>
    ),
    ucl ? (
      <span>
        {ordinal(ucl.position)}
        {ucl.points !== null && <span className="text-chalk-400"> · {ucl.points} pts</span>}
      </span>
    ) : (
      <Dash />
    ),
    <FormDots form={ctx.form} />,
  ];
}

const LABELS = ["Country", "League", "UCL", "Form"];

/**
 * Side-by-side comparison under a matchup: country, domestic league position,
 * UCL league-phase position, and the last five results. Labels sit in the
 * middle so each side reads outward from them, mirroring the pick buttons.
 */
export function TeamStats({ sideA, sideB }: { sideA: TeamRef; sideB: TeamRef }) {
  if (!sideA.context && !sideB.context) return null;

  const a = cells(sideA.context);
  const b = cells(sideB.context);

  return (
    <dl className="grid grid-cols-[1fr_3.5rem_1fr] items-center gap-x-2 gap-y-1.5 border-t border-pitch-800 px-4 py-2.5 text-[11px] text-chalk-200">
      {LABELS.map((label, i) => (
        <div key={label} className="contents">
          <dd className="min-w-0 truncate">{a[i]}</dd>
          <dt className="text-center text-[9px] font-bold tracking-[0.12em] text-chalk-500 uppercase">
            {label}
          </dt>
          <dd className="flex min-w-0 justify-end truncate text-right">{b[i]}</dd>
        </div>
      ))}
    </dl>
  );
}
