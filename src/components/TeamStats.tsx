import { useState, type ReactNode } from "react";
import type { FormEntry, TeamContext, TeamRef } from "../lib/api";
import { ordinal } from "../lib/format";

const FORM_STYLE: Record<FormEntry["result"], string> = {
  W: "bg-win-500/20 text-win-500",
  D: "bg-warn-500/20 text-warn-500",
  L: "bg-lose-500/20 text-lose-500",
};

function verdict(f: FormEntry): string {
  return { W: "Win", D: "Draw", L: "Loss" }[f.result];
}

/**
 * Each result is a focusable button with its own popover rather than a `title`
 * attribute: native tooltips lag by a second, never appear on touch screens,
 * and cannot be styled. Hover shows it on desktop; tapping focuses the chip,
 * which shows it on a phone. `align` keeps the popover inside the card, whose
 * edges clip anything that overflows.
 */
export function FormDots({ form, align = "left" }: { form: FormEntry[]; align?: "left" | "right" }) {
  if (form.length === 0) return <Dash />;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Last ${form.length}: ${form.map((f) => f.result).join(" ")}`}>
      {form.map((f, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${verdict(f)} ${f.score} ${f.home ? "vs" : "at"} ${f.opponent}`}
          className={`group relative grid size-[18px] cursor-default place-items-center rounded text-[10px] font-black outline-none focus-visible:ring-1 focus-visible:ring-star-400 ${FORM_STYLE[f.result]}`}
        >
          {f.result}
          <span
            role="tooltip"
            className={`pointer-events-none absolute bottom-full z-20 mb-1.5 hidden w-max max-w-[11rem] rounded-lg border border-pitch-600 bg-pitch-850 px-2.5 py-1.5 text-left text-[11px] leading-snug font-semibold text-chalk-50 shadow-lg group-hover:block group-focus:block ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            <span className="block">
              {verdict(f)} {f.score} {f.home ? "vs" : "at"} {f.opponent}
            </span>
            <span className="block text-[10px] font-medium text-chalk-400">
              {f.competition} · {f.date}
            </span>
          </span>
        </button>
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
function cells(ctx: TeamContext | null | undefined, align: "left" | "right"): ReactNode[] {
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
    <FormDots form={ctx.form} align={align} />,
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

  const a = cells(sideA.context, "left");
  const b = cells(sideB.context, "right");

  return (
    <dl className="grid grid-cols-[1fr_3.5rem_1fr] items-center gap-x-2 gap-y-1.5 border-t border-pitch-800 px-4 py-2.5 text-[11px] text-chalk-200">
      {LABELS.map((label, i) => (
        <div key={label} className="contents">
          <dd className="min-w-0">{a[i]}</dd>
          <dt className="text-center text-[9px] font-bold tracking-[0.12em] text-chalk-500 uppercase">
            {label}
          </dt>
          <dd className="flex min-w-0 justify-end text-right">{b[i]}</dd>
        </div>
      ))}
    </dl>
  );
}
