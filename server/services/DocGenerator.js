'use strict';

/**
 * DocGenerator — creates .pptx (pptxgenjs) and .docx (docx) files.
 *
 * Both libraries are pure-Node — no Python dependency, no subprocess.
 * Loaded lazily so operators who never generate documents don't pay
 * the require cost.
 *
 * Output path resolution mirrors the image tools:
 *   - project_id set → PROJECTS/<folder>/output/<filename>
 *   - otherwise      → PROJECTS/GODSTUFF/output/<filename> (or explicit outputPath)
 */

const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;

const log = {
  info: (...a) => console.log('[DocGenerator]', ...a),
  warn: (...a) => console.warn('[DocGenerator]', ...a),
};

class DocGenerator {
  constructor({ rm } = {}) {
    this.rm = rm;
  }

  async _resolveOutputPath({ filename, project_id, ext }) {
    const AQUARIUM = require('../aquarium');
    const safe = (filename || `document_${Date.now()}.${ext}`).replace(/[^\w.\-]/g, '_');
    const fname = safe.endsWith('.' + ext) ? safe : safe.replace(/\.[^.]+$/, '') + '.' + ext;
    if (project_id) {
      const proj = await this.rm.resolveProjectByNameOrId?.(project_id);
      const folder = proj?.entry?.folder || project_id;
      const dir = path.join(AQUARIUM.PROJECTS, folder, 'output');
      await fsp.mkdir(dir, { recursive: true });
      return path.join(dir, fname);
    }
    const godOut = path.join(AQUARIUM.PROJECTS, 'GODSTUFF', 'output');
    await fsp.mkdir(godOut, { recursive: true });
    return path.join(godOut, fname);
  }

