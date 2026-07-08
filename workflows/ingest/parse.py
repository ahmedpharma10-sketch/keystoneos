"""MinerU parse stage: document (PDF/scan/office) -> clean text/Markdown.

Uses opendatalab/MinerU when installed (it preserves layout, tables, formulas,
and runs OCR on scans — exactly what keeps a document's structure from being
destroyed before chunking, CLAUDE.md §6). Falls back to reading plain text so
.txt/.md/.json ingest, and the whole pipeline, work with zero models.
"""

from __future__ import annotations

import os


def _mineru_available() -> bool:
    try:
        import mineru  # noqa: F401
        return True
    except Exception:
        try:
            import magic_pdf  # noqa: F401  (MinerU's legacy package name)
            return True
        except Exception:
            return False


def parse_document(path: str) -> str:
    """Return clean text/Markdown for `path`.

    - .txt/.md/.json  -> read directly (no model needed).
    - .pdf/office/img -> MinerU if installed; else a clear, actionable error.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext in (".txt", ".md", ".markdown", ".json"):
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read()

    if _mineru_available():
        return _parse_with_mineru(path)

    raise RuntimeError(
        f"'{ext}' needs MinerU (pip install mineru). Offline fallback handles "
        f".txt/.md/.json only. See docs/ingest-graph-rag.md."
    )


def _parse_with_mineru(path: str) -> str:
    """Run MinerU -> Markdown. Integration point; kept behind availability so the
    offline path never imports the heavy dependency."""
    from mineru.cli.common import read_fn  # type: ignore
    from mineru.backend.pipeline.pipeline_analyze import doc_analyze  # type: ignore

    bytes_ = read_fn(path)
    result = doc_analyze([bytes_], lang_list=["en"])  # returns markdown blocks
    return result[0].get("markdown", "") if result else ""
