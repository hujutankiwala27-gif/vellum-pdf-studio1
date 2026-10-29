import {
  DetectedWatermarkCandidate,
  ExtractedTextSpan,
  NormalizedPoint,
  PageTextData,
  PdfAnnotation,
  PdfSearchMatch,
  ReadingTheme,
  StudioDocumentMeta,
} from '../types/pdfStudio';

/**
 * Parses a human page range string (e.g. "1-3, 5, 8-10" or "" / "all")
 * into sorted, deduplicated 1-based page numbers within [1, maxPages].
 */
export function parsePageRange(
  input: string,
  maxPages: number
): { pages: number[]; error: string | null } {
  const trimmed = input.trim().toLowerCase();
  if (maxPages < 1) {
    return { pages: [], error: 'Document has no pages.' };
  }
  if (!trimmed || trimmed === 'all' || trimmed === '*') {
    return {
      pages: Array.from({ length: maxPages }, (_, idx) => idx + 1),
      error: null,
    };
  }

  const pageSet = new Set<number>();
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { pages: [], error: 'Enter a valid page number or range (e.g. 1-4, 6).' };
  }

  for (const part of parts) {
    if (part.includes('-')) {
      const bounds = part.split('-').map((b) => b.trim());
      if (bounds.length !== 2 || !/^\d+$/.test(bounds[0]) || !/^\d+$/.test(bounds[1])) {
        return { pages: [], error: `Invalid range "${part}". Use format like 1-3.` };
      }
      const start = Number(bounds[0]);
      const end = Number(bounds[1]);
      if (start < 1 || end < 1 || start > end) {
        return { pages: [], error: `Range "${part}" must start at >= 1 and have start <= end.` };
      }
      if (end > maxPages) {
        return { pages: [], error: `Page ${end} exceeds document length (${maxPages} pages).` };
      }
      for (let p = start; p <= end; p++) {
        pageSet.add(p);
      }
    } else {
      if (!/^\d+$/.test(part)) {
        return { pages: [], error: `Invalid page number "${part}".` };
      }
      const pageNum = Number(part);
      if (pageNum < 1 || pageNum > maxPages) {
        return {
          pages: [],
          error: `Page ${pageNum} is outside 1-${maxPages}.`,
        };
      }
      pageSet.add(pageNum);
    }
  }

  return {
    pages: Array.from(pageSet).sort((a, b) => a - b),
    error: null,
  };
}

const COMMON_WATERMARK_KEYWORDS = [
  'confidential',
  'draft',
  'watermark',
  'sample',
  'do not copy',
  'internal use only',
  'uncontrolled copy',
  'void',
  'preview only',
];

/**
 * Analyzes extracted spans across pages to detect diagonal stamps and repeating watermark text.
 */