  /**
   * generatePptx({ slides, filename?, project_id?, title?, author?, theme? })
   *   slides: [{ title, bullets?: string[], body?: string, notes?: string, layout?: 'title'|'content' }]
   *   theme:  'dark' | 'light' (default 'light')
   * @returns {Promise<{ok, outputPath?, error?}>}
   */
  async generatePptx({ slides, filename, project_id, title, author, theme }) {
    if (!Array.isArray(slides) || slides.length === 0) {
      return { ok: false, error: 'slides array is required and must be non-empty' };
    }
    let pptxgen;
    try { pptxgen = require('pptxgenjs'); }
    catch { return { ok: false, error: 'pptxgenjs not installed. Run: npm install pptxgenjs' }; }

    try {
      const pres = new pptxgen();
      pres.layout = 'LAYOUT_WIDE';
      if (title)  pres.title = title;
      if (author) pres.author = author;
      const isDark = theme === 'dark';
      const bg  = isDark ? '0F172A' : 'FFFFFF';
      const fg  = isDark ? 'E2E8F0' : '0F172A';
      const acc = isDark ? '4FACFE' : '2563EB';

      for (const s of slides) {
        const slide = pres.addSlide();
        slide.background = { color: bg };
        const isTitleSlide = s.layout === 'title' || (!s.bullets?.length && !s.body);
        if (isTitleSlide) {
          slide.addText(s.title || '', {
            x: 0.5, y: 2.4, w: 12.3, h: 1.5,
            fontSize: 44, bold: true, color: acc, align: 'center',
          });
          if (s.body) slide.addText(s.body, {
            x: 0.5, y: 4.2, w: 12.3, h: 0.8,
            fontSize: 20, color: fg, align: 'center',
          });
        } else {
          slide.addText(s.title || '', {
            x: 0.5, y: 0.35, w: 12.3, h: 0.7,
            fontSize: 28, bold: true, color: acc,
          });
          // Accent underline
          slide.addShape('rect', {
            x: 0.5, y: 1.05, w: 1.2, h: 0.05, fill: { color: acc },
          });
          const items = s.bullets && s.bullets.length
            ? s.bullets.map(b => ({ text: String(b), options: { bullet: { code: '25CF' }, color: fg } }))
            : [{ text: s.body || '', options: { color: fg } }];
          slide.addText(items, {
            x: 0.7, y: 1.4, w: 12.0, h: 5.6,
            fontSize: 18, valign: 'top', paraSpaceAfter: 8,
          });
        }
        if (s.notes) slide.addNotes(String(s.notes));
      }

      const outputPath = await this._resolveOutputPath({ filename, project_id, ext: 'pptx' });
      await pres.writeFile({ fileName: outputPath });
      log.info(`wrote ${slides.length}-slide deck → ${outputPath}`);
      return { ok: true, outputPath, slides: slides.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * generateDocx({ markdown, filename?, project_id?, title? })
   *   markdown: string — supports # ## ### headings, - / * / 1. lists,
   *             **bold**, *italic*, blank-line paragraphs. Not a full
   *             markdown engine — sufficient for LLM-generated content.
   * @returns {Promise<{ok, outputPath?, error?}>}
   */
  async generateDocx({ markdown, filename, project_id, title }) {
    if (!markdown || typeof markdown !== 'string') {
      return { ok: false, error: 'markdown is required and must be a string' };
    }
    let docx;
    try { docx = require('docx'); }
    catch { return { ok: false, error: 'docx not installed. Run: npm install docx' }; }
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

    try {
      const children = [];
      if (title) {
        children.push(new Paragraph({
          text: title,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        }));
      }

      // Split markdown into logical blocks
      const lines = markdown.split(/\r?\n/);
      let listBuffer = [];   // pending list items to flush before a non-list line
      let paraBuffer = [];   // pending paragraph lines
      const flushPara = () => {
        if (!paraBuffer.length) return;
        const text = paraBuffer.join(' ');
        children.push(new Paragraph({ children: this._inlineRuns(text, TextRun) }));
        paraBuffer = [];
      };
      const flushList = () => {
        if (!listBuffer.length) return;
        for (const it of listBuffer) {
          children.push(new Paragraph({
            children: this._inlineRuns(it.text, TextRun),
            bullet: it.numbered ? undefined : { level: 0 },
            numbering: it.numbered ? { reference: 'ol', level: 0 } : undefined,
          }));
        }
        listBuffer = [];
      };

      for (const raw of lines) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim()) { flushPara(); flushList(); continue; }

        const heading = line.match(/^(#{1,6})\s+(.*)/);
        if (heading) {
          flushPara(); flushList();
          const lvl = heading[1].length;
          const lvlMap = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
                          HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
          children.push(new Paragraph({
            text: heading[2].trim(),
            heading: lvlMap[lvl - 1] || HeadingLevel.HEADING_6,
          }));
          continue;
        }

        const bullet = line.match(/^\s*[-*]\s+(.*)/);
        if (bullet)  { flushPara(); listBuffer.push({ text: bullet[1],  numbered: false }); continue; }
        const ordered = line.match(/^\s*\d+\.\s+(.*)/);
        if (ordered) { flushPara(); listBuffer.push({ text: ordered[1], numbered: true  }); continue; }

        // Regular text — accumulate into current paragraph
        flushList();
        paraBuffer.push(line.trim());
      }
      flushPara(); flushList();

      const doc = new Document({
        creator:  'SquidMind',
        title:    title || filename || 'Document',
        sections: [{ children }],
        numbering: {
          config: [{
            reference: 'ol',
            levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
          }],
        },
      });

      const buffer = await Packer.toBuffer(doc);
      const outputPath = await this._resolveOutputPath({ filename, project_id, ext: 'docx' });
      await fsp.writeFile(outputPath, buffer);
      log.info(`wrote docx (${buffer.length}B) → ${outputPath}`);
      return { ok: true, outputPath, bytes: buffer.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Split text into TextRuns honouring **bold** and *italic* markers.
   * Deliberately minimal — handles the two most common inline styles
   * from LLM output without a full markdown parser.
   */
  _inlineRuns(text, TextRun) {
    const runs = [];
    // Combined regex: **bold** OR *italic*
    const re = /\*\*([^*]+?)\*\*|\*([^*]+?)\*/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }));
      if (m[1]) runs.push(new TextRun({ text: m[1], bold: true }));
      else      runs.push(new TextRun({ text: m[2], italics: true }));
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }));
    return runs.length ? runs : [new TextRun({ text })];
  }
}

module.exports = { DocGenerator };
