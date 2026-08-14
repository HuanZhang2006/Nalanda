import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedExamAttempt, GeneratedExamNoteDetail, GeneratedKnowledgeGraphV1, GeneratedKnowledgeNoteDetail, GeneratedNoteSummary } from "@nalanda/types";
import "fake-indexeddb/auto";

const harness = vi.hoisted(() => ({
  courses: [{ id: "course-1", name: "Biology", code: "BIO" }],
  notes: vi.fn(), note: vi.fn(), attempts: vi.fn(), createAttempt: vi.fn(), saveAnswers: vi.fn(),
  submit: vi.fn(), attempt: vi.fn(), requestGrading: vi.fn(), deleteNote: vi.fn(),
  askKnowledgeNode: vi.fn(), knowledgeQuestion: vi.fn(),
  graphLayout: vi.fn(), saveGraphLayout: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({ data: harness.courses, error: null })),
      })),
    })),
  },
}));

vi.mock("./api", () => ({
  materialsAiApi: {
    notes: harness.notes,
    note: harness.note,
    attempts: harness.attempts,
    createAttempt: harness.createAttempt,
    saveAnswers: harness.saveAnswers,
    submit: harness.submit,
    attempt: harness.attempt,
    requestGrading: harness.requestGrading,
    deleteNote: harness.deleteNote,
    askKnowledgeNode: harness.askKnowledgeNode,
    knowledgeQuestion: harness.knowledgeQuestion,
    graphLayout: harness.graphLayout,
    saveGraphLayout: harness.saveGraphLayout,
  },
}));

// The real ELK/React Flow layout has its own tests. Keep this integration test
// focused on the Notes inspector contract without leaking React Flow's
// asynchronous measurement loop beyond React's test act() boundary.
vi.mock("./KnowledgeGraphCanvas", () => ({
  default: ({ graph, pinnedId, onInspect }: {
    graph: GeneratedKnowledgeGraphV1;
    pinnedId: string | null;
    onInspect: (nodeId: string | null, pinned: boolean) => void;
  }) => <div role="region" aria-label="Interactive knowledge graph">
    {graph.nodes.map((node) => <div className="react-flow__node" key={node.id}
      onMouseEnter={() => { if (!pinnedId) onInspect(node.id, false); }}
      onMouseLeave={() => { if (!pinnedId) onInspect(null, false); }}>
      <button className="material-flow-node-content" onClick={() => onInspect(pinnedId === node.id ? null : node.id, pinnedId !== node.id)}>{node.title}</button>
    </div>)}
  </div>,
}));

import { NotesView } from "./NotesView";

const summary: GeneratedNoteSummary = {
  pipeline: "document_ir_v1", model: "deepseek/deepseek-v4-flash-0731",
  id: "note-1", courseId: "course-1", courseName: "Biology", courseCode: "BIO", title: "Cells test paper",
  kind: "ai_exam", materialName: "cells.pdf", sourceDeleted: false, questionCount: 1, totalMarks: 10,
  nodeCount: 0, edgeCount: 0,
  createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
};

const detail: GeneratedExamNoteDetail = {
  ...summary,
  kind: "ai_exam",
  exam: {
    schemaVersion: "generated-exam.v1", title: "Cells test paper", language: "en", difficulty: "intermediate",
    durationMinutes: 30, totalMarks: 10, instructions: ["Answer every question."],
    sections: [{ id: "section-1", title: "Short answer", instructions: "", questions: [{
      id: "question-1", type: "short_answer", prompt: "What does a cell membrane do?", marks: 10,
      options: [], correctOptionIndexes: [], acceptedAnswers: ["controls movement"], modelAnswer: "It controls movement into and out of a cell.",
      explanation: "The membrane is selectively permeable.", rubric: ["Mentions control of movement"],
      sourceRefs: [{ blockId: "page-1:block-1", page: 1, slide: null, label: "Page 1" }],
    }] }],
  },
};

const graphDetail: GeneratedKnowledgeNoteDetail = {
  ...summary,
  id: "graph-note", title: "Cell knowledge map", kind: "ai_knowledge_graph",
  questionCount: 0, totalMarks: 0, nodeCount: 2, edgeCount: 1,
  graph: {
    schemaVersion: "generated-knowledge-graph.v1", title: "Cell knowledge map", language: "en",
    overview: "A source-ordered map of cells and membranes.", learningObjectives: ["Explain membrane transport"],
    nodes: [
      { id: "cell", title: "Cell", kind: "concept", level: 0, sourceOrder: 1, summary: "The basic unit of life.", explanation: "Cells are the basic structural and functional units of living organisms.", keyDetails: ["Contains organized structures"], examples: ["Animal cell"], formulas: [], commonMisconceptions: [], checkQuestions: ["What makes a cell a unit of life?"], keywords: ["cell"], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "Page 1" }] },
      { id: "membrane", title: "Cell membrane", kind: "process", level: 1, sourceOrder: 2, summary: "Controls transport.", explanation: "The membrane selectively regulates movement into and out of a cell.", keyDetails: ["Selectively permeable"], examples: ["Diffusion"], formulas: [], commonMisconceptions: ["It is not completely sealed"], checkQuestions: ["How does transport work?"], keywords: ["membrane"], sourceRefs: [{ blockId: "b2", page: 1, slide: null, label: "Page 1" }] },
    ],
    edges: [{ id: "edge-1", from: "cell", to: "membrane", relation: "part_of", label: "has boundary", explanation: "The membrane is part of the cell." }],
  },
};