export function detectWatermarkCandidates(
  pages: PageTextData[]
): DetectedWatermarkCandidate[] {
  if (pages.length === 0) return [];

  const groups = new Map<
    string,
    {
      display: string;
      occurrences: number;
      pagesSet: Set<number>;
      diagonalCount: number;
      firstBounds: { x: number; y: number; width: number; height: number };
    }
  >();

  for (const page of pages) {
    for (const span of page.spans) {
      const cleaned = span.str.trim();
      if (cleaned.length < 3 || cleaned.length > 60) continue;
      // Ignore pure page numbers like "Page 1" or "1 of 4"
      if (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(cleaned)) continue;
      // Ignore bulleted or numbered prose lines
      if (/^([•\-*]|\d+\.)\s+/.test(cleaned)) continue;

      const normKey = cleaned.toLowerCase().replace(/\s+/g, ' ');
      const isAngled =
        Math.abs(span.angleDeg) >= 8 && Math.abs(Math.abs(span.angleDeg) - 90) >= 5;
      const isLargeStampFont = span.fontSize >= 20;
      const wordCount = normKey.split(' ').length;
      const isShortStampPhrase =
        wordCount <= 6 &&
        cleaned === cleaned.toUpperCase() &&
        COMMON_WATERMARK_KEYWORDS.some((kw) => normKey.includes(kw));

      // Only collect angled text, large >=20pt overlay text, or short uppercase stamp phrases
      if (!isAngled && !isLargeStampFont && !isShortStampPhrase) {
        continue;
      }

      const existing = groups.get(normKey);
      if (existing) {
        existing.occurrences += 1;
        existing.pagesSet.add(page.pageNumber);
        if (isAngled) existing.diagonalCount += 1;
      } else {
        groups.set(normKey, {
          display: cleaned,
          occurrences: 1,
          pagesSet: new Set([page.pageNumber]),
          diagonalCount: isAngled ? 1 : 0,
          firstBounds: {
            x: span.x,
            y: span.y,
            width: span.width,
            height: span.height,
          },
        });
      }
    }
  }

  const results: DetectedWatermarkCandidate[] = [];
  let idx = 0;

  for (const [normKey, entry] of groups.entries()) {
    const pageCoverage = entry.pagesSet.size / Math.max(1, pages.length);
    const isDiagonal = entry.diagonalCount > 0;
    const hasKeyword = COMMON_WATERMARK_KEYWORDS.some((kw) => normKey.includes(kw));
    const repeatsOnMultiplePages =
      pages.length >= 2 && entry.pagesSet.size >= Math.max(2, Math.ceil(pages.length * 0.5));

    if (isDiagonal || (hasKeyword && repeatsOnMultiplePages) || (hasKeyword && pages.length === 1)) {
      results.push({
        id: `wm_${idx++}`,
        text: entry.display,
        occurrences: entry.occurrences,
        pagesAffected: Array.from(entry.pagesSet).sort((a, b) => a - b),
        isDiagonal,
        confidence: isDiagonal || pageCoverage >= 0.5 ? 'high' : 'medium',
        sampleBounds: entry.firstBounds,
      });
    }
  }

  return results.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return b.pagesAffected.length - a.pagesAffected.length;
  });
}

/**
 * Formats byte size into human-readable KB / MB / GB with tabular-friendly precision.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Returns CSS filter string for Xodo-style reading comfort modes.
 */
export function getThemeCanvasFilter(theme: ReadingTheme): string {
  switch (theme) {
    case ReadingTheme.SEPIA:
      return 'sepia(0.38) contrast(0.96) brightness(0.97)';
    case ReadingTheme.DARK:
      return 'invert(0.88) hue-rotate(180deg) contrast(0.95)';
    case ReadingTheme.INVERT:
      return 'invert(1) hue-rotate(180deg)';
    case ReadingTheme.LIGHT:
    default:
      return 'none';
  }
}

/**
 * Splits a base64 string into bounded chunks respecting Firestore 700,000-char chunk limit.
 */
export function chunkBase64String(base64: string, maxChunkChars = 650000): string[] {
  if (!base64) return [];
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += maxChunkChars) {
    chunks.push(base64.slice(i, i + maxChunkChars));
  }
  return chunks;
}

export function reassembleBase64Chunks(
  chunks: { index: number; data: string }[]
): string {
  return [...chunks]
    .sort((a, b) => a.index - b.index)
    .map((c) => c.data)
    .join('');
}

/**
 * Sanitizes outgoing DocumentRecord strings/numbers to strictly obey firebase-blueprint.json bounds.
 */
export function sanitizeDocumentPayload(input: {
  ownerId: string;
  title: string;
  pageCount: number;
  fileSizeBytes: number;
  chunkCount: number;
  watermarkRemoved: boolean;
  annotations: PdfAnnotation[];
  aiSummary: string;
  starred: boolean;
}) {
  const safeTitle = (input.title || 'Untitled.pdf').trim().slice(0, 240) || 'Untitled.pdf';
  let serializedAnnotations = JSON.stringify(input.annotations ?? []);
  if (serializedAnnotations.length > 150000) {
    // Gracefully drop heavy inline signature data URLs if over 150KB limit
    const compact = (input.annotations ?? []).map((ann) => ({
      ...ann,
      signatureDataUrl: ann.signatureDataUrl ? undefined : ann.signatureDataUrl,
    }));
    serializedAnnotations = JSON.stringify(compact).slice(0, 150000);
  }
  if (serializedAnnotations.length < 2) {
    serializedAnnotations = '[]';
  }

  return {
    ownerId: input.ownerId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128),
    title: safeTitle,
    pageCount: Math.max(1, Math.min(20000, Math.round(input.pageCount || 1))),
    fileSizeBytes: Math.max(0, Math.min(2147483648, Math.round(input.fileSizeBytes || 0))),
    chunkCount: Math.max(0, Math.min(25, Math.round(input.chunkCount || 0))),
    watermarkRemoved: Boolean(input.watermarkRemoved),
    annotationsPayload: serializedAnnotations,
    aiSummary: (input.aiSummary || '').slice(0, 40000),
    starred: Boolean(input.starred),
  };
}

