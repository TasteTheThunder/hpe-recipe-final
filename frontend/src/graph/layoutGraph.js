import dagre from 'dagre';

export default function layoutGraph(nodes, edges, direction = 'LR') {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 160, nodesep: 80, edgesep: 30 });

  nodes.forEach((n) => {
    const w = n.type === 'component' ? 180 : 280;
    const h = n.type === 'component' ? 60 : 110;
    g.setNode(n.id, { width: w, height: h });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const w = n.type === 'component' ? 180 : 280;
    const h = n.type === 'component' ? 60 : 110;
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}
