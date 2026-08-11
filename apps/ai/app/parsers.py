"""Deterministic, bounded Materials parsers producing DocumentIR."""

from __future__ import annotations

import base64
import binascii
import csv
import hashlib
import io
import json
import os
import re
import resource
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx
import pymupdf as fitz
from bs4 import BeautifulSoup
from charset_normalizer import from_bytes
from docx import Document
from PIL import Image
from pptx import Presentation

from .errors import PipelineError
from .schemas import DocumentBlock, DocumentIR, ParseDiagnostic, VisualRegion

PARSER_VERSION = "materials-parser.v1"
MAX_BYTES = 25 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 250
MAX_CHARS = 400_000
MAX_ZIP_UNCOMPRESSED = 400 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
SUPPORTED = {"pdf", "docx", "pptx", "md", "markdown", "html", "htm", "txt", "json", "csv", "png", "jpg", "jpeg", "webp"}


def _job_temp_limit() -> int:
    return int(os.getenv("MATERIAL_AI_JOB_TEMP_LIMIT_BYTES", str(1024 * 1024 * 1024)))


def _enforce_temp_limit(path: Path) -> None:
    total = sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    if total > _job_temp_limit():
        raise PipelineError("AI_JOB_TEMP_LIMIT", "AI processing exceeded its temporary disk limit", 503)
    minimum_free = int(os.getenv("MATERIAL_AI_TEMP_MIN_FREE_BYTES", str(512 * 1024 * 1024)))
    if shutil.disk_usage(path).free < minimum_free:
        raise PipelineError("AI_TEMP_DISK_PRESSURE", "AI processing is paused because temporary disk space is low", 503)


@dataclass
class ParsedDocument:
    document: DocumentIR
    visual_regions: list[VisualRegion]
    source_sha256: str


def _allowed_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    allowed = {
        item.strip().lower() for item in os.getenv("MATERIAL_AI_ALLOWED_STORAGE_HOSTS", "").split(",") if item.strip()
    }
    supabase = os.getenv("SUPABASE_URL", "")
    if supabase:
        allowed.add((urlparse(supabase).hostname or "").lower())
    if allowed:
        return host in allowed
    return os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")) != "production" and host in {
        "localhost",
        "127.0.0.1",
    }


async def download_material(url: str, destination: Path, claimed_size: int) -> tuple[str, int]:
    parsed = urlparse(url)
    if parsed.scheme not in (
        {"https"} if parsed.hostname not in {"localhost", "127.0.0.1"} else {"http", "https"}
    ) or not _allowed_host(url):
        raise PipelineError("MATERIAL_URL_REJECTED", "The private material URL is not allowed", 400)
    if claimed_size <= 0 or claimed_size > MAX_BYTES:
        raise PipelineError("AI_FILE_SIZE_UNSUPPORTED", "The material exceeds the processing size limit")
    digest = hashlib.sha256()
    total = 0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60), follow_redirects=False) as client:
            async with client.stream("GET", url) as response:
                if not response.is_success:
                    raise PipelineError("MATERIAL_DOWNLOAD_FAILED", "The private material could not be downloaded", 503)
                length = response.headers.get("content-length")
                if length and int(length) > MAX_BYTES:
                    raise PipelineError("AI_FILE_SIZE_UNSUPPORTED", "The material exceeds the processing size limit")
                with destination.open("wb") as handle:
                    async for chunk in response.aiter_bytes(64 * 1024):
                        total += len(chunk)
                        if total > MAX_BYTES:
                            raise PipelineError(
                                "AI_FILE_SIZE_UNSUPPORTED", "The material exceeds the processing size limit"
                            )
                        digest.update(chunk)
                        handle.write(chunk)
    except PipelineError:
        raise
    except (httpx.HTTPError, OSError, ValueError) as exc:
        raise PipelineError("MATERIAL_DOWNLOAD_FAILED", "The private material could not be downloaded", 503) from exc
    if total != claimed_size:
        # Storage metadata can drift after a replacement; safety is based on the
        # downloaded byte count, so a mismatch is diagnostic rather than trust.
        claimed_size = total
    return digest.hexdigest(), claimed_size