/**
 * Pure document format builders from extracted PageTextData[]
 */
export function buildMarkdownFromPages(title: string, pages: PageTextData[]): string {
  const header = `# ${title.replace(/\.pdf$/i, '')}\n\n`;
  const body = pages
    .map((p) => {
      const lines = p.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const formatted = lines
        .map((line, i) => {
          if (i === 0 && line.length < 80 && !line.endsWith('.')) {
            return `## ${line}`;
          }
          return line;
        })
        .join('\n\n');
      return `<!-- Page ${p.pageNumber} -->\n${formatted || '*(Blank or image-only page)*'}`;
    })
    .join('\n\n---\n\n');
  return header + body + '\n';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHtmlFromPages(title: string, pages: PageTextData[]): string {
  const cleanTitle = escapeHtml(title.replace(/\.pdf$/i, ''));
  const sections = pages
    .map((p) => {
      const paragraphs = p.text
        .split(/\n{2,}|\r\n{2,}/)
        .map((blk) => blk.trim())
        .filter(Boolean)
        .map((blk) => `<p>${escapeHtml(blk).replace(/\n/g, '<br/>')}</p>`)
        .join('\n');
      return `<section class="pdf-page" data-page="${p.pageNumber}">
  <header class="page-marker">Page ${p.pageNumber}</header>
  ${paragraphs || '<p class="empty-note">Visual / scanned page content</p>'}
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${cleanTitle}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1.5rem; color: #0f172a; line-height: 1.65; background: #f8fafc; }
    h1 { font-size: 1.75rem; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.75rem; }
    .pdf-page { background: #ffffff; border: 1px solid #e2e8f0; padding: 2rem; margin-bottom: 1.5rem; border-radius: 6px; }
    .page-marker { font-size: 0.75rem; color: #64748b; margin-bottom: 1rem; font-family: monospace; }
  </style>
</head>
<body>
  <h1>${cleanTitle}</h1>
  ${sections}
</body>
</html>`;
}

export function buildWordCompatibleDocHtml(title: string, pages: PageTextData[]): string {
  const cleanTitle = escapeHtml(title.replace(/\.pdf$/i, ''));
  const content = pages
    .map((p, idx) => {
      const lines = p.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `<p style="margin:0 0 8pt 0;font-family:Calibri,Arial,sans-serif;font-size:11pt;">${escapeHtml(l)}</p>`)
        .join('');
      const pageBreak =
        idx < pages.length - 1
          ? '<br clear="all" style="page-break-before:always" />'
          : '';
      return `<div>${lines}</div>${pageBreak}`;
    })
    .join('\n');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${cleanTitle}</title></head>
<body>
<h1 style="font-family:Calibri,Arial,sans-serif;font-size:18pt;color:#0f172a;">${cleanTitle}</h1>
${content}
</body></html>`;
}

export function buildCsvFromPages(pages: PageTextData[]): string {
  const rows: string[] = ['"Page","Row","Column_1","Column_2","Column_3","Column_4"'];
  for (const page of pages) {
    // Group spans into horizontal rows by similar Y coordinate (tolerance 0.012)
    const sorted = [...page.spans].sort((a, b) =>
      Math.abs(a.y - b.y) < 0.012 ? a.x - b.x : a.y - b.y
    );
    const lineBuckets: ExtractedTextSpan[][] = [];
    for (const span of sorted) {
      if (!span.str.trim()) continue;
      const lastBucket = lineBuckets[lineBuckets.length - 1];
      if (lastBucket && Math.abs(lastBucket[0].y - span.y) < 0.012) {
        lastBucket.push(span);
      } else {
        lineBuckets.push([span]);
      }
    }

    lineBuckets.forEach((bucket, rowIdx) => {
      const cols = bucket.map((s) => s.str.trim()).filter(Boolean);
      if (cols.length === 0) return;
      const padded = [cols[0] || '', cols[1] || '', cols[2] || '', cols.slice(3).join(' ')];
      const escaped = padded.map((c) => `"${c.replace(/"/g, '""')}"`);
      rows.push(`${page.pageNumber},${rowIdx + 1},${escaped.join(',')}`);
    });
  }
  return rows.join('\n');
}

