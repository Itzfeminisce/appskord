/** Label sizing shared by the editor, the board card and the view file: one measure, one wrap, so a label fits its shape everywhere. */
import type { Diagram, DiagramNode, DiagramNodeKind } from '../board/types';

/** Label type in diagram units; at 100% zoom one unit is one pixel. */
export const LABEL_FONT = 14;
export const LINE_HEIGHT = 1.25;
export const EDGE_FONT = 12;
export const MAX_LINES = 2;

// Geist at weight 600 (the selected weight), in hundredths of an em, for ASCII 32 to 126.
const ASCII = [
  24, 24, 38, 55, 66, 82, 68, 19, 31, 31, 42, 57, 22, 42, 22, 51, 68, 43, 64, 64, 66, 66, 61, 54, 64, 62, 31, 31, 55, 55, 55, 58,
  94, 71, 69, 72, 71, 61, 60, 73, 72, 29, 62, 67, 59, 90, 75, 76, 66, 76, 69, 67, 58, 70, 71, 99, 66, 61, 58, 37, 48, 37, 45, 56,
  27, 58, 62, 58, 62, 59, 43, 62, 60, 27, 31, 63, 30, 89, 60, 60, 62, 62, 41, 55, 43, 60, 58, 84, 63, 57, 57, 40, 28, 40, 52,
];

/** Width of `text` at `font` units, a little wide so real glyphs never outgrow it. */
export function measureText(text: string, font = LABEL_FONT): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    em += code >= 32 && code <= 126 ? ASCII[code - 32]! / 100 : code >= 0x2e80 ? 1 : 0.7;
  }
  return Math.ceil(em * font * 1.04);
}

/** The label on one line when it fits `max`, else split in two lines as evenly as its words allow. */
export function wrapLabel(label: string, max: number, font = LABEL_FONT): string[] {
  const text = label.trim().replace(/\s+/g, ' ');
  if (!text) return [''];
  if (measureText(text, font) <= max) return [text];
  const words = text.split(' ');
  if (words.length === 1) return [text];
  let best: string[] = [text];
  let widest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...lines.map((l) => measureText(l, font)));
    if (w < widest) [best, widest] = [lines, w];
  }
  return best;
}

interface KindBox { padX: number; padY: number; minW: number; minH: number; maxText: number }
const BOX: Record<DiagramNodeKind, KindBox> = {
  step: { padX: 18, padY: 12, minW: 96, minH: 48, maxText: 180 },
  end: { padX: 26, padY: 12, minW: 96, minH: 48, maxText: 180 },
  choice: { padX: 12, padY: 10, minW: 128, minH: 76, maxText: 80 },
  text: { padX: 8, padY: 6, minW: 60, minH: 32, maxText: 200 },
};

export interface LabelFit { w: number; h: number; lines: string[] }

/** A node's size from its label: one line, else two, then the shape grows wider; a diamond leaves room for its text inside. */
export function fitLabel(kind: DiagramNodeKind, label: string): LabelFit {
  const box = BOX[kind];
  const lines = wrapLabel(label, box.maxText);
  const textW = Math.max(...lines.map((l) => measureText(l)));
  const textH = Math.ceil(lines.length * LABEL_FONT * LINE_HEIGHT);
  // Text of tw x th fits in a diamond of 2tw x 2th: tw/W + th/H <= 1.
  if (kind === 'choice') return { w: Math.max(box.minW, 2 * textW + 2 * box.padX), h: Math.max(box.minH, 2 * textH + 2 * box.padY), lines };
  return { w: Math.max(box.minW, textW + 2 * box.padX), h: Math.max(box.minH, textH + 2 * box.padY), lines };
}

export function fitSize(kind: DiagramNodeKind, label: string): { w: number; h: number } {
  const { w, h } = fitLabel(kind, label);
  return { w, h };
}

/** The widest a line of the node's label may draw. */
export function labelRoom(node: Pick<DiagramNode, 'kind' | 'w'>): number {
  const box = BOX[node.kind];
  return node.kind === 'choice' ? node.w / 2 - box.padX : node.w - 2 * box.padX;
}

/** The lines a node draws at its own size. */
export function nodeLines(node: Pick<DiagramNode, 'kind' | 'label' | 'w'>): string[] {
  return wrapLabel(node.label, Math.max(BOX[node.kind].maxText, labelRoom(node)));
}

/** A node grown, about its centre, until its label fits; the same node when it already does. */
export function fitNode<T extends DiagramNode>(node: T): T {
  const fit = fitSize(node.kind, node.label);
  if (node.w >= fit.w && node.h >= fit.h) return node;
  const w = Math.max(node.w, fit.w), h = Math.max(node.h, fit.h);
  return { ...node, w, h, x: Math.round(node.x - (w - node.w) / 2), y: Math.round(node.y - (h - node.h) / 2) };
}

const FIT_GAP = 40;

/** Every node grown to fit its label, centres spread apart just enough that grown shapes keep clear; the same diagram when all fit. */
export function fitNodes(diagram: Diagram): Diagram {
  const grown = diagram.nodes.map(fitNode);
  if (grown.every((n, i) => n === diagram.nodes[i])) return diagram;
  const centre = (n: DiagramNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  let spread = 1;
  for (let i = 0; i < grown.length; i++) for (let j = i + 1; j < grown.length; j++) {
    const a = grown[i]!, b = grown[j]!, ca = centre(diagram.nodes[i]!), cb = centre(diagram.nodes[j]!);
    const dx = Math.abs(ca.x - cb.x), dy = Math.abs(ca.y - cb.y);
    const need = Math.min(dx > 0 ? ((a.w + b.w) / 2 + FIT_GAP) / dx : Infinity, dy > 0 ? ((a.h + b.h) / 2 + FIT_GAP) / dy : Infinity);
    if (Number.isFinite(need)) spread = Math.max(spread, Math.min(4, need));
  }
  const x0 = Math.min(...diagram.nodes.map((n) => n.x)), y0 = Math.min(...diagram.nodes.map((n) => n.y));
  const nodes = grown.map((n, i) => {
    const c = centre(diagram.nodes[i]!);
    return { ...n, x: Math.round(x0 + (c.x - x0) * spread - n.w / 2), y: Math.round(y0 + (c.y - y0) * spread - n.h / 2) };
  });
  return { ...diagram, nodes };
}

/** A node resized to fit a new label, about its old centre. */
export function relabel(node: DiagramNode, label: string): DiagramNode {
  const { w, h } = fitSize(node.kind, label);
  return { ...node, label, w, h, x: Math.round(node.x + (node.w - w) / 2), y: Math.round(node.y + (node.h - h) / 2) };
}
