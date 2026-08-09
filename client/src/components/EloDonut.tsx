interface EloDonutProps {
  wins: number;
  losses: number;
  draws: number;
  size?: number;
  stroke?: number;
}

// Single source of truth for the arc colours, matched to the @theme tokens
// so the donut shares the dashboard's accent vocabulary rather than carrying
// its own hex literals.
const SEGMENTS: ReadonlyArray<{
  key: 'win' | 'loss' | 'draw';
  color: string;
  label: string;
  weight: 'wins' | 'losses' | 'draws';
}> = [
  { key: 'win', color: 'var(--color-accent-emerald)', label: 'Wins', weight: 'wins' },
  { key: 'loss', color: 'var(--color-accent-rose)', label: 'Losses', weight: 'losses' },
  { key: 'draw', color: 'var(--color-slate-600)', label: 'Draws', weight: 'draws' },
];

/**
 * A pure-SVG donut charting the win/loss/draw split. No chart lib -- three
 * <circle> arcs advanced with stroke-dasharray, which keeps the bundle free
 * of d3/recharts and the SVG a few hundred bytes. The zero-state (no games
 * played yet) renders a slate track so the card doesn't collapse.
 */
export function EloDonut({
  wins,
  losses,
  draws,
  size = 220,
  stroke = 22,
}: EloDonutProps): React.JSX.Element {
  const total = wins + losses + draws;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;
  const arcs = SEGMENTS.map((seg) => {
    const fraction = total > 0 ? seg.weight === 'wins' ? wins : seg.weight === 'losses' ? losses : draws : 0;
    const length = (fraction / Math.max(total, 1)) * circumference;
    const arc = {
      key: seg.key,
      color: seg.color,
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
    };
    offset += length;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Record: ${wins} wins, ${losses} losses, ${draws} draws`}
      >
        <g transform={`rotate(-90 ${center} ${center})`}>
          {/* Track behind the arcs -- visible only in the zero-state. */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-slate-800)"
            strokeWidth={stroke}
          />
          {total > 0 &&
            arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={stroke}
                strokeDasharray={arc.dasharray}
                strokeDashoffset={arc.dashoffset}
                strokeLinecap="butt"
              />
            ))}
        </g>
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="fill-slate-100 font-mono"
          style={{ fontSize: size * 0.22, fontWeight: 700 }}
        >
          {total}
        </text>
        <text
          x={center}
          y={center + size * 0.14}
          textAnchor="middle"
          className="fill-slate-400"
          style={{ fontSize: size * 0.075, letterSpacing: '0.08em' }}
        >
          {total === 1 ? 'GAME' : 'GAMES'}
        </text>
      </svg>
      <ul className="flex w-full flex-col gap-2">
        {SEGMENTS.map((seg) => {
          const value = seg.weight === 'wins' ? wins : seg.weight === 'losses' ? losses : draws;
          return (
            <li
              key={seg.key}
              className="flex items-center justify-between text-sm"
            >
              <span className="flex items-center gap-2 text-slate-300">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: seg.color }}
                  aria-hidden
                />
                {seg.label}
              </span>
              <span className="font-mono text-slate-200">{value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