/**
 * Finds all text occurrences across all PDF pages, computing normalized sub-span bounding boxes
 * and surrounding context snippets for instant global highlight + quick result navigation.
 */
export function findGlobalSearchMatches(
  pages: PageTextData[],
  rawQuery: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean }
): PdfSearchMatch[] {
  const query = rawQuery.trim();
  if (!query || pages.length === 0) return [];

  const caseSensitive = Boolean(options?.caseSensitive);
  const wholeWord = Boolean(options?.wholeWord);
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: PdfSearchMatch[] = [];

  const isWordChar = (ch: string | undefined) => Boolean(ch && /[\p{L}\p{N}_]/u.test(ch));

  const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  for (const page of orderedPages) {
    // Sort spans in natural reading order (top-to-bottom, left-to-right)
    const orderedSpans = [...page.spans].sort((a, b) =>
      Math.abs(a.y - b.y) < 0.012 ? a.x - b.x : a.y - b.y
    );

    for (const span of orderedSpans) {
      const text = span.str;
      if (!text) continue;
      const haystack = caseSensitive ? text : text.toLowerCase();
      const totalChars = Math.max(1, text.length);

      let searchFrom = 0;
      while (searchFrom <= haystack.length - needle.length) {
        const hitPos = haystack.indexOf(needle, searchFrom);
        if (hitPos === -1) break;

        const endPos = hitPos + needle.length;
        const prevChar = hitPos > 0 ? text[hitPos - 1] : undefined;
        const nextChar = endPos < text.length ? text[endPos] : undefined;

        const passesWholeWord =
          !wholeWord || (!isWordChar(prevChar) && !isWordChar(nextChar));

        if (passesWholeWord) {
          const startRatio = hitPos / totalChars;
          const lengthRatio = needle.length / totalChars;
          const spanAngle = span.angleDeg || 0;
          const isRotated = Math.abs(spanAngle) >= 3;
          const rad = (spanAngle * Math.PI) / 180;
          const aspect = (page.widthPt || 612) / (page.heightPt || 792);

          const rawSubX = isRotated
            ? span.x + span.width * startRatio * Math.cos(rad)
            : span.x + span.width * startRatio;
          const rawSubY = isRotated
            ? span.y - span.width * startRatio * Math.sin(rad) * aspect
            : span.y;

          const subX = Math.max(0, Math.min(0.99, rawSubX));
          const subY = Math.max(0, Math.min(0.99, rawSubY));
          const subW = Math.min(
            1 - subX,
            Math.max(0.012, span.width * lengthRatio)
          );

          const snippetStart = Math.max(0, hitPos - 26);
          const snippetEnd = Math.min(text.length, endPos + 32);
          const prefix =
            (snippetStart > 0 ? '…' : '') + text.slice(snippetStart, hitPos);
          const matchedText = text.slice(hitPos, endPos);
          const suffix =
            text.slice(endPos, snippetEnd) + (snippetEnd < text.length ? '…' : '');

          const globalIdx = matches.length;
          matches.push({
            id: `match_${page.pageNumber}_${span.id}_${hitPos}_${globalIdx}`,
            index: globalIdx,
            pageNumber: page.pageNumber,
            spanId: span.id,
            matchedText,
            prefix,
            suffix,
            x: subX,
            y: subY,
            width: subW,
            height: Math.max(0.016, span.height),
            angleDeg: isRotated ? spanAngle : 0,
          });
        }

        searchFrom = hitPos + Math.max(1, needle.length);
      }
    }
  }

  return matches;
}

/**
 * Extracts valid 1-based page numbers cited in AI assistant responses (e.g. "Page 2", "p. 4", "[Page 1, 3]").
 */
