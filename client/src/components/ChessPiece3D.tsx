import { useId, type CSSProperties } from 'react';

/**
 * A glossy, shaded chess piece drawn as inline SVG. No assets, no 3D
 * library: each piece is composed from parametric shapes lit by a shared
 * top-left light source — a vertical body gradient, a radial specular
 * highlight, and a dark base. Reads as a 3D-rendered piece, matching the
 * product-shot look of the landing hero.
 *
 * `type` selects the silhouette; `light` picks the white/black ceramic
 * palette. Gradients are keyed by `useId` so multiple pieces on one page
 * never collide.
 */
export interface ChessPiece3DProps {
  type: 'king' | 'queen' | 'knight' | 'pawn';
  light: boolean;
  /** Rendered width in px (height follows the 100:120 viewBox). */
  width?: number;
  style?: CSSProperties;
  className?: string;
}

export function ChessPiece3D({
  type,
  light,
  width = 96,
  style,
  className,
}: ChessPiece3DProps): React.JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const body = `body-${uid}`;
  const gloss = `gloss-${uid}`;
  const base = `base-${uid}`;

  const top = light ? '#ffffff' : '#a3b3c8';
  const mid = light ? '#e2e8f0' : '#3b4a5f';
  const dark = light ? '#8fa3b8' : '#04070d';

  const shared: CSSProperties = {
    width,
    height: width * 1.2,
    display: 'block',
    ...style,
  };

  const defs = (
    <defs>
      <linearGradient id={body} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={top} />
        <stop offset="0.55" stopColor={mid} />
        <stop offset="1" stopColor={dark} />
      </linearGradient>
      <radialGradient id={gloss} cx="0.32" cy="0.22" r="0.55">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={base} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={dark} />
        <stop offset="1" stopColor="#020617" />
      </linearGradient>
    </defs>
  );

  const rim = light ? undefined : { stroke: '#64748b', strokeWidth: 0.6 };

  return (
    <svg
      viewBox="0 0 100 120"
      role="img"
      aria-label={`${light ? 'white' : 'black'} ${type}`}
      className={className}
      style={shared}
    >
      {defs}
      {/* Ground shadow on the base disc */}
      <ellipse cx="50" cy="115" rx="27" ry="7" fill={light ? 'rgba(2,6,23,0.35)' : 'rgba(2,6,23,0.65)'} />

      {type === 'pawn' && (
        <g {...rim}>
          <ellipse cx="50" cy="110" rx="22" ry="5" fill={`url(#${base})`} />
          <ellipse cx="50" cy="107" rx="20" ry="4" fill={`url(#${body})`} />
          <path d="M38 104 L42 90 L58 90 L62 104 Z" fill={`url(#${body})`} />
          <ellipse cx="50" cy="88" rx="12" ry="4" fill={`url(#${body})`} />
          <ellipse cx="50" cy="70" rx="19" ry="20" fill={`url(#${body})`} />
          <circle cx="50" cy="45" r="13" fill={`url(#${body})`} />
          <ellipse cx="45" cy="40" rx="5" ry="8" fill={`url(#${gloss})`} />
          <ellipse cx="44" cy="65" rx="6" ry="11" fill={`url(#${gloss})`} opacity="0.5" />
        </g>
      )}

      {type === 'king' && (
        <g {...rim}>
          <ellipse cx="50" cy="110" rx="25" ry="6" fill={`url(#${base})`} />
          <ellipse cx="50" cy="107" rx="23" ry="5" fill={`url(#${body})`} />
          <rect x="31" y="94" width="38" height="16" rx="3" fill={`url(#${body})`} />
          <path d="M50 58 C60 58 64 78 66 94 L34 94 C36 78 40 58 50 58 Z" fill={`url(#${body})`} />
          <ellipse cx="50" cy="92" rx="15" ry="4" fill={`url(#${body})`} />
          <circle cx="50" cy="44" r="15" fill={`url(#${body})`} />
          <rect x="46.5" y="18" width="7" height="19" rx="2" fill={`url(#${body})`} />
          <rect x="39" y="25" width="22" height="7" rx="2" fill={`url(#${body})`} />
          <ellipse cx="44" cy="38" rx="6" ry="10" fill={`url(#${gloss})`} />
          <ellipse cx="44" cy="70" rx="7" ry="14" fill={`url(#${gloss})`} opacity="0.5" />
        </g>
      )}

      {type === 'queen' && (
        <g {...rim}>
          <ellipse cx="50" cy="110" rx="24" ry="6" fill={`url(#${base})`} />
          <ellipse cx="50" cy="107" rx="22" ry="5" fill={`url(#${body})`} />
          <rect x="32" y="94" width="36" height="16" rx="3" fill={`url(#${body})`} />
          <path d="M50 56 C58 56 62 76 64 94 L36 94 C38 76 42 56 50 56 Z" fill={`url(#${body})`} />
          <ellipse cx="50" cy="92" rx="14" ry="4" fill={`url(#${body})`} />
          <circle cx="50" cy="42" r="14" fill={`url(#${body})`} />
          <path d="M38 32 L38 22 L45 28 L50 18 L55 28 L62 22 L62 32 Z" fill={`url(#${body})`} />
          <circle cx="38" cy="20" r="2.6" fill={`url(#${body})`} />
          <circle cx="50" cy="16" r="2.6" fill={`url(#${body})`} />
          <circle cx="62" cy="20" r="2.6" fill={`url(#${body})`} />
          <ellipse cx="45" cy="37" rx="5" ry="9" fill={`url(#${gloss})`} />
          <ellipse cx="44" cy="68" rx="6" ry="12" fill={`url(#${gloss})`} opacity="0.5" />
        </g>
      )}

      {type === 'knight' && (
        <g {...rim}>
          <ellipse cx="50" cy="110" rx="24" ry="6" fill={`url(#${base})`} />
          <ellipse cx="50" cy="107" rx="22" ry="5" fill={`url(#${body})`} />
          <rect x="31" y="96" width="38" height="14" rx="3" fill={`url(#${body})`} />
          <ellipse cx="50" cy="86" rx="21" ry="14" fill={`url(#${body})`} />
          <path
            d="M52 66 C44 62 36 68 32 78 L25 86 L33 90 C37 80 45 76 53 79 C58 72 56 66 52 66 Z"
            fill={`url(#${body})`}
          />
          <path d="M41 62 L35 46 L49 58 Z" fill={`url(#${body})`} />
          <ellipse cx="45" cy="82" rx="8" ry="10" fill={`url(#${gloss})`} opacity="0.5" />
          <ellipse cx="36" cy="74" rx="4" ry="7" fill={`url(#${gloss})`} opacity="0.7" />
        </g>
      )}
    </svg>
  );
}
