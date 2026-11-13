"""Turns a research report written in simple markdown into a Word (.docx) file
with real clickable links."""
import re
from pathlib import Path

_INLINE = re.compile(
    r"\[([^\]]+)\]\((https?://[^\s)]+)\)"      # [text](url)
    r"|\*\*(.+?)\*\*"                           # **bold**
    r"|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)"  # *italic*
    r"|(https?://[^\s<>\])]+)"                  # bare address
)


def _add_link(paragraph, text: str, url: str) -> None:
    from docx.opc.constants import RELATIONSHIP_TYPE
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    rel = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rel)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    colour = OxmlElement("w:color")
    colour.set(qn("w:val"), "0563C1")
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    props.append(colour)
    props.append(underline)
    run.append(props)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


def _add_inline(paragraph, text: str) -> None:
    pos = 0
    for m in _INLINE.finditer(text):
        if m.start() > pos:
            paragraph.add_run(text[pos:m.start()])
        if m.group(2):
            _add_link(paragraph, m.group(1), m.group(2))
        elif m.group(3) is not None:
            paragraph.add_run(m.group(3)).bold = True
        elif m.group(4) is not None:
            paragraph.add_run(m.group(4)).italic = True
        else:
            url = m.group(5).rstrip(".,;:")
            _add_link(paragraph, url, url)
            if len(url) < len(m.group(5)):
                paragraph.add_run(m.group(5)[len(url):])
        pos = m.end()
    if pos < len(text):
        paragraph.add_run(text[pos:])


def _table_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def write_docx(path: Path, title: str, meta_lines: list[str], markdown: str) -> None:
    from docx import Document
    doc = Document()
    doc.add_heading(title, level=0)
    for line in meta_lines:
        p = doc.add_paragraph()
        p.add_run(line).italic = True

    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if heading:
            text = re.sub(r"[*_`]", "", heading.group(2)).strip()
            if not (len(heading.group(1)) == 1 and text.lower() == title.lower()):
                doc.add_heading(text, level=min(len(heading.group(1)), 3))
            i += 1
            continue
        # a table: a row of |cells| followed by a |---|---| line
        if stripped.startswith("|") and i + 1 < len(lines) and \
                re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]) and "-" in lines[i + 1]:
            rows = [_table_row(stripped)]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_table_row(lines[i]))
                i += 1
            width = max(len(r) for r in rows)
            table = doc.add_table(rows=len(rows), cols=width)
            table.style = "Table Grid"
            for r, row in enumerate(rows):
                for c in range(width):
                    cell = table.cell(r, c)
                    para = cell.paragraphs[0]
                    _add_inline(para, row[c] if c < len(row) else "")
                    if r == 0:
                        for run in para.runs:
                            run.bold = True
            doc.add_paragraph()
            continue
        bullet = re.match(r"^[-*+]\s+(.*)$", stripped)
        numbered = re.match(r"^\d+[.)]\s+(.*)$", stripped)
        if bullet:
            _add_inline(doc.add_paragraph(style="List Bullet"), bullet.group(1))
        elif numbered:
            _add_inline(doc.add_paragraph(style="List Number"), numbered.group(1))
        else:
            # join the following plain lines into one paragraph
            parts = [stripped]
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(
                    r"^\s*(#{1,4}\s|[-*+]\s|\d+[.)]\s|\|)", lines[i + 1]):
                i += 1
                parts.append(lines[i].strip())
            _add_inline(doc.add_paragraph(), " ".join(parts))
        i += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(path))
