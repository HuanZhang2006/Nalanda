#!/usr/bin/env python3
"""Near-limit deterministic Office render canary for the 2 GB production host."""

from __future__ import annotations

import json
import resource
import tempfile
import time
from pathlib import Path

from app.parsers import parse_material
from docx import Document
from docx.enum.text import WD_BREAK


def rss_bytes(kind: int) -> int:
    value = resource.getrusage(kind).ru_maxrss
    # Linux reports KiB; macOS reports bytes. The production image is Linux.
    return int(value * 1024)


started = time.monotonic()
with tempfile.TemporaryDirectory(prefix="nalanda-material-ai-canary-") as directory:
    root = Path(directory)
    source = root / "near-limit-office.docx"
    work = root / "work"
    work.mkdir(mode=0o700)
    document = Document()
    paragraph_text = (
        "Retrieval practice strengthens durable memory by requiring active recall. "
        "Spacing reviews across dates improves retention and exposes knowledge gaps. "
    ) * 11
    for page in range(220):
        document.add_heading(f"Study section {page + 1}", level=1)
        document.add_paragraph(paragraph_text)
        if page < 219:
            document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    document.save(source)
    parsed, visual_regions = parse_material(source, work, source.name)
    rendered = next((work / "rendered").glob("*.pdf"), None)
    temp_bytes = sum(item.stat().st_size for item in root.rglob("*") if item.is_file())
    character_count = sum(len(block.text) for block in parsed.blocks)
    if parsed.pageCount < 200 or rendered is None or character_count < 300_000:
        raise RuntimeError("near-limit Office fixture was not fully rendered and extracted")
    print(json.dumps({
        "ok": True,
        "pages": parsed.pageCount,
        "characters": character_count,
        "visualRegions": len(visual_regions),
        "tempBytes": temp_bytes,
        "processPeakRssBytes": rss_bytes(resource.RUSAGE_SELF),
        "childPeakRssBytes": rss_bytes(resource.RUSAGE_CHILDREN),
        "durationMs": round((time.monotonic() - started) * 1000),
    }, separators=(",", ":")))