function attempt(status: GeneratedExamAttempt["status"] = "in_progress", revision = 0): GeneratedExamAttempt {
  return {
    id: "attempt-1", noteId: detail.id, status, revision,
    deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(), submittedAt: null, completedAt: null,
    objectiveScore: 0, objectiveMarks: 0, totalScore: null, totalMarks: 10, answers: [], results: [],
    exam: {
      schemaVersion: "generated-exam.v1", title: detail.exam.title, language: "en", difficulty: "intermediate",
      durationMinutes: 30, totalMarks: 10, instructions: [], sections: [{ id: "section-1", title: "Short answer", instructions: "", questions: [{
        id: "question-1", type: "short_answer", prompt: "What does a cell membrane do?", marks: 10, options: [], sourceRefs: [],
      }] }],
    },
    serverNow: new Date().toISOString(),
  };
}

async function settle(work?: () => void | Promise<void>) {
  await act(async () => { await work?.(); await Promise.resolve(); await Promise.resolve(); });
}

function clickText(container: Element, text: string) {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function hoverGraphNode(container: Element, text: string) {
  const button = [...container.querySelectorAll(".material-flow-node-content")]
    .find((entry) => entry.textContent?.includes(text));
  const node = button?.closest(".react-flow__node");
  if (!node) throw new Error(`graph node not found: ${text}`);
  node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function setValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Materials AI My Notes and online exams", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("nalanda-material-ai");
      request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    harness.notes.mockResolvedValue([summary]); harness.note.mockResolvedValue(detail); harness.attempts.mockResolvedValue([]);
    harness.createAttempt.mockResolvedValue(attempt()); harness.saveAnswers.mockImplementation(async (_id, request) => ({
      ...attempt("in_progress", request.expectedRevision + 1), answers: request.answers,
    }));
    harness.submit.mockResolvedValue(attempt("grading", 2)); harness.attempt.mockResolvedValue(attempt("completed", 3));
    harness.requestGrading.mockResolvedValue(attempt("grading", 3)); harness.deleteNote.mockResolvedValue({ deleted: true });
    harness.graphLayout.mockResolvedValue({
      noteId: "graph-note", artifactVersion: "a".repeat(64), revision: 0,
      positions: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: null,
    });
    harness.saveGraphLayout.mockImplementation(async (_id, value) => ({
      noteId: "graph-note", artifactVersion: value.artifactVersion, revision: value.expectedRevision + 1,
      positions: value.positions, viewport: value.viewport, updatedAt: new Date().toISOString(),
    }));
    harness.askKnowledgeNode.mockResolvedValue({
      id: "question-job", noteId: "graph-note", nodeId: "membrane", question: "Why is it selective?", status: "succeeded",
      answer: { schemaVersion: "knowledge-node-answer.v1", answer: "Selective permeability controls which substances cross.", keyPoints: ["Transport is regulated"], sourceRefs: [{ blockId: "b2", page: 1, slide: null, label: "Page 1" }], followUpQuestions: ["What is diffusion?"] },
      errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), answeredAt: new Date().toISOString(),
    });
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  });

  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it("separates private generated papers from Demo data and filters by the real Materials course", async () => {
    const openReal = vi.fn();
    await settle(() => root.render(<NotesView userId="user-1" onOpenReal={openReal} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={vi.fn()} />));
    expect(container.textContent).toContain("Your generated notes");
    expect(container.textContent).toContain("Cells test paper");
    expect(container.textContent).toContain("Sample data — not your files");
    expect(container.textContent).toContain("BIO");
    await settle(() => clickText(container, "Cells test paper"));
    expect(openReal).toHaveBeenCalledWith("note-1");
    await settle(() => clickText(container, "Demo"));
    expect(container.textContent).not.toContain("Your generated notes");
    expect(container.textContent).toContain("Sample data — not your files");
  });

  it("starts a timed attempt and auto-saves an account-isolated draft after 500 ms", async () => {
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={vi.fn()} />));
    await settle(() => clickText(container, "Start timed attempt"));
    const answer = container.querySelector("textarea") as HTMLTextAreaElement;
    await settle(() => setValue(answer, "Controls movement"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 560)); });
    expect(harness.saveAnswers).toHaveBeenCalledWith("attempt-1", expect.objectContaining({
      expectedRevision: 0,
      answers: [{ questionId: "question-1", value: "Controls movement" }],
    }));
    expect(container.textContent).toContain("Leaving this page does not pause the timer");
  });

  it("waits for the pending save before leaving and supports another timed retake", async () => {
    const exit = vi.fn();
    let release!: (value: GeneratedExamAttempt) => void;
    harness.saveAnswers.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={exit} onMaterials={vi.fn()} toast={vi.fn()} />));
    await settle(() => clickText(container, "Start timed attempt"));
    await settle(() => setValue(container.querySelector("textarea") as HTMLTextAreaElement, "Draft"));
    await settle(() => clickText(container, "Save and exit"));
    expect(exit).not.toHaveBeenCalled();
    await settle(() => release({ ...attempt("in_progress", 1), answers: [{ questionId: "question-1", value: "Draft" }] }));
    await settle(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(exit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Cells test paper");
    await settle(() => clickText(container, "Start timed attempt"));
    expect(harness.createAttempt).toHaveBeenCalledTimes(2);
  });

  it("does not submit an exam while the newest device draft is unsynchronised", async () => {
    const toast = vi.fn();
    harness.saveAnswers.mockRejectedValue(new TypeError("offline"));
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={toast} />));
    await settle(() => clickText(container, "Start timed attempt"));
    await settle(() => setValue(container.querySelector("textarea") as HTMLTextAreaElement, "Offline answer"));
    await settle(() => clickText(container, "Submit paper"));
    await settle(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(harness.submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved on this device; waiting for the network");
    expect(toast).toHaveBeenCalledWith("Your latest answers are still only on this device. Reconnect before submitting.");
  });

  it("keeps answers private while drafting and grades only after the in-app whole-paper confirmation", async () => {
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={vi.fn()} />));
    await settle(() => clickText(container, "Start timed attempt"));
    expect(container.textContent).not.toContain("It controls movement into and out of a cell");
    expect(container.textContent).not.toContain("Answer and explanation");

    await settle(() => clickText(container, "Submit paper"));
    expect(harness.submit).not.toHaveBeenCalled();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.textContent).toContain("Submit the entire paper?");
    await settle(() => clickText(dialog!, "Submit paper"));

    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Subjective answers are being graded");
  });

  it("asks the server to enforce the absolute deadline when the local countdown expires", async () => {
    harness.createAttempt.mockResolvedValue({ ...attempt(), deadlineAt: new Date(Date.now() - 1).toISOString() });
    harness.attempt.mockResolvedValue(attempt("completed", 1));
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={vi.fn()} />));
    await settle(() => clickText(container, "Start timed attempt"));
    await settle(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(harness.attempt).toHaveBeenCalledWith("attempt-1");
    expect(container.textContent).toContain("This attempt has been submitted");
  });

  it("discards an unsynchronised late draft when the server reports that the deadline closed", async () => {
    const toast = vi.fn();
    harness.saveAnswers.mockResolvedValue({
      ...attempt("completed", 1),
      answers: [{ questionId: "question-1", value: "Server answer before deadline" }],
    });
    harness.attempt.mockResolvedValue({
      ...attempt("completed", 1),
      answers: [{ questionId: "question-1", value: "Server answer before deadline" }],
    });
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="note-1" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={toast} />));
    await settle(() => clickText(container, "Start timed attempt"));
    await settle(() => setValue(container.querySelector("textarea") as HTMLTextAreaElement, "Late offline answer"));
    await settle(() => clickText(container, "Submit paper"));
    await settle(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(harness.submit).not.toHaveBeenCalled();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Server answer before deadline");
    expect(toast).toHaveBeenCalledWith("The deadline passed. Only answers synchronized before the deadline were submitted.");
  });

  it("renders a source-ordered interactive knowledge map and asks a selected node in English", async () => {
    harness.note.mockResolvedValue(graphDetail);
    harness.attempts.mockClear();
    await settle(() => root.render(<NotesView userId="user-1" initialNoteId="graph-note" onOpenReal={vi.fn()} onOpenDemo={vi.fn()} onBack={vi.fn()} onMaterials={vi.fn()} toast={vi.fn()} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Cell membrane"));

    expect(container.textContent).toContain("Knowledge map overview");
    expect(container.textContent).toContain("Cell membrane");
    expect(container.textContent).not.toContain("The basic unit of life");
    expect(container.querySelector('[role="region"][aria-label="Interactive knowledge graph"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/知识|来源|删除|提问/);
    expect(harness.attempts).not.toHaveBeenCalled();

    await settle(() => hoverGraphNode(container, "Cell"));
    expect(container.textContent).toContain("Cells are the basic structural and functional units of living organisms");
    await settle(() => clickText(container, "Cell membrane"));
    expect(container.textContent).toContain("Selectively permeable");
    await settle(() => setValue(container.querySelector("textarea") as HTMLTextAreaElement, "Why is it selective?"));
    await settle(() => clickText(container, "Ask this point"));
    expect(harness.askKnowledgeNode).toHaveBeenCalledWith("graph-note", "membrane", {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      question: "Why is it selective?",
    });
    expect(container.textContent).toContain("Selective permeability controls which substances cross");
  });
});
