"""生成逻辑。

当前为可运行的桩实现（无需 API key 即可启动/联调）。真实实现将基于
ExamPass-Assistant 的多智能体流水线（Skeleton / Notes / Item / Reviewer /
Solver）调用 Claude，并用工具调用强制输出与下列 schema 一致的 JSON。
"""
from .schemas import (
    ExamQuestion,
    ExamSection,
    GraphNode,
    KnowledgeGraph,
    KnowledgePoint,
    MockExam,
    QuizQuestion,
)


def knowledge_list(text: str, lang: str) -> list[KnowledgePoint]:
    zh = lang == "zh"
    return [
        KnowledgePoint(
            title="示例概念" if zh else "Sample concept",
            definition="占位定义，待接入 Claude 生成。" if zh else "Placeholder definition.",
            tags=["stub"],
            order=1,
        )
    ]


def quiz(text: str, lang: str) -> list[QuizQuestion]:
    zh = lang == "zh"
    return [
        QuizQuestion(
            question="占位题目？" if zh else "Placeholder question?",
            options=["A", "B", "C", "D"],
            answerIndex=1,
            explanation="占位解析。" if zh else "Placeholder explanation.",
        )
    ]


def graph(text: str, lang: str) -> KnowledgeGraph:
    return KnowledgeGraph(
        nodes=[
            GraphNode(id="r", label="Root", level=0),
            GraphNode(id="a", label="A", level=1),
        ],
        edges=[("r", "a")],
    )


def exam(text: str, lang: str) -> MockExam:
    return MockExam(
        title="Mock Exam",
        meta="Stub · 100 marks",
        sections=[
            ExamSection(name="Section A", questions=[ExamQuestion(prompt="...", marks=10)])
        ],
    )
