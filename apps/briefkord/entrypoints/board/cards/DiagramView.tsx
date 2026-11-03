/** A diagram drawn read-only from its data: steps, choices, ends and text, with right-angle connectors. Reused by T4's editor. */
import { useId } from 'react';
import type { CardColour, Diagram, DiagramNode } from '@/lib/board/types';
import { routeEdge, type Box } from '@/lib/diagram/route';

export { routeEdge, type EdgeRoute } from '@/lib/diagram/route';

/** The drawing bounds of a diagram, with `pad` around it. */
export function diagramBounds(diagram: Diagram, pad = 16): Box {
  if (diagram.nodes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...diagram.nodes.map((n) => n.x)) - pad;
  const y = Math.min(...diagram.nodes.map((n) => n.y)) - pad;
  const r = Math.max(...diagram.nodes.map((n) => n.x + n.w)) + pad;
  const b = Math.max(...diagram.nodes.map((n) => n.y + n.h)) + pad;
  return { x, y, w: r - x, h: b - y };
}

const tone = (colour: CardColour) => `var(--bk-d-${colour}-fill)`;
const line = (colour: CardColour) => `var(--bk-d-${colour}-line)`;
const ink = (colour: CardColour) => `var(--bk-d-${colour}-ink)`;

function Node({ node }: { node: DiagramNode }) {
  const { x, y, w, h, colour, kind, label } = node;
  const cx = x + w / 2, cy = y + h / 2;
  const strong = colour !== 'white';
  return (
    <g>
      {kind === 'choice' && <path d={`M${cx} ${y + 2} L${x + w - 2} ${cy} L${cx} ${y + h - 2} L${x + 2} ${cy}Z`} fill={tone(colour)} stroke={line(colour)} strokeWidth={1.5} />}
      {(kind === 'step' || kind === 'end') && <rect x={x + 0.75} y={y + 0.75} width={w - 1.5} height={h - 1.5} rx={8} fill={tone(colour)} stroke={line(colour)} strokeWidth={1.5} />}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={kind === 'choice' ? 11.5 : 12} fontWeight={strong && kind === 'step' ? 600 : 500} fill={ink(colour)} fontFamily="var(--bk-font)">
        {label}
      </text>
    </g>
  );
}

export function DiagramView({ diagram, className }: { diagram: Diagram; className?: string }) {
  const marker = `dg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const box = diagramBounds(diagram);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  return (
    <svg className={className} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" role="img" aria-label={diagram.nodes.map((n) => n.label).join(', ')}>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--bk-text)" />
        </marker>
      </defs>
      {diagram.edges.map((edge) => {
        const a = byId.get(edge.from), b = byId.get(edge.to);
        if (!a || !b) return null;
        const route = routeEdge(a, b);
        return (
          <g key={edge.id}>
            <path d={route.d} fill="none" stroke="var(--bk-text)" strokeWidth={1.4} markerEnd={`url(#${marker})`} />
            {edge.label && route.label && (
              <text x={route.label.x} y={route.label.y} textAnchor={route.label.anchor} fontSize={10} fill="var(--bk-text-2)" fontFamily="var(--bk-font)">
                {edge.label}
              </text>
            )}
          </g>
        );
      })}
      {diagram.nodes.map((node) => <Node key={node.id} node={node} />)}
    </svg>
  );
}
