// Small server-rendered charts: one series each, in the brand hue, with hover titles and a data table fallback.
import type { ReactNode } from "react";

const BRAND = "#0b5c7a";
const GRID = "#e2e8f0";

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
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b" style={{ fontVariantNumeric: "tabular-nums" }}>
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const label = (
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill="#475569">{d.label}</text>
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
                <text x={cx} y={top - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0f172a">{d.value}{unit}</text>
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
          <span className="truncate text-slate-700">{r.label}</span>
          <span className="h-2.5 rounded-full bg-slate-100">
            <span className="block h-2.5 rounded-full" style={{ width: `${(100 * r.value) / max}%`, background: BRAND, minWidth: r.value ? 4 : 0 }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-slate-900">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <div className="text-[13px] font-medium text-slate-600">{label}</div>
      <div className={`text-[26px] font-semibold leading-tight ${tone === "warn" ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[12px] text-slate-500">{sub}</div>}
    </div>
  );
}
