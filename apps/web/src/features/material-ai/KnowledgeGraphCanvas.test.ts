import { describe, expect, it } from "vitest";
import type { GeneratedKnowledgeGraphV1, GeneratedKnowledgeNodeV1 } from "@nalanda/types";
import { layoutKnowledgeGraph } from "./KnowledgeGraphCanvas";

function point(index: number, level = Math.floor(index / 25)): GeneratedKnowledgeNodeV1 {
  return {
    id: `point-${index}`,
    title: `Point ${index}`,
    kind: "concept",
    level,
    sourceOrder: index,
    summary: `Summary ${index}`,
    explanation: `Explanation ${index}`,
    keyDetails: [],
    examples: [],
    formulas: [],
    commonMisconceptions: [],
    checkQuestions: [],
    keywords: [],
    sourceRefs: [{ blockId: `block-${index}`, page: index + 1, slide: null, label: `Page ${index + 1}` }],
  };
}

function graph(nodes: GeneratedKnowledgeNodeV1[], edges: GeneratedKnowledgeGraphV1["edges"] = []): GeneratedKnowledgeGraphV1 {
  return {
    schemaVersion: "generated-knowledge-graph.v1",
    title: "Large graph",
    language: "en",
    overview: "Fixture",
    learningObjectives: [],
    nodes,
    edges,
  };
}

describe("ELK knowledge graph layout", () => {
  it("lays out 250 source-ordered nodes without overlapping cards", async () => {
    const nodes = Array.from({ length: 250 }, (_, index) => point(index));
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      from: nodes[Math.max(0, index - (index % 25))].id,
      to: node.id,
      relation: "part_of" as const,
      label: "contains",
      explanation: "Hierarchy fixture",
    }));
    const laidOut = await layoutKnowledgeGraph(graph(nodes, edges));

    expect(laidOut).toHaveLength(250);
    expect(laidOut.map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    for (let left = 0; left < laidOut.length; left += 1) {
      for (let right = left + 1; right < laidOut.length; right += 1) {
        const a = laidOut[left].position;
        const b = laidOut[right].position;
        const overlaps = a.x < b.x + 196 && b.x < a.x + 196
          && a.y < b.y + 76 && b.y < a.y + 76;
        expect(overlaps, `${laidOut[left].id} overlaps ${laidOut[right].id}`).toBe(false);
      }
    }
    expect(Math.min(...laidOut.filter((node) => node.data.source.level === 4).map((node) => node.position.x)))
      .toBeGreaterThanOrEqual(4 * (196 + 112));
    for (let level = 0; level < 10; level += 1) {
      const lane = laidOut.filter((node) => node.data.source.level === level);
      expect(lane.map((node) => node.data.source.sourceOrder))
        .toEqual([...lane].sort((a, b) => a.position.y - b.position.y).map((node) => node.data.source.sourceOrder));
    }
  }, 20_000);

  it("handles isolated points, cycles, and an empty artifact", async () => {
    const nodes = [point(0, 0), point(1, 1), point(2, 2), point(3, 0)];
    const cycle = [
      { id: "e1", from: "point-0", to: "point-1", relation: "prerequisite" as const, label: "", explanation: "" },
      { id: "e2", from: "point-1", to: "point-2", relation: "sequence" as const, label: "", explanation: "" },
      { id: "e3", from: "point-2", to: "point-0", relation: "related" as const, label: "", explanation: "" },
    ];
    await expect(layoutKnowledgeGraph(graph(nodes, cycle))).resolves.toHaveLength(4);
    await expect(layoutKnowledgeGraph(graph([]))).resolves.toEqual([]);
  });
});