export function extractCitedPageNumbers(text: string, maxPages: number): number[] {
  if (!text || maxPages < 1) return [];
  const cited = new Set<number>();
  const regex = /\b(?:page|pages|pg\.?|p\.)\s*(\d{1,4})(?:\s*(?:,|and|&|-)\s*(\d{1,4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const p1 = Number(m[1]);
    if (p1 >= 1 && p1 <= maxPages) cited.add(p1);
    if (m[2]) {
      const p2 = Number(m[2]);
      if (p2 >= 1 && p2 <= maxPages) cited.add(p2);
    }
  }
  return Array.from(cited).sort((a, b) => a - b);
}

/**
 * Ensures a document filename has a clean .pdf extension for Google Drive storage.
 */
export function ensurePdfExtension(rawTitle: string): string {
  const cleaned = (rawTitle || '').trim().slice(0, 236) || 'Document.pdf';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

/**
 * Builds an RFC 2387 multipart/related binary body for Google Drive v3 file upload/update
 * without corrupting binary PDF bytes.
 */
export function buildGoogleDriveMultipartBody(
  metadata: Record<string, unknown>,
  pdfBytes: Uint8Array,
  boundary = 'vellum_drive_multipart_boundary_9f8e7d'
): { body: Uint8Array; contentType: string } {
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--`);

  const merged = new Uint8Array(preamble.byteLength + pdfBytes.byteLength + epilogue.byteLength);
  merged.set(preamble, 0);
  merged.set(pdfBytes, preamble.byteLength);
  merged.set(epilogue, preamble.byteLength + pdfBytes.byteLength);

  return {
    body: merged,
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export interface RawGoogleDriveFile {
  id: string;
  name?: string;
  size?: string | number;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

/**
 * Maps a Google Drive v3 File resource into a StudioDocumentMeta record.
 */
export function mapGoogleDriveFileToMeta(file: RawGoogleDriveFile): StudioDocumentMeta {
  const props = file.appProperties || {};
  const nowIso = new Date().toISOString();
  const createdIso = file.createdTime || file.modifiedTime || nowIso;
  const updatedIso = file.modifiedTime || createdIso;
  const parsedPages = Math.max(1, Number(props.pageCount || 1) || 1);
  const parsedSize = Math.max(0, Number(file.size || 0) || 0);

  return {
    id: props.localDocId || `drive_${file.id}`,
    title: ensurePdfExtension(file.name || 'Untitled.pdf'),
    pageCount: parsedPages,
    fileSizeBytes: parsedSize,
    chunkCount: 0,
    watermarkRemoved: props.watermarkRemoved === 'true',
    annotations: [],
    aiSummary: '',
    starred: props.starred === 'true',
    storageLocation: 'cloud',
    driveFileId: file.id,
    driveWebViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    createdAtIso: createdIso,
    updatedAtIso: updatedIso,
  };
}

export interface MarkupRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

/**
 * Resolves user pointer gestures (single tap/click, single-line horizontal sweep,
 * multi-line text drag, or freeform area drag) into clean normalized highlight/underline/strike boxes.
 */
export function resolveTextMarkupBounds(
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageSpans: ExtractedTextSpan[]
): MarkupRect[] {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  const horizontalSpans = pageSpans.filter(
    (s) => s.str.trim().length > 0 && Math.abs(s.angleDeg || 0) < 8
  );

  // 1. Single Click / Tap: highlight the exact text span under the pointer (or place a clean marker dab on scanned pages)
  if (dx < 0.012 && dy < 0.01) {
    const padX = 0.008;
    const padY = 0.006;
    const hitSpan = horizontalSpans.find(
      (s) =>
        start.x >= s.x - padX &&
        start.x <= s.x + s.width + padX &&
        start.y >= s.y - padY &&
        start.y <= s.y + Math.max(0.016, s.height) + padY
    );

    if (hitSpan) {
      return [
        {
          x: Math.max(0, hitSpan.x - 0.002),
          y: Math.max(0, hitSpan.y - 0.002),
          width: Math.min(1 - hitSpan.x, Math.max(0.02, hitSpan.width + 0.004)),
          height: Math.max(0.018, hitSpan.height + 0.004),
          text: hitSpan.str,
        },
      ];
    }

    // Fallback when clicking a scanned PDF / image region with no embedded text spans
    const dabW = 0.14;
    const dabH = 0.022;
    return [
      {
        x: Math.max(0, Math.min(1 - dabW, start.x - dabW / 2)),
        y: Math.max(0, Math.min(1 - dabH, start.y - dabH / 2)),
        width: dabW,
        height: dabH,
      },
    ];
  }

  // 2. Drag / Sweep gesture: check if gesture intersects embedded PDF text spans
  const verticalPad = dy < 0.015 ? 0.007 : 0.003;
  const overlappingSpans = horizontalSpans.filter((s) => {
    const spanTop = s.y;
    const spanBottom = s.y + Math.max(0.016, s.height);
    const spanCenterY = (spanTop + spanBottom) / 2;
    const spanLeft = s.x;
    const spanRight = s.x + s.width;

    const overlapsY =
      (spanCenterY >= minY - verticalPad && spanCenterY <= maxY + verticalPad) ||
      (minY >= spanTop - verticalPad && maxY <= spanBottom + verticalPad);
    const overlapsX = maxX >= spanLeft + 0.003 && minX <= spanRight - 0.003;
    return overlapsY && overlapsX;
  });

  if (overlappingSpans.length > 0) {
    // Group overlapping spans into visual text lines by Y proximity
    const sortedByY = [...overlappingSpans].sort((a, b) => a.y - b.y || a.x - b.x);
    const lineGroups: ExtractedTextSpan[][] = [];

    for (const sp of sortedByY) {
      const lastGroup = lineGroups[lineGroups.length - 1];
      if (!lastGroup) {
        lineGroups.push([sp]);
      } else {
        const refY = lastGroup[0].y;
        const tol = Math.max(0.01, lastGroup[0].height * 0.65);
        if (Math.abs(sp.y - refY) <= tol) {
          lastGroup.push(sp);
        } else {
          lineGroups.push([sp]);
        }
      }
    }

    // Single-line sweep: snap Y and height to the exact text line while preserving user's exact horizontal X sweep!
    if (lineGroups.length === 1) {
      const group = lineGroups[0];
      const lineTop = Math.min(...group.map((g) => g.y));
      const lineBottom = Math.max(...group.map((g) => g.y + Math.max(0.016, g.height)));
      const spanMinX = Math.min(...group.map((g) => g.x));
      const spanMaxX = Math.max(...group.map((g) => g.x + g.width));
      const clampedLeft = Math.max(spanMinX - 0.003, minX);
      const clampedRight = Math.min(spanMaxX + 0.003, maxX);
      const finalLeft = clampedRight - clampedLeft >= 0.012 ? clampedLeft : minX;
      const finalWidth =
        clampedRight - clampedLeft >= 0.012
          ? clampedRight - clampedLeft
          : Math.max(0.02, dx);

      return [
        {
          x: Math.max(0, finalLeft),
          y: Math.max(0, lineTop - 0.002),
          width: Math.min(1 - finalLeft, finalWidth),
          height: Math.max(0.018, lineBottom - lineTop + 0.004),
          text: group.map((g) => g.str).join(' '),
        },
      ];
    }

    // Multi-line text selection: produce crisp per-line highlight bands
    return lineGroups.map((group, idx) => {
      const lineTop = Math.min(...group.map((g) => g.y));
      const lineBottom = Math.max(...group.map((g) => g.y + Math.max(0.016, g.height)));
      const groupMinX = Math.min(...group.map((g) => g.x));
      const groupMaxX = Math.max(...group.map((g) => g.x + g.width));

      const left = idx === 0 ? Math.max(groupMinX, minX) : groupMinX;
      const right =
        idx === lineGroups.length - 1 ? Math.min(groupMaxX, maxX) : groupMaxX;
      const safeLeft = right > left + 0.01 ? left : groupMinX;
      const safeRight = right > left + 0.01 ? right : groupMaxX;

      return {
        x: Math.max(0, safeLeft - 0.002),
        y: Math.max(0, lineTop - 0.002),
        width: Math.min(1 - safeLeft, Math.max(0.02, safeRight - safeLeft + 0.004)),
        height: Math.max(0.018, lineBottom - lineTop + 0.004),
        text: group.map((g) => g.str).join(' '),
      };
    });
  }

  // 3. Freeform drag over blank area, diagram, or scanned PDF image
  const fallbackH = Math.max(0.02, dy);
  const adjustedY = dy < 0.012 ? Math.max(0, minY - fallbackH / 2) : minY;
  return [
    {
      x: minX,
      y: adjustedY,
      width: Math.max(0.02, dx),
      height: fallbackH,
    },
  ];
}

/**
 * Inspects the first 1024 bytes for the ISO 32000-1 `%PDF-` signature and strips any
 * leading BOM, portal whitespace, or wrapper bytes so non-standard / WhatsApp / portal PDFs open cleanly.
 */
export function normalizePdfBinaryBytes(rawBytes: Uint8Array): {
  bytes: Uint8Array;
  isPdf: boolean;
  headerOffset: number;
} {
  if (!rawBytes || rawBytes.byteLength < 5) {
    return { bytes: rawBytes, isPdf: false, headerOffset: -1 };
  }

  const maxScan = Math.min(rawBytes.byteLength - 5, 1024);
  for (let i = 0; i <= maxScan; i++) {
    if (
      rawBytes[i] === 0x25 && // '%'
      rawBytes[i + 1] === 0x50 && // 'P'
      rawBytes[i + 2] === 0x44 && // 'D'
      rawBytes[i + 3] === 0x46 && // 'F'
      rawBytes[i + 4] === 0x2d // '-'
    ) {
      if (i === 0) {
        return { bytes: rawBytes, isPdf: true, headerOffset: 0 };
      }
      return {
        bytes: rawBytes.slice(i),
        isPdf: true,
        headerOffset: i,
      };
    }
  }

  return { bytes: rawBytes, isPdf: false, headerOffset: -1 };
}

/**
 * Builds trailing-slash-qualified asset factory URLs required by PDF.js v6 for:
 * - QCMS WebAssembly ICC color management + OpenJPEG (JPEG2000) + JBIG2 decoders (`wasmUrl`)
 * - CMYK SWOP / CGATS ICC color profile (`iccUrl`)
 * - Packed Adobe CMaps for CID / multi-language / symbol fonts (`cMapUrl`)
 * - Standard 14 PDF fallback fonts (`standardFontDataUrl`)
 */
export function buildPdfEngineAssetUrls(originBaseUrl: string): {
  wasmUrl: string;
  iccUrl: string;
  cMapUrl: string;
  standardFontDataUrl: string;
} {
  const cleanBase = (originBaseUrl || '/').replace(/\/+$/, '') + '/';
  return {
    wasmUrl: `${cleanBase}pdfjs/wasm/`,
    iccUrl: `${cleanBase}pdfjs/iccs/`,
    cMapUrl: `${cleanBase}pdfjs/cmaps/`,
    standardFontDataUrl: `${cleanBase}pdfjs/standard_fonts/`,
  };
}

/**
 * Computes an ultra-crisp HiDPI canvas render scale (>= 2x supersampling even on 1x displays)
 * while clamping maximum canvas dimensions (<= 8192px) and pixel area (<= 20M px) so massive
 * CorelDRAW banners, A0 CAD blueprints, and poster PDFs never exceed browser canvas memory limits.
 */
export function computeSafeCanvasRenderScale(
  baseWidthPt: number,
  baseHeightPt: number,
  zoomScale: number,
  devicePixelRatio: number
): number {
  const safeW = Math.max(1, baseWidthPt || 612);
  const safeH = Math.max(1, baseHeightPt || 792);
  const safeZoom = Math.max(0.25, zoomScale || 1);
  const hiDpiMultiplier = Math.min(3, Math.max(2, devicePixelRatio || 1));

  let scale = safeZoom * hiDpiMultiplier;

  const MAX_CANVAS_DIM_PX = 8192;
  const MAX_CANVAS_AREA_PX = 20_000_000;

  const maxScaleByWidth = MAX_CANVAS_DIM_PX / safeW;
  const maxScaleByHeight = MAX_CANVAS_DIM_PX / safeH;
  const maxScaleByArea = Math.sqrt(MAX_CANVAS_AREA_PX / (safeW * safeH));

  scale = Math.min(scale, maxScaleByWidth, maxScaleByHeight, maxScaleByArea);
  return Math.max(0.2, Number(scale.toFixed(4)));
}