def _zip_safety(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            total = sum(item.file_size for item in infos)
            compressed = max(1, sum(item.compress_size for item in infos))
            if len(infos) > 20_000 or total > MAX_ZIP_UNCOMPRESSED or total / compressed > 100:
                raise PipelineError("AI_ARCHIVE_UNSAFE", "The Office archive exceeds safe expansion limits")
            if any(Path(item.filename).is_absolute() or ".." in Path(item.filename).parts for item in infos):
                raise PipelineError("AI_ARCHIVE_UNSAFE", "The Office archive contains an unsafe path")
    except PipelineError:
        raise
    except (zipfile.BadZipFile, OSError) as exc:
        raise PipelineError("AI_FILE_CORRUPT", "The Office file is damaged or invalid") from exc


def _block(
    blocks: list[DocumentBlock],
    *,
    prefix: str,
    order: float,
    kind: str,
    text: str,
    label: str,
    page: int | None = None,
    slide: int | None = None,
) -> None:
    value = re.sub(r"[ \t]+", " ", text).strip()
    if not value:
        return
    blocks.append(
        DocumentBlock(
            id=f"{prefix}-b{len([item for item in blocks if item.id.startswith(prefix + '-')]) + 1}",
            order=order,
            kind=kind,
            text=value,
            page=page,
            slide=slide,
            label=label,
        )
    )


def _render_page(page: fitz.Page, path: Path) -> None:
    width = max(1.0, float(page.rect.width))
    height = max(1.0, float(page.rect.height))
    scale = min(1.5, 3000 / width, 3000 / height, (MAX_IMAGE_PIXELS / (width * height)) ** 0.5)
    if scale <= 0 or width * scale < 10 or height * scale < 10:
        raise PipelineError("AI_PAGE_DIMENSIONS_UNSUPPORTED", "A rendered page has unsafe dimensions")
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    pixmap.save(path)
    _enforce_temp_limit(path.parent)


def _parse_pdf(path: Path, workdir: Path, title: str) -> tuple[DocumentIR, list[VisualRegion]]:
    try:
        pdf = fitz.open(path)
    except Exception as exc:
        raise PipelineError("AI_FILE_CORRUPT", "The PDF is damaged or invalid") from exc
    if pdf.needs_pass:
        pdf.close()
        raise PipelineError("AI_PDF_ENCRYPTED", "Encrypted PDFs are not supported")
    if pdf.page_count > MAX_PAGES:
        pdf.close()
        raise PipelineError("AI_PAGE_LIMIT", "The file exceeds 250 pages")
    blocks: list[DocumentBlock] = []
    diagnostics: list[ParseDiagnostic] = []
    visuals: list[VisualRegion] = []
    page_count = pdf.page_count
    for page_index in range(page_count):
        page = pdf.load_page(page_index)
        page_no = page_index + 1
        prefix = f"p{page_no}"
        raw_blocks = page.get_text("blocks", sort=True)
        for item_index, item in enumerate(raw_blocks):
            _block(
                blocks,
                prefix=prefix,
                order=page_no * 1000 + item_index,
                kind="paragraph",
                text=str(item[4]),
                label=f"Page {page_no}",
                page=page_no,
            )
        tables_found = False
        table_diagnostic_failed = False
        try:
            tables = page.find_tables().tables
            for table_index, table in enumerate(tables):
                rows = table.extract()
                text = "\n".join("\t".join(str(cell or "") for cell in row) for row in rows)
                _block(
                    blocks,
                    prefix=prefix,
                    order=page_no * 1000 + 800 + table_index,
                    kind="table",
                    text=text,
                    label=f"Page {page_no} table {table_index + 1}",
                    page=page_no,
                )
                tables_found = True
        except Exception:
            table_diagnostic_failed = True
            diagnostics.append(
                ParseDiagnostic(
                    rangeId=prefix,
                    severity="failure",
                    code="PDF_TABLE_DIAGNOSTIC_FAILED",
                    message="Table structure may require visual recovery",
                )
            )
        text_length = sum(len(block.text) for block in blocks if block.page == page_no)
        has_visual = bool(page.get_images(full=True)) or len(page.get_drawings()) >= 8 or table_diagnostic_failed
        if text_length < 40 or has_visual:
            image_path = workdir / f"visual-{prefix}.png"
            _render_page(page, image_path)
            reason = "little deterministic text" if text_length < 40 else "page contains visual information"
            visuals.append(
                VisualRegion(
                    id=prefix,
                    order=page_no * 1000 + 900,
                    page=page_no,
                    label=f"Page {page_no}",
                    reason=reason,
                    localPath=str(image_path),
                )
            )
            diagnostics.append(
                ParseDiagnostic(
                    rangeId=prefix,
                    severity="failure",
                    code="PDF_VISUAL_RECOVERY",
                    message=reason,
                )
            )
        elif tables_found:
            diagnostics.append(
                ParseDiagnostic(
                    rangeId=prefix,
                    severity="info",
                    code="PDF_TABLE_EXTRACTED",
                    message="Table cells were extracted deterministically",
                )
            )
    pdf.close()
    return DocumentIR(
        title=title, sourceType="pdf", pageCount=page_count, slideCount=0, blocks=blocks, diagnostics=diagnostics
    ), visuals


def _limit_office_process():
    try:
        memory = 640 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
        resource.setrlimit(resource.RLIMIT_FSIZE, (_job_temp_limit(), _job_temp_limit()))
        os.nice(15)
    except (ValueError, OSError):
        pass


def _libreoffice_render(path: Path, workdir: Path) -> Path:
    binary = shutil.which("libreoffice") or shutil.which("soffice")
    if not binary:
        raise PipelineError("LIBREOFFICE_UNAVAILABLE", "Office rendering is unavailable", 503)
    output = workdir / "rendered"
    profile = workdir / "lo-profile"
    output.mkdir(mode=0o700)
    profile.mkdir(mode=0o700)
    command = [
        binary,
        "--headless",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to",
        "pdf",
        "--outdir",
        str(output),
        str(path),
    ]
    ionice = shutil.which("ionice")
    if ionice:
        command = [ionice, "-c", "3", *command]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=int(os.getenv("MATERIAL_AI_LIBREOFFICE_TIMEOUT_SECONDS", "120")),
            check=False,
            preexec_fn=_limit_office_process if os.name == "posix" else None,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineError("OFFICE_RENDER_TIMEOUT", "Office rendering exceeded the time limit") from exc
    rendered = next(output.glob("*.pdf"), None)
    if result.returncode != 0 or not rendered:
        raise PipelineError("OFFICE_RENDER_FAILED", "The Office file could not be rendered")
    _enforce_temp_limit(workdir)
    return rendered


def _extract_image_blob(blob: bytes, path: Path) -> bool:
    if len(blob) > MAX_IMAGE_BYTES:
        return False
    try:
        with Image.open(io.BytesIO(blob)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise PipelineError("AI_IMAGE_DIMENSIONS_UNSUPPORTED", "An embedded image has unsafe dimensions")
            image.verify()
        path.write_bytes(blob)
        _enforce_temp_limit(path.parent)
        return True
    except PipelineError:
        raise
    except Exception:
        return False


def _parse_docx(path: Path, workdir: Path, title: str) -> tuple[DocumentIR, list[VisualRegion]]:
    _zip_safety(path)
    try:
        doc = Document(path)
    except Exception as exc:
        raise PipelineError("AI_FILE_CORRUPT", "The DOCX is damaged or invalid") from exc
    blocks: list[DocumentBlock] = []
    visuals: list[VisualRegion] = []
    diagnostics: list[ParseDiagnostic] = []
    for index, paragraph in enumerate(doc.paragraphs):
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        _block(
            blocks,
            prefix="d1",
            order=index,
            kind="heading" if style.startswith("heading") else "paragraph",
            text=paragraph.text,
            label=paragraph.style.name if paragraph.style else "Paragraph",
        )
    for index, table in enumerate(doc.tables):
        value = "\n".join("\t".join(cell.text for cell in row.cells) for row in table.rows)
        _block(blocks, prefix="d1", order=100_000 + index, kind="table", text=value, label=f"Table {index + 1}")
    for index, relationship in enumerate(doc.part.rels.values()):
        if "image" not in relationship.reltype:
            continue
        blob = relationship.target_part.blob
        image_path = workdir / f"visual-image-{index + 1}"
        suffix = Path(str(getattr(relationship.target_part, "partname", "image.png"))).suffix or ".png"
        image_path = image_path.with_suffix(suffix)
        if _extract_image_blob(blob, image_path):
            region_id = f"image-{index + 1}"
            visuals.append(
                VisualRegion(
                    id=region_id,
                    order=110_000 + index,
                    label=f"Embedded image {index + 1}",
                    reason="embedded visual requires semantic extraction",
                    localPath=str(image_path),
                )
            )
            diagnostics.append(
                ParseDiagnostic(
                    rangeId=region_id,
                    severity="failure",
                    code="DOCX_EMBEDDED_VISUAL",
                    message="Embedded visual requires recovery",
                )
            )
    rendered = _libreoffice_render(path, workdir)
    rendered_pdf = fitz.open(rendered)
    if rendered_pdf.page_count > MAX_PAGES:
        rendered_pdf.close()
        raise PipelineError("AI_PAGE_LIMIT", "The file exceeds 250 rendered pages")
    page_count = rendered_pdf.page_count
    rendered_pdf.close()
    return DocumentIR(
        title=title, sourceType="docx", pageCount=page_count, slideCount=0, blocks=blocks, diagnostics=diagnostics
    ), visuals


def _shape_text(shape) -> str:
    return str(getattr(shape, "text", "") or "").strip()


def _parse_pptx(path: Path, workdir: Path, title: str) -> tuple[DocumentIR, list[VisualRegion]]:
    _zip_safety(path)
    try:
        deck = Presentation(path)
    except Exception as exc:
        raise PipelineError("AI_FILE_CORRUPT", "The PPTX is damaged or invalid") from exc
    if len(deck.slides) > MAX_PAGES:
        raise PipelineError("AI_PAGE_LIMIT", "The file exceeds 250 slides")
    blocks: list[DocumentBlock] = []
    visuals: list[VisualRegion] = []
    diagnostics: list[ParseDiagnostic] = []
    slides_needing_render: set[int] = set()
    for slide_index, slide in enumerate(deck.slides, 1):
        prefix = f"s{slide_index}"
        for shape_index, shape in enumerate(slide.shapes):
            order = slide_index * 1000 + shape_index
            text = _shape_text(shape)
            if text:
                _block(
                    blocks,
                    prefix=prefix,
                    order=order,
                    kind="paragraph",
                    text=text,
                    label=f"Slide {slide_index}",
                    slide=slide_index,
                )
            if getattr(shape, "has_table", False):
                table = shape.table
                value = "\n".join("\t".join(cell.text for cell in row.cells) for row in table.rows)
                _block(
                    blocks,
                    prefix=prefix,
                    order=order + 0.1,
                    kind="table",
                    text=value,
                    label=f"Slide {slide_index} table",
                    slide=slide_index,
                )
            if getattr(shape, "has_chart", False):
                chart_lines: list[str] = []
                try:
                    categories = [str(category) for category in shape.chart.plots[0].categories]
                    chart_lines.append("Categories: " + " | ".join(categories))
                    for series in shape.chart.series:
                        chart_lines.append(f"{series.name}: " + " | ".join(str(value) for value in series.values))
                    _block(
                        blocks,
                        prefix=prefix,
                        order=order + 0.2,
                        kind="chart",
                        text="\n".join(chart_lines),
                        label=f"Slide {slide_index} chart",
                        slide=slide_index,
                    )
                except Exception:
                    slides_needing_render.add(slide_index)
            if getattr(shape, "shape_type", None) == 13:  # MSO_SHAPE_TYPE.PICTURE
                slides_needing_render.add(slide_index)
        if not any(block.slide == slide_index for block in blocks):
            slides_needing_render.add(slide_index)
    rendered = _libreoffice_render(path, workdir)
    pdf = fitz.open(rendered)
    if pdf.page_count != len(deck.slides):
        pdf.close()
        raise PipelineError("OFFICE_RENDER_COUNT_MISMATCH", "Rendered slide count differs from the source")
    for slide_index in sorted(slides_needing_render):
        if slide_index > pdf.page_count:
            continue
        image_path = workdir / f"visual-s{slide_index}.png"
        _render_page(pdf.load_page(slide_index - 1), image_path)
        visuals.append(
            VisualRegion(
                id=f"s{slide_index}",
                order=slide_index * 1000 + 900,
                slide=slide_index,
                label=f"Slide {slide_index}",
                reason="slide contains visual information",
                localPath=str(image_path),
            )
        )
        diagnostics.append(
            ParseDiagnostic(
                rangeId=f"s{slide_index}",
                severity="failure",
                code="PPTX_VISUAL_RECOVERY",
                message="Slide requires visual recovery",
            )
        )
    pdf.close()
    return DocumentIR(
        title=title, sourceType="pptx", pageCount=0, slideCount=len(deck.slides), blocks=blocks, diagnostics=diagnostics
    ), visuals


def _decode_text(data: bytes) -> str:
    result = from_bytes(data).best()
    if not result:
        raise PipelineError("AI_TEXT_ENCODING_UNSUPPORTED", "The text encoding could not be detected")
    return str(result)


def _embedded_data_image(source: str, output: Path) -> bool:
    match = re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,(.+)", source, re.I | re.S)
    if not match:
        return False
    try:
        payload = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        return False
    if len(payload) > MAX_IMAGE_BYTES:
        raise PipelineError("AI_FILE_SIZE_UNSUPPORTED", "An embedded image exceeds 10 MB")
    return _extract_image_blob(payload, output.with_suffix("." + match.group(1).lower().replace("jpg", "jpeg")))


def _text_document(path: Path, workdir: Path, title: str, extension: str) -> tuple[DocumentIR, list[VisualRegion]]:
    text = _decode_text(path.read_bytes())
    visuals: list[VisualRegion] = []
    diagnostics: list[ParseDiagnostic] = []
    if extension == "json":
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except json.JSONDecodeError as exc:
            raise PipelineError("AI_FILE_CORRUPT", "The JSON document is invalid") from exc
    elif extension == "csv":
        try:
            rows = list(csv.reader(io.StringIO(text)))
            text = "\n".join("\t".join(row) for row in rows)
        except csv.Error as exc:
            raise PipelineError("AI_FILE_CORRUPT", "The CSV document is invalid") from exc
    elif extension in {"html", "htm"}:
        soup = BeautifulSoup(text, "html.parser")
        for index, image in enumerate(soup.find_all("img"), 1):
            label = str(image.get("alt") or image.get("title") or f"Embedded image {index}")
            source = str(image.get("src") or "")
            region_id = f"html-image-{index}"
            output = workdir / region_id
            if source.startswith("data:image/") and _embedded_data_image(source, output):
                image_path = next(workdir.glob(region_id + ".*"))
                visuals.append(
                    VisualRegion(
                        id=region_id,
                        order=90_000 + index,
                        label=label,
                        reason="embedded HTML visual requires semantic extraction",
                        localPath=str(image_path),
                    )
                )
                diagnostics.append(
                    ParseDiagnostic(
                        rangeId=region_id,
                        severity="failure",
                        code="HTML_EMBEDDED_VISUAL",
                        message="Embedded visual requires recovery",
                    )
                )
            elif source:
                diagnostics.append(
                    ParseDiagnostic(
                        rangeId=region_id,
                        severity="failure",
                        code="HTML_EXTERNAL_VISUAL_UNAVAILABLE",
                        message="External HTML images are not fetched",
                    )
                )
            image.replace_with(f" [Image: {label}] ")
        for unwanted in soup(["script", "style", "iframe", "object", "embed"]):
            unwanted.decompose()
        text = soup.get_text("\n", strip=True)
    elif extension in {"md", "markdown"}:

        def replace_markdown_image(match: re.Match[str]) -> str:
            index = len(visuals) + len(diagnostics) + 1
            label, source = match.group(1) or f"Embedded image {index}", match.group(2)
            region_id = f"markdown-image-{index}"
            output = workdir / region_id
            if source.startswith("data:image/") and _embedded_data_image(source, output):
                image_path = next(workdir.glob(region_id + ".*"))
                visuals.append(
                    VisualRegion(
                        id=region_id,
                        order=90_000 + index,
                        label=label,
                        reason="embedded Markdown visual requires semantic extraction",
                        localPath=str(image_path),
                    )
                )
                diagnostics.append(
                    ParseDiagnostic(
                        rangeId=region_id,
                        severity="failure",
                        code="MARKDOWN_EMBEDDED_VISUAL",
                        message="Embedded visual requires recovery",
                    )
                )
            else:
                diagnostics.append(
                    ParseDiagnostic(
                        rangeId=region_id,
                        severity="failure",
                        code="MARKDOWN_EXTERNAL_VISUAL_UNAVAILABLE",
                        message="External Markdown images are not fetched",
                    )
                )
            return f"[Image: {label}]"

        text = re.sub(r"!\[([^\]]*)\]\((data:image/[^)]+|https?://[^)]+|[^)]+)\)", replace_markdown_image, text)
    blocks: list[DocumentBlock] = []
    for index, part in enumerate(re.split(r"\n\s*\n", text)):
        heading = extension in {"md", "markdown"} and part.lstrip().startswith("#")
        _block(
            blocks,
            prefix="t1",
            order=index,
            kind="heading" if heading else "paragraph",
            text=part,
            label="Document text",
        )
    return DocumentIR(
        title=title, sourceType=extension, pageCount=0, slideCount=0, blocks=blocks, diagnostics=diagnostics
    ), visuals


def _image_document(path: Path, title: str, extension: str) -> tuple[DocumentIR, list[VisualRegion]]:
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise PipelineError("AI_FILE_SIZE_UNSUPPORTED", "Images must be no larger than 10 MB")
    try:
        with Image.open(path) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise PipelineError("AI_IMAGE_DIMENSIONS_UNSUPPORTED", "The image has unsafe dimensions")
            image.verify()
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("AI_FILE_CORRUPT", "The image is damaged or unsupported") from exc
    region = VisualRegion(
        id="image-1", order=1, label="Image", reason="standalone visual requires extraction", localPath=str(path)
    )
    diagnostic = ParseDiagnostic(
        rangeId="image-1", severity="failure", code="IMAGE_VISUAL_RECOVERY", message="Image requires visual extraction"
    )
    return DocumentIR(
        title=title, sourceType=extension, pageCount=1, slideCount=0, blocks=[], diagnostics=[diagnostic]
    ), [region]


def parse_material(path: Path, workdir: Path, original_name: str) -> tuple[DocumentIR, list[VisualRegion]]:
    extension = (Path(original_name).suffix.lower().lstrip(".") or "").lower()
    if extension not in SUPPORTED:
        raise PipelineError("AI_FILE_TYPE_UNSUPPORTED", "This file type is not supported")
    if extension == "pdf":
        document, visuals = _parse_pdf(path, workdir, Path(original_name).stem)
    elif extension == "docx":
        document, visuals = _parse_docx(path, workdir, Path(original_name).stem)
    elif extension == "pptx":
        document, visuals = _parse_pptx(path, workdir, Path(original_name).stem)
    elif extension in {"png", "jpg", "jpeg", "webp"}:
        document, visuals = _image_document(path, Path(original_name).stem, extension)
    else:
        document, visuals = _text_document(path, workdir, Path(original_name).stem, extension)
    total = sum(len(block.text) for block in document.blocks)
    if total > int(os.getenv("MATERIAL_AI_MAX_CHARACTERS", str(MAX_CHARS))):
        raise PipelineError("AI_CHARACTER_LIMIT", "The extracted document exceeds the text limit")
    if not document.blocks and not visuals:
        raise PipelineError("AI_EMPTY_DOCUMENT", "No study content could be extracted")
    _enforce_temp_limit(workdir)
    return document, visuals


def image_data_url(path: str) -> str:
    source = Path(path)
    try:
        with Image.open(source) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise PipelineError("AI_IMAGE_DIMENSIONS_UNSUPPORTED", "A visual region has unsafe dimensions")
            image.thumbnail((1800, 1800))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=85, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except Exception as exc:
        raise PipelineError("VISUAL_REGION_UNREADABLE", "A visual region could not be prepared") from exc


def canonical_document(document: DocumentIR) -> dict:
    value = document.model_dump()
    value["blocks"] = [block.model_dump() for block in sorted(document.blocks, key=lambda item: (item.order, item.id))]
    return value
