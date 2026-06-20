"""Pydantic 模型 —— 与 packages/types 及原型 app/data.js 形状对齐。"""
from typing import List, Literal, Tuple

from pydantic import BaseModel

Language = Literal["zh", "en"]
GenerationKind = Literal["knowledge-list", "quiz", "graph", "exam"]


class KnowledgePoint(BaseModel):
    title: str
    definition: str
    tags: List[str] = []
    order: int


class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    answerIndex: int
    explanation: str
    type: str = "single"


class GraphNode(BaseModel):
    id: str
    label: str
    level: int


class KnowledgeGraph(BaseModel):
    nodes: List[GraphNode]
    edges: List[Tuple[str, str]]


class ExamQuestion(BaseModel):
    prompt: str
    marks: int


class ExamSection(BaseModel):
    name: str
    questions: List[ExamQuestion]


class MockExam(BaseModel):
    title: str
    meta: str
    sections: List[ExamSection]


class ParseRequest(BaseModel):
    storage_path: str
    material_type: str


class GenerateRequest(BaseModel):
    material_id: str
    text: str = ""
    lang: Language = "zh"
