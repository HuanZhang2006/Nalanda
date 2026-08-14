import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { GeneratedKnowledgeGraphV1, GeneratedKnowledgeNodeV1, KnowledgeGraphLayout } from "@nalanda/types";
import "@xyflow/react/dist/style.css";
import { ApiClientError } from "../../lib/api";
import { materialsAiApi } from "./api";

const elk = new ELK();
const NODE_WIDTH = 196;
const NODE_HEIGHT = 76;
const NODE_GAP = 28;
const LANE_GAP = 112;

type GraphNode = Node<{ source: GeneratedKnowledgeNodeV1 }>;

function separateCollisions(input: GraphNode[]): GraphNode[] {
  const nodes = input.map((node) => ({ ...node, position: { ...node.position } }));
  for (let pass = 0; pass < Math.max(2, nodes.length); pass += 1) {
    let changed = false;
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left]; const b = nodes[right];
        const overlapsX = a.position.x < b.position.x + NODE_WIDTH + NODE_GAP
          && b.position.x < a.position.x + NODE_WIDTH + NODE_GAP;
        const overlapsY = a.position.y < b.position.y + NODE_HEIGHT + NODE_GAP
          && b.position.y < a.position.y + NODE_HEIGHT + NODE_GAP;
        if (overlapsX && overlapsY) {
          b.position.y = a.position.y + NODE_HEIGHT + NODE_GAP;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return nodes;
}

export async function layoutKnowledgeGraph(graph: GeneratedKnowledgeGraphV1): Promise<GraphNode[]> {
  const ordered = [...graph.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": String(NODE_GAP),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LANE_GAP),
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: ordered.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  });
  const elkPositions = new Map((result.children || []).map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }]));
  const laneBottom = new Map<number, number>();
  const nodes = ordered.map((source) => {
    const position = elkPositions.get(source.id) || { x: 0, y: 0 };
    const y = Math.max(position.y, (laneBottom.get(source.level) ?? -(NODE_HEIGHT + NODE_GAP)) + NODE_HEIGHT + NODE_GAP);
    laneBottom.set(source.level, y);
    return {
      id: source.id,
      type: "default",
      position: {
        x: Math.max(0, source.level) * (NODE_WIDTH + LANE_GAP),
        // Source order is authoritative within a level. ELK proposes vertical
        // positions; the monotonic floor prevents it from reordering or
        // overlapping nodes within that level.
        y,
      },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { source },
      className: "material-flow-node",
      ariaLabel: `${source.kind}: ${source.title}`,
    } satisfies GraphNode;
  });
  return separateCollisions(nodes);
}

function flowEdges(graph: GeneratedKnowledgeGraphV1): Edge[] {
  const hierarchy = new Set(["part_of", "prerequisite", "sequence"]);
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    label: edge.label || undefined,
    className: hierarchy.has(edge.relation) ? "material-flow-edge hierarchy" : "material-flow-edge association",
    style: hierarchy.has(edge.relation) ? undefined : { strokeDasharray: "5 6" },
    data: { explanation: edge.explanation, relation: edge.relation },
  }));
}

interface Props {
  noteId: string;
  graph: GeneratedKnowledgeGraphV1;
  pinnedId: string | null;
  onInspect: (nodeId: string | null, pinned: boolean) => void;
  toast: (message: string, icon?: string) => void;
}

