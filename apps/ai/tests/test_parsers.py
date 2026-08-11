import json
from pathlib import Path

import pymupdf as fitz
import pytest
from docx import Document
from PIL import Image
from pptx import Presentation
from pptx.util import Inches

import app.parsers as parsers
from app.errors import PipelineError
from app.parsers import _zip_safety, parse_material


def test_text_json_csv_and_html_are_deterministic(tmp_path: Path):
    samples = {
        "notes.txt": b"Heading\n\nA paragraph.",
        "data.json": json.dumps({"topic": "memory", "items": [1, 2]}).encode(),
        "table.csv": b"name,value\nalpha,1\n",
        "page.html": b"<html><script>steal()</script><h1>Safe title</h1><p>Body</p></html>",
    }
    for name, payload in samples.items():
        path = tmp_path / name
        path.write_bytes(payload)
        document, visuals = parse_material(path, tmp_path, name)
        assert document.blocks
        assert not visuals
        assert "steal" not in " ".join(block.text for block in document.blocks)


def test_pdf_retains_page_mapping_and_marks_visual_only_page(tmp_path: Path):
    path = tmp_path / "source.pdf"
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Working memory has limited capacity and supports active processing.")
    pdf.new_page()
    pdf.save(path)
    pdf.close()
    document, visuals = parse_material(path, tmp_path, path.name)
    assert document.pageCount == 2
    assert any(block.page == 1 for block in document.blocks)
    assert any(region.page == 2 for region in visuals)


def test_standalone_image_requires_visual_recovery(tmp_path: Path):
    path = tmp_path / "chart.png"
    Image.new("RGB", (120, 80), "white").save(path)
    document, visuals = parse_material(path, tmp_path, path.name)
    assert document.blocks == []
    assert visuals[0].id == "image-1"


def test_image_pixel_bombs_are_rejected_before_decode(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(parsers, "MAX_IMAGE_PIXELS", 100)
    path = tmp_path / "oversized-pixels.png"
    Image.new("RGB", (20, 20), "white").save(path)
    with pytest.raises(PipelineError) as caught:
        parse_material(path, tmp_path, path.name)
    assert caught.value.code == "AI_IMAGE_DIMENSIONS_UNSUPPORTED"


def test_damaged_office_archive_is_rejected(tmp_path: Path):
    path = tmp_path / "broken.docx"
    path.write_bytes(b"not-a-zip")
    with pytest.raises(PipelineError) as caught:
        _zip_safety(path)
    assert caught.value.code == "AI_FILE_CORRUPT"


def test_docx_and_pptx_are_fully_rendered_but_only_visual_ranges_are_recovered(tmp_path: Path):
    picture = tmp_path / "diagram.png"
    Image.new("RGB", (160, 90), "white").save(picture)

    docx = tmp_path / "lesson.docx"
    document = Document()
    document.add_heading("Memory", level=1)
    document.add_paragraph("Working memory supports active processing.")
    document.add_picture(str(picture), width=Inches(2))
    document.save(docx)
    docx_work = tmp_path / "docx-work"
    docx_work.mkdir()
    parsed_docx, docx_visuals = parse_material(docx, docx_work, docx.name)
    assert parsed_docx.pageCount >= 1
    assert any(block.kind == "heading" for block in parsed_docx.blocks)
    assert len(docx_visuals) == 1

    pptx = tmp_path / "lesson.pptx"
    deck = Presentation()
    text_slide = deck.slides.add_slide(deck.slide_layouts[5])
    text_slide.shapes.title.text = "Deterministic text slide"
    visual_slide = deck.slides.add_slide(deck.slide_layouts[5])
    visual_slide.shapes.title.text = "Diagram slide"
    visual_slide.shapes.add_picture(str(picture), Inches(1), Inches(1.5), width=Inches(3))
    deck.save(pptx)
    pptx_work = tmp_path / "pptx-work"
    pptx_work.mkdir()
    parsed_pptx, pptx_visuals = parse_material(pptx, pptx_work, pptx.name)
    assert parsed_pptx.slideCount == 2
    assert [region.id for region in pptx_visuals] == ["s2"]
    assert any(block.slide == 1 for block in parsed_pptx.blocks)


def test_encrypted_pdf_zip_bomb_character_and_temp_limits_fail_closed(monkeypatch, tmp_path: Path):
    encrypted = tmp_path / "encrypted.pdf"
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "Private lesson")
    pdf.save(encrypted, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="learner")
    pdf.close()
    encrypted_work = tmp_path / "encrypted-work"
    encrypted_work.mkdir()
    with pytest.raises(PipelineError) as caught:
        parse_material(encrypted, encrypted_work, encrypted.name)
    assert caught.value.code == "AI_PDF_ENCRYPTED"

    archive = tmp_path / "bomb.docx"
    import zipfile
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as handle:
        handle.writestr("word/document.xml", b"0" * 2_000_000)
    with pytest.raises(PipelineError) as caught:
        _zip_safety(archive)
    assert caught.value.code == "AI_ARCHIVE_UNSAFE"

    large = tmp_path / "large.txt"
    large.write_text("too many characters")
    monkeypatch.setenv("MATERIAL_AI_MAX_CHARACTERS", "5")
    large_work = tmp_path / "large-work"
    large_work.mkdir()
    with pytest.raises(PipelineError) as caught:
        parse_material(large, large_work, large.name)
    assert caught.value.code == "AI_CHARACTER_LIMIT"

    monkeypatch.setenv("MATERIAL_AI_MAX_CHARACTERS", "400000")
    monkeypatch.setenv("MATERIAL_AI_JOB_TEMP_LIMIT_BYTES", "1")
    image = tmp_path / "visual.png"
    Image.new("RGB", (40, 40), "white").save(image)
    with pytest.raises(PipelineError) as caught:
        parse_material(image, tmp_path, image.name)
    assert caught.value.code == "AI_JOB_TEMP_LIMIT"


def test_html_embedded_image_is_recovered_but_external_image_fails_closed(tmp_path: Path):
    tiny = tmp_path / "tiny.png"
    Image.new("RGB", (20, 20), "white").save(tiny)
    import base64

    encoded = base64.b64encode(tiny.read_bytes()).decode()
    path = tmp_path / "embedded.html"
    path.write_text(f'<h1>Chart</h1><img alt="Growth chart" src="data:image/png;base64,{encoded}">')
    document, visuals = parse_material(path, tmp_path, path.name)
    assert visuals[0].id == "html-image-1"
    assert any(item.code == "HTML_EMBEDDED_VISUAL" for item in document.diagnostics)

    external = tmp_path / "external.html"
    external.write_text('<p>Text</p><img alt="Remote chart" src="https://example.com/chart.png">')
    document, visuals = parse_material(external, tmp_path, external.name)
    assert visuals == []
    assert any(item.severity == "failure" for item in document.diagnostics)

    markdown = tmp_path / "external.md"
    markdown.write_text("# Lesson\n\n![Remote diagram](https://example.com/diagram.png)")
    document, visuals = parse_material(markdown, tmp_path, markdown.name)
    assert visuals == []
    assert any(item.code == "MARKDOWN_EXTERNAL_VISUAL_UNAVAILABLE" for item in document.diagnostics)
