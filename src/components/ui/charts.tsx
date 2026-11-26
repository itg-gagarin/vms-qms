// Small server-rendered charts: one series each, in the brand hue, with hover titles and a data table fallback.
import type { ReactNode } from "react";

// INTEC: a single series is signal green; grey is for gridlines only.
const BRAND = "var(--chart-1)";
const GRID = "var(--chart-grid)";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** A column chart for one measure over time. `null` values draw nothing (e.g. a month with no responses). */
export function ColumnChart({ data, unit, label }: { data: { label: string; value: number | null; title: string }[]; unit: string; label: string }) {
  const W = 560, H = 180, padL = 32, padB = 22, padT = 16;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const slot = (W - padL) / Math.max(1, data.length);
  const bw = Math.min(24, slot * 0.6);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const values = data.map((d) => d.value ?? -1);
  const maxIdx = values.indexOf(Math.max(...values));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const label = (
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{d.label}</text>
          );
          if (d.value === null || d.value <= 0) return <g key={i}>{label}<title>{d.title}</title></g>;
          const top = y(d.value), base = y(0), r = Math.min(4, base - top), x = cx - bw / 2;
          // 4px rounded data-end, square at the baseline.
          const path = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`;
          const showValue = i === maxIdx || i === data.length - 1;
          return (
            <g key={i}>
              {/* Hit area larger than the bar, for the hover title */}
              <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent"><title>{d.title}</title></rect>
              <path d={path} fill={BRAND}><title>{d.title}</title></path>
              {showValue && (
                <text x={cx} y={top - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--foreground)" fontFamily="var(--font-mono)">{d.value}{unit}</text>
              )}
              {label}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Horizontal bars for parts of a whole (one hue; the label and count are text, not color). */
export function BarList({ rows }: { rows: { label: ReactNode; value: number; key: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[140px_1fr_36px] items-center gap-3 text-[13px]" title={`${r.key}: ${r.value}`}>
          <span className="truncate text-foreground/80">{r.label}</span>
          <span className="h-2.5 rounded-sm bg-chart-grid">
            <span className="block h-2.5 rounded-sm" style={{ width: `${(100 * r.value) / max}%`, background: BRAND, minWidth: r.value ? 4 : 0 }} />
          </span>
          <span className="num text-right font-semibold text-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" }) {
  // shadcn section card: label, the figure large and tabular, a line of context; a warning shows as a red dot.
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {tone === "warn" && <span aria-hidden="true" className="size-1.5 rounded-full bg-status-red" />}{label}
      </div>
      <div className="text-2xl leading-tight font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