export default function KnowledgeGraphCanvas({ noteId, graph, pinnedId, onInspect, toast }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const edges = useMemo(() => flowEdges(graph), [graph]);
  const [layout, setLayout] = useState<KnowledgeGraphLayout | null>(null);
  const instance = useRef<ReactFlowInstance<GraphNode, Edge> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const build = useCallback(async (stored?: KnowledgeGraphLayout | null) => {
    const automatic = await layoutKnowledgeGraph(graph);
    const saved = new Map((stored?.positions || []).map((position) => [position.nodeId, position]));
    const merged = separateCollisions(automatic.map((node) => {
      const position = saved.get(node.id);
      return position ? { ...node, position: { x: position.x, y: position.y } } : node;
    }));
    setNodes(merged);
    requestAnimationFrame(() => {
      if (stored?.viewport) instance.current?.setViewport(stored.viewport, { duration: 0 });
      else instance.current?.fitView({ padding: 0.18, duration: 0 });
    });
  }, [graph]);

  useEffect(() => {
    let alive = true;
    void materialsAiApi.graphLayout(noteId).then((stored) => {
      if (!alive) return;
      setLayout(stored); void build(stored);
    }).catch(() => { if (alive) void build(null); });
    return () => { alive = false; if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [build, noteId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pinnedId) onInspect(null, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onInspect, pinnedId]);

  const persist = useCallback(async (nextNodes: GraphNode[], viewport?: Viewport) => {
    if (!layout) return;
    const request = {
      artifactVersion: layout.artifactVersion,
      expectedRevision: layout.revision,
      positions: nextNodes.map((node) => ({ nodeId: node.id, x: node.position.x, y: node.position.y })),
      viewport: viewport || instance.current?.getViewport() || layout.viewport,
    };
    try {
      setLayout(await materialsAiApi.saveGraphLayout(noteId, request));
    } catch (failure) {
      if (failure instanceof ApiClientError && ["GRAPH_LAYOUT_REVISION_CONFLICT", "GRAPH_ARTIFACT_CHANGED"].includes(failure.code)) {
        try {
          const latest = await materialsAiApi.graphLayout(noteId);
          const known = new Set(nextNodes.map((node) => node.id));
          const merged = [
            ...nextNodes.map((node) => ({ nodeId: node.id, x: node.position.x, y: node.position.y })),
            ...latest.positions.filter((position) => !known.has(position.nodeId)),
          ];
          const saved = await materialsAiApi.saveGraphLayout(noteId, {
            artifactVersion: latest.artifactVersion,
            expectedRevision: latest.revision,
            positions: merged,
            viewport: request.viewport,
          });
          setLayout(saved);
          return;
        } catch { /* surface the stable message below */ }
      }
      toast("The graph layout could not be saved. Your content was not changed.");
    }
  }, [layout, noteId, toast]);

  const schedulePersist = useCallback((nextNodes: GraphNode[], viewport?: Viewport) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(nextNodes, viewport), 450);
  }, [persist]);

  const settleNodes = useCallback((next: GraphNode[]) => {
    const settled = separateCollisions(next);
    setNodes(settled); schedulePersist(settled);
  }, [schedulePersist]);

  const moveNodeWithKeyboard = useCallback((nodeId: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = ({
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    } as const)[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const distance = event.shiftKey ? 40 : 12;
    settleNodes(nodes.map((node) => node.id === nodeId ? {
      ...node,
      position: {
        x: node.position.x + direction[0] * distance,
        y: node.position.y + direction[1] * distance,
      },
    } : node));
  }, [nodes, settleNodes]);

  const arrange = useCallback(async () => {
    const arranged = await layoutKnowledgeGraph(graph);
    setNodes(arranged);
    requestAnimationFrame(() => instance.current?.fitView({ padding: 0.18, duration: 220 }));
    schedulePersist(arranged);
  }, [graph, schedulePersist]);

  return <div className="card material-flow-shell" role="region" aria-label="Interactive knowledge graph">
    <ReactFlow<GraphNode, Edge>
      nodes={nodes.map((node) => ({
        ...node,
        selected: node.id === pinnedId,
        data: {
          ...node.data,
          label: <button type="button" className="material-flow-node-content" aria-label={`${node.data.source.kind}: ${node.data.source.title}. Use arrow keys to move.`}
            onKeyDown={(event) => moveNodeWithKeyboard(node.id, event)}
            onFocus={() => onInspect(node.id, false)} onBlur={() => { if (!pinnedId) onInspect(null, false); }}>
            <span>{node.data.source.kind.replaceAll("_", " ")}</span><b>{node.data.source.title}</b>
          </button>,
        } as GraphNode["data"],
      }))}
      edges={edges}
      onInit={(value) => { instance.current = value; }}
      onNodesChange={(changes) => setNodes((current) => {
        const next = changes.reduce((items, change) => {
          if (change.type === "position" && change.position) return items.map((item) => item.id === change.id ? { ...item, position: change.position! } : item);
          if (change.type === "select") return items;
          return items;
        }, current);
        return next;
      })}
      onNodeDragStop={(_event, _node, dragged) => settleNodes(nodes.map((node) => dragged.find((item) => item.id === node.id) || node))}
      onNodeMouseEnter={(_event, node) => { if (!pinnedId) onInspect(node.id, false); }}
      onNodeMouseLeave={() => { if (!pinnedId) onInspect(null, false); }}
      onNodeClick={(_event, node) => onInspect(pinnedId === node.id ? null : node.id, pinnedId !== node.id)}
      onMoveEnd={(_event, viewport) => schedulePersist(nodes, viewport)}
      fitView
      minZoom={0.1}
      maxZoom={4}
      nodesFocusable
      panOnScroll
      zoomOnPinch
      zoomOnScroll
    >
      <Background gap={22} size={1} />
      <Controls showInteractive={false} />
      <Panel position="top-right"><button className="btn btn-sm" type="button" onClick={() => void arrange()}>Auto arrange</button></Panel>
    </ReactFlow>
  </div>;
}
