/** Pure changes to a diagram inside the editor. Each returns a new diagram, or the same one when nothing changes. */
import type { CardColour, Diagram, DiagramEdge, DiagramNode, DiagramNodeKind } from '../board/types';

/** The colour a new node of this kind gets. */
export const NODE_COLOUR: Record<DiagramNodeKind, CardColour> = { step: 'white', end: 'white', choice: 'yellow', text: 'white' };

export function addNode(diagram: Diagram, node: DiagramNode): Diagram {
  if (diagram.nodes.some((n) => n.id === node.id)) return diagram;
  return { ...diagram, nodes: [...diagram.nodes, node] };
}

export function updateNode(diagram: Diagram, id: string, patch: Partial<Omit<DiagramNode, 'id'>>): Diagram {
  const at = diagram.nodes.findIndex((n) => n.id === id);
  if (at < 0) return diagram;
  const node = diagram.nodes[at]!;
  const next = { ...node, ...patch };
  if ((Object.keys(patch) as (keyof DiagramNode)[]).every((k) => node[k] === next[k])) return diagram;
  return { ...diagram, nodes: diagram.nodes.map((n, i) => (i === at ? next : n)) };
}

/** Links a node to a board card, or unlinks it when `card` is undefined. */
export function linkNode(diagram: Diagram, id: string, card: string | undefined): Diagram {
  const node = diagram.nodes.find((n) => n.id === id);
  if (!node || node.card === card) return diagram;
  const { card: _old, ...rest } = node;
  return { ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? (card ? { ...rest, card } : rest) : n)) };
}

/** Removes a node and every edge that touches it. */
export function deleteNode(diagram: Diagram, id: string): Diagram {
  if (!diagram.nodes.some((n) => n.id === id)) return diagram;
  return { nodes: diagram.nodes.filter((n) => n.id !== id), edges: diagram.edges.filter((e) => e.from !== id && e.to !== id) };
}

/** Adds an edge between two different nodes; a second edge the same way between the same pair is refused. */
export function addEdge(diagram: Diagram, edge: DiagramEdge): Diagram {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  if (edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to)) return diagram;
  if (diagram.edges.some((e) => e.id === edge.id || (e.from === edge.from && e.to === edge.to))) return diagram;
  return { ...diagram, edges: [...diagram.edges, edge] };
}

/** Sets an edge's label; an empty label removes it. */
export function labelEdge(diagram: Diagram, id: string, label: string): Diagram {
  const edge = diagram.edges.find((e) => e.id === id);
  const text = label.trim();
  if (!edge || (edge.label ?? '') === text) return diagram;
  const { label: _old, ...rest } = edge;
  return { ...diagram, edges: diagram.edges.map((e) => (e.id === id ? (text ? { ...rest, label: text } : rest) : e)) };
}

export function deleteEdge(diagram: Diagram, id: string): Diagram {
  if (!diagram.edges.some((e) => e.id === id)) return diagram;
  return { ...diagram, edges: diagram.edges.filter((e) => e.id !== id) };
}

/** True when every edge names two nodes that exist. */
export const edgesValid = (diagram: Diagram): boolean => {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  return diagram.edges.every((e) => ids.has(e.from) && ids.has(e.to));
};
