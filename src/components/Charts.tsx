import { useState, type MouseEvent } from 'react';

export interface Series { name: string; color: string; vals: (number | null)[] }

const W = 600, H = 230, ML = 34, MR = 12, MT = 12, MB = 28;

function scaleY(maxv: number) {
  const m = Math.max(1, maxv);
  const step = m <= 5 ? 1 : Math.ceil(m / 5);
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const on = (text: string) => (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text });
  const off = () => setTip(null);
  const el = tip && (
    <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 250), top: Math.max(8, tip.y - 70) }}>
      {tip.text}
    </div>
  );
  return { on, off, el };
}

function Frame({ top, ticks }: { top: number; ticks: number[] }) {
  const ih = H - MT - MB;
  const y = (v: number) => MT + ih - (ih * v) / top;
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line className="gl" x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} />
          <text className="ax" x={ML - 6} y={y(v) + 4} textAnchor="end">{v}</text>
        </g>
      ))}
    </>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
      ))}
    </div>
  );
}

/** colour of a % bar: ≥ good green, ≥ warn amber, below red */
const pctTone = (v: number, good: number, warn: number) => (v >= good ? 'var(--pass)' : v >= warn ? '#D99A00' : 'var(--fail)');

/**
 * One bar per day for a percentage (0–100), coloured by how good it is and labelled with its value,
 * so a bad day stands out at a glance. Days without data show a faint "–".
 */
export function PctBarChart({ labels, vals, good = 95, warn = 85, name }: {
  labels: string[]; vals: (number | null)[]; good?: number; warn?: number; name: string;
}) {
  const tip = useTip();
  const top = 100, ticks = [0, 25, 50, 75, 100];
  const ih = H - MT - MB;
  const y = (v: number) => MT + ih - (ih * v) / top;
  const step = (W - ML - MR) / Math.max(1, labels.length);
  const bw = Math.max(4, Math.min(28, step * 0.7));
  const base = H - MB;
  const every = labels.length > 16 ? 2 : 1;
  const small = labels.length > 20;

  return (
    <div className="chart">
      <div className="legend">
        <span><i style={{ background: 'var(--pass)' }} />{good >= 100 ? 'ครบ 100%' : `${good}% ขึ้นไป`}</span>
        <span><i style={{ background: '#D99A00' }} />{warn}–{good - 1}%</span>
        <span><i style={{ background: 'var(--fail)' }} />ต่ำกว่า {warn}%</span>
      </div>
      <div className="chartwrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
          <Frame top={top} ticks={ticks} />
          <line className="gl" x1={ML} x2={W - MR} y1={base} y2={base} />
          {vals.map((v, i) => {
            const cx = ML + step * (i + 0.5);
            if (v == null) return <text key={i} className="ax" x={cx} y={base - 4} textAnchor="middle" opacity={0.5}>–</text>;
            const h = Math.max(2, base - y(v));
            return (
              <g key={i}>
                <path d={roundedBar(cx - bw / 2, base - h, bw, h, 4)} fill={pctTone(v, good, warn)} />
                <text className="ax pct-val" x={cx} y={base - h - 4} textAnchor="middle" fontSize={small ? 8.5 : 10.5}>{Math.round(v)}</text>
              </g>
            );
          })}
          {labels.map((l, i) => i % every === 0 && (
            <text key={`l${i}`} className="ax" x={ML + step * (i + 0.5)} y={H - 8} textAnchor="middle">{l}</text>
          ))}
          {labels.map((l, i) => (
            <rect key={`h${i}`} className="hit" x={ML + step * i} y={MT} width={step} height={ih}
              onMouseMove={tip.on(`วันที่ ${l}\n${name}: ${vals[i] == null ? 'ไม่มีข้อมูล' : `${vals[i]}%`}`)}
              onMouseLeave={tip.off} />
          ))}
        </svg>
      </div>
      {tip.el}
    </div>
  );
}

function roundedBar(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({ labels, series, every = 1 }: { labels: string[]; series: Series[]; every?: number }) {
  const tip = useTip();
  const k = series.length;
  const mx = Math.max(0, ...series.flatMap((s) => s.vals.map((v) => v ?? 0)));
  const { top, ticks } = scaleY(mx);
  const ih = H - MT - MB;
  const y = (v: number) => MT + ih - (ih * v) / top;
  const step = (W - ML - MR) / Math.max(1, labels.length);
  const gap = 2;
  const bw = Math.max(3, Math.min(26, (step * 0.7 - gap * (k - 1)) / k));
  const base = H - MB;

  return (
    <div className="chart">
      <Legend series={series} />
      <div className="chartwrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="กราฟแท่ง">
          <Frame top={top} ticks={ticks} />
          <line className="gl" x1={ML} x2={W - MR} y1={base} y2={base} />
          {labels.map((_, i) => {
            const gx = ML + step * i + (step - (bw * k + gap * (k - 1))) / 2;
            return series.map((s, j) => {
              const v = s.vals[i];
              if (!v) return null;
              return <path key={`${i}-${j}`} d={roundedBar(gx + j * (bw + gap), y(v), bw, base - y(v), 4)} fill={s.color} />;
            });
          })}
          {labels.map((l, i) => i % every === 0 && (
            <text key={i} className="ax" x={ML + step * (i + 0.5)} y={H - 8} textAnchor="middle">{l}</text>
          ))}
          {labels.map((l, i) => (
            <rect key={`h${i}`} className="hit" x={ML + step * i} y={MT} width={step} height={ih}
              onMouseMove={tip.on(`${l}\n` + series.map((s) => `${s.name}: ${s.vals[i] ?? 0}`).join('\n'))}
              onMouseLeave={tip.off} />
          ))}
        </svg>
      </div>
      {tip.el}
    </div>
  );
}
