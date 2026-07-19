#!/usr/bin/env python3
"""gen_docx.py <spec.json> — generate a document INHERITING a template's
styles (fonts, colors, heading formats, page setup, headers/footers).

Spec: { "template": "/abs/path.docx", "output": "/abs/out.docx",
        "title": str?, "markdown": str }

Strategy:
  1. Open the template with python-docx: styles, theme, sectPr (margins,
     header/footer with logos) come along.
  2. Clear the template's BODY content (paragraphs + tables) while keeping
     the final sectPr — content was reference, chrome stays.
  3. Append the markdown using the template's OWN named styles:
     'Title', 'Heading 1..3', 'List Bullet', 'List Number', 'Normal'.
     Missing style → graceful fallback to Normal. Inline **bold** and
     *italic* become runs.
Result JSON on stdout.
"""
import json, re, sys

def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)})); sys.exit(0)

try:
    import docx
    from docx import Document
except Exception as e:
    fail(f"python-docx not available: {e}")

def clear_body(doc):
    body = doc.element.body
    # Keep the trailing sectPr (page setup / headers-footers), drop the rest.
    for child in list(body):
        if child.tag.endswith('}sectPr'):
            continue
        body.remove(child)

def style_or(doc, name, fallback=None):
    try:
        doc.styles[name]
        return name
    except KeyError:
        return fallback

INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*)")

def add_runs(par, text):
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            par.add_run(text[pos:m.start()])
        tok = m.group(0)
        if tok.startswith("**"):
            par.add_run(tok[2:-2]).bold = True
        else:
            par.add_run(tok[1:-1]).italic = True
        pos = m.end()
    if pos < len(text):
        par.add_run(text[pos:])

def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    doc = Document(spec["template"])
    clear_body(doc)

    S = {
        "title": style_or(doc, "Title"),
        "h1": style_or(doc, "Heading 1"),
        "h2": style_or(doc, "Heading 2"),
        "h3": style_or(doc, "Heading 3"),
        "bullet": style_or(doc, "List Bullet"),
        "number": style_or(doc, "List Number"),
    }

    if spec.get("title"):
        p = doc.add_paragraph()
        if S["title"]: p.style = S["title"]
        add_runs(p, spec["title"])

    para_buf = []
    def flush_para():
        nonlocal para_buf
        if para_buf:
            p = doc.add_paragraph()
            add_runs(p, " ".join(para_buf))
            para_buf = []

    for raw in spec.get("markdown", "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush_para(); continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            flush_para()
            lvl = len(m.group(1))
            p = doc.add_paragraph()
            st = S["h1"] if lvl == 1 else S["h2"] if lvl == 2 else S["h3"]
            if st: p.style = st
            add_runs(p, m.group(2))
            continue
        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m:
            flush_para()
            p = doc.add_paragraph(style=S["bullet"]) if S["bullet"] else doc.add_paragraph()
            add_runs(p, m.group(1))
            continue
        m = re.match(r"^\s*\d+[.)]\s+(.*)$", line)
        if m:
            flush_para()
            p = doc.add_paragraph(style=S["number"]) if S["number"] else doc.add_paragraph()
            add_runs(p, m.group(1))
            continue
        para_buf.append(line.strip())
    flush_para()

    doc.save(spec["output"])
    print(json.dumps({"ok": True, "outputPath": spec["output"], "engine": "python-docx (template-inherited)"}))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        fail(e)
