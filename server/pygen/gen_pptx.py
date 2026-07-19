#!/usr/bin/env python3
"""gen_pptx.py <spec.json> — generate a deck INHERITING a template's style.

Spec: { "template": "/abs/path.pptx", "output": "/abs/out.pptx",
        "title": str?, "author": str?,
        "slides": [ { "title": str, "bullets": [str]?, "body": str?,
                      "notes": str?, "layout": "title"|"content"? } ] }

Strategy — maximum inheritance, graceful degradation:
  1. Open the template with python-pptx: masters, layouts, theme colors,
     fonts, logos all come along for FREE.
  2. Drop the template's existing slides (they were style reference, not
     content) via the sldIdLst XML — the documented python-pptx recipe.
  3. For each spec slide, pick the best layout by PLACEHOLDER SHAPES:
     a layout with a TITLE + BODY placeholder for content slides, a
     CENTER_TITLE (or first) layout for title slides. Fill placeholders so
     the template's own positioning/typography applies. If a needed
     placeholder is missing, fall back to a plain textbox.
Result JSON on stdout: {"ok": true, "outputPath": ..., "slides": N}
"""
import json, sys, copy

def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)})); sys.exit(0)

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
except Exception as e:
    fail(f"python-pptx not available: {e}")

PH_TITLE  = {13, 1, 3}   # TITLE(13 in some versions?) — use idx-agnostic type names below
try:
    from pptx.enum.shapes import PP_PLACEHOLDER
except Exception:
    PP_PLACEHOLDER = None

def ph_types(layout):
    out = {}
    for ph in layout.placeholders:
        out[ph.placeholder_format.type] = ph.placeholder_format.idx
    return out

def is_title_type(t):
    if PP_PLACEHOLDER is None: return False
    return t in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)

def is_body_type(t):
    if PP_PLACEHOLDER is None: return False
    return t in (PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT)

def pick_layouts(prs):
    title_layout, content_layout = None, None
    for layout in prs.slide_layouts:
        types = [ph.placeholder_format.type for ph in layout.placeholders]
        has_title = any(is_title_type(t) for t in types)
        has_body  = any(is_body_type(t) for t in types)
        if has_title and has_body and content_layout is None:
            content_layout = layout
        if has_title and not has_body and title_layout is None:
            title_layout = layout
    # Fallbacks: conventional indices 0 (title) / 1 (title+content), else any
    layouts = list(prs.slide_layouts)
    if title_layout is None:
        title_layout = layouts[0] if layouts else None
    if content_layout is None:
        content_layout = layouts[1] if len(layouts) > 1 else title_layout
    return title_layout, content_layout

def drop_existing_slides(prs):
    xml_slides = prs.slides._sldIdLst
    for sld in list(xml_slides):
        xml_slides.remove(sld)

def set_title(slide, text):
    for ph in slide.placeholders:
        if is_title_type(ph.placeholder_format.type):
            ph.text = text or ""
            return True
    return False

def set_body(slide, bullets, body):
    for ph in slide.placeholders:
        if is_body_type(ph.placeholder_format.type):
            tf = ph.text_frame
            items = bullets if bullets else ([body] if body else [])
            if not items:
                tf.text = ""
                return True
            tf.text = str(items[0])
            for it in items[1:]:
                p = tf.add_paragraph()
                p.text = str(it)
            return True
    return False

def add_textbox(slide, text, top_in, size, bold=False):
    box = slide.shapes.add_textbox(Inches(0.6), Inches(top_in), Inches(12.0), Inches(1.0))
    tf = box.text_frame
    tf.text = text or ""
    for p in tf.paragraphs:
        for r in p.runs:
            r.font.size = Pt(size)
            r.font.bold = bold
    return box

def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    prs = Presentation(spec["template"])
    if spec.get("title"):  prs.core_properties.title  = spec["title"]
    if spec.get("author"): prs.core_properties.author = spec["author"]
    drop_existing_slides(prs)
    title_layout, content_layout = pick_layouts(prs)
    if title_layout is None:
        fail("template has no usable slide layouts")

    n = 0
    for s in spec.get("slides", []):
        is_title = s.get("layout") == "title" or (not s.get("bullets") and not s.get("body"))
        layout = title_layout if is_title else content_layout
        slide = prs.slides.add_slide(layout)
        if not set_title(slide, s.get("title", "")):
            add_textbox(slide, s.get("title", ""), 0.4, 30, bold=True)
        if is_title:
            if s.get("body") and not set_body(slide, None, s.get("body")):
                add_textbox(slide, s.get("body"), 4.2, 18)
        else:
            if not set_body(slide, s.get("bullets"), s.get("body")):
                text = "\n".join(s.get("bullets") or ([s.get("body")] if s.get("body") else []))
                add_textbox(slide, text, 1.6, 16)
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = str(s["notes"])
        n += 1

    prs.save(spec["output"])
    print(json.dumps({"ok": True, "outputPath": spec["output"], "slides": n, "engine": "python-pptx (template-inherited)"}))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        fail(e)
