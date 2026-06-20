"""Nalanda AI 微服务（FastAPI）—— 内部专用，仅 NestJS 调用。"""
import os

from fastapi import FastAPI

from . import generation
from .schemas import GenerateRequest, ParseRequest

app = FastAPI(title="Nalanda AI Service", version="0.0.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "nalanda-ai",
        "claude": "configured" if os.getenv("ANTHROPIC_API_KEY") else "unset",
    }


@app.post("/parse")
def parse(req: ParseRequest):
    # TODO: 基于 ExamPass extract_pptx/docx/pdf；PDF 图像页用 Claude 多模态 OCR
    return {"material_type": req.material_type, "blocks": [], "text": ""}


@app.post("/generate/knowledge-list")
def gen_knowledge(req: GenerateRequest):
    return generation.knowledge_list(req.text, req.lang)


@app.post("/generate/quiz")
def gen_quiz(req: GenerateRequest):
    return generation.quiz(req.text, req.lang)


@app.post("/generate/graph")
def gen_graph(req: GenerateRequest):
    return generation.graph(req.text, req.lang)


@app.post("/generate/exam")
def gen_exam(req: GenerateRequest):
    return generation.exam(req.text, req.lang)
