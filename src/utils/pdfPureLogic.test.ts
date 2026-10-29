import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvFromPages,
  buildGoogleDriveMultipartBody,
  buildHtmlFromPages,
  buildMarkdownFromPages,
  buildPdfEngineAssetUrls,
  chunkBase64String,
  computeSafeCanvasRenderScale,
  detectWatermarkCandidates,
  ensurePdfExtension,
  extractCitedPageNumbers,
  findGlobalSearchMatches,
  formatFileSize,
  mapGoogleDriveFileToMeta,
  normalizePdfBinaryBytes,
  parsePageRange,
  reassembleBase64Chunks,
  resolveTextMarkupBounds,
  sanitizeDocumentPayload,
} from './pdfPureLogic';
import { PageTextData } from '../types/pdfStudio';

test('parsePageRange handles blank, single pages, and complex ranges accurately', () => {
  assert.deepEqual(parsePageRange('', 5), { pages: [1, 2, 3, 4, 5], error: null });
  assert.deepEqual(parsePageRange('all', 3), { pages: [1, 2, 3], error: null });
  assert.deepEqual(parsePageRange('1-3, 5, 2', 6), { pages: [1, 2, 3, 5], error: null });

  const outOfBounds = parsePageRange('1-8', 5);
  assert.equal(outOfBounds.pages.length, 0);
  assert.ok(outOfBounds.error?.includes('exceeds document length'));

  const reversed = parsePageRange('4-2', 5);
  assert.ok(reversed.error !== null);
});

test('detectWatermarkCandidates identifies diagonal and multi-page watermarks while ignoring page numbers', () => {
  const samplePages: PageTextData[] = [1, 2, 3].map((pageNum) => ({
    pageNumber: pageNum,
    widthPt: 612,
    heightPt: 792,
    text: `Enterprise Report\nCONFIDENTIAL - DRAFT COPY\nPage ${pageNum}`,
    spans: [
      {
        id: `p${pageNum}_1`,
        pageNumber: pageNum,
        str: 'Enterprise Architecture Overview',
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.03,
        fontSize: 16,
        angleDeg: 0,
      },
      {
        id: `p${pageNum}_wm`,
        pageNumber: pageNum,
        str: 'CONFIDENTIAL - DRAFT COPY',
        x: 0.18,
        y: 0.48,
        width: 0.65,
        height: 0.08,
        fontSize: 38,
        angleDeg: 38,
      },
      {
        id: `p${pageNum}_prose`,
        pageNumber: pageNum,
        str: 'Draft proposals carry review watermarks before external release.',
        x: 0.1,
        y: 0.35,
        width: 0.7,
        height: 0.02,
        fontSize: 10.5,
        angleDeg: 0,
      },
      {
        id: `p${pageNum}_num`,
        pageNumber: pageNum,
        str: `Page ${pageNum}`,
        x: 0.45,
        y: 0.94,
        width: 0.1,
        height: 0.02,
        fontSize: 10,
        angleDeg: 0,
      },
    ],
  }));

  const candidates = detectWatermarkCandidates(samplePages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].text, 'CONFIDENTIAL - DRAFT COPY');
  assert.equal(candidates[0].isDiagonal, true);
  assert.equal(candidates[0].confidence, 'high');
  assert.deepEqual(candidates[0].pagesAffected, [1, 2, 3]);
});

test('chunkBase64String and reassembleBase64Chunks round-trip accurately regardless of order', () => {
  const payload = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(25);
  const chunks = chunkBase64String(payload, 120);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.length <= 120));

  const shuffled = chunks
    .map((data, index) => ({ index, data }))
    .reverse();
  assert.equal(reassembleBase64Chunks(shuffled), payload);
});

test('sanitizeDocumentPayload enforces firebase-blueprint.json bounds strictly', () => {
  const sanitized = sanitizeDocumentPayload({
    ownerId: 'user_123$bad!',
    title: 'X'.repeat(500),
    pageCount: 0,
    fileSizeBytes: 1024,
    chunkCount: 99,
    watermarkRemoved: true,
    annotations: [],
    aiSummary: 'S'.repeat(50000),
    starred: false,
  });

  assert.equal(sanitized.ownerId, 'user_123bad');
  assert.equal(sanitized.title.length, 240);
  assert.equal(sanitized.pageCount, 1);
  assert.equal(sanitized.chunkCount, 25);
  assert.equal(sanitized.aiSummary.length, 40000);
  assert.equal(sanitized.annotationsPayload, '[]');
});

test('Markdown, HTML, and CSV builders produce valid structured exports', () => {
  const pages: PageTextData[] = [
    {
      pageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      text: 'Quarterly Revenue Summary\n\nNorth America grew by 24% YoY.',
      spans: [
        { id: '1', pageNumber: 1, str: 'Region', x: 0.1, y: 0.2, width: 0.2, height: 0.02, fontSize: 12, angleDeg: 0 },
        { id: '2', pageNumber: 1, str: 'Revenue', x: 0.4, y: 0.2, width: 0.2, height: 0.02, fontSize: 12, angleDeg: 0 },
        { id: '3', pageNumber: 1, str: 'APAC', x: 0.1, y: 0.25, width: 0.2, height: 0.02, fontSize: 12, angleDeg: 0 },
        { id: '4', pageNumber: 1, str: '$4.2M', x: 0.4, y: 0.25, width: 0.2, height: 0.02, fontSize: 12, angleDeg: 0 },
      ],
    },
  ];

  const md = buildMarkdownFromPages('Finance.pdf', pages);
  assert.ok(md.includes('# Finance'));
  assert.ok(md.includes('## Quarterly Revenue Summary'));

  const html = buildHtmlFromPages('Finance.pdf', pages);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('North America grew by 24% YoY.'));

  const csv = buildCsvFromPages(pages);
  assert.ok(csv.includes('"Region","Revenue"'));
  assert.ok(csv.includes('"APAC","$4.2M"'));
  assert.equal(formatFileSize(1572864), '1.50 MB');
});

test('findGlobalSearchMatches locates multi-page and multi-occurrence hits with accurate sub-span bounds', () => {
  const pages: PageTextData[] = [
    {
      pageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      text: 'Cloud architecture and cloud security controls.',
      spans: [
        {
          id: 's1',
          pageNumber: 1,
          str: 'Cloud architecture and cloud security',
          x: 0.1,
          y: 0.2,
          width: 0.74,
          height: 0.025,
          fontSize: 12,
          angleDeg: 0,
        },
      ],
    },
    {
      pageNumber: 2,
      widthPt: 612,
      heightPt: 792,
      text: 'Hybrid Cloud Vault deployment.',
      spans: [
        {
          id: 's2',
          pageNumber: 2,
          str: 'Hybrid Cloud Vault deployment',
          x: 0.12,
          y: 0.35,
          width: 0.58,
          height: 0.025,
          fontSize: 12,
          angleDeg: 0,
        },
      ],
    },
  ];

  assert.equal(findGlobalSearchMatches(pages, '   ').length, 0);

  const insensitive = findGlobalSearchMatches(pages, 'cloud');
  assert.equal(insensitive.length, 3);
  assert.equal(insensitive[0].pageNumber, 1);
  assert.equal(insensitive[0].matchedText, 'Cloud');
  assert.equal(insensitive[1].pageNumber, 1);
  assert.equal(insensitive[1].matchedText, 'cloud');
  assert.ok(insensitive[1].x > insensitive[0].x);
  assert.equal(insensitive[2].pageNumber, 2);

  const sensitive = findGlobalSearchMatches(pages, 'Cloud', { caseSensitive: true });
  assert.equal(sensitive.length, 2);
  assert.deepEqual(
    sensitive.map((m) => m.pageNumber),
    [1, 2]
  );

  const wholeWordNoPartial = findGlobalSearchMatches(pages, 'arch', { wholeWord: true });
  assert.equal(wholeWordNoPartial.length, 0);
});

test('extractCitedPageNumbers parses inline page references within document bounds', () => {
  const sample = 'Budget figures appear on Page 1 and p. 3, while audit terms are on Pages 2, 4 (not Page 99).';
  assert.deepEqual(extractCitedPageNumbers(sample, 4), [1, 2, 3, 4]);
});

test('buildGoogleDriveMultipartBody and mapGoogleDriveFileToMeta preserve binary PDF bytes and metadata', () => {
  assert.equal(ensurePdfExtension('Quarterly_Report'), 'Quarterly_Report.pdf');
  assert.equal(ensurePdfExtension('Invoice.PDF'), 'Invoice.PDF');

  const rawPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0xff, 0x00]);
  const { body, contentType } = buildGoogleDriveMultipartBody(
    { name: 'Report.pdf', mimeType: 'application/pdf' },
    rawPdf,
    'test_boundary_123'
  );

  assert.equal(contentType, 'multipart/related; boundary=test_boundary_123');
  const decodedText = new TextDecoder('latin1').decode(body);
  assert.ok(decodedText.startsWith('--test_boundary_123\r\nContent-Type: application/json; charset=UTF-8'));
  assert.ok(decodedText.includes('"name":"Report.pdf"'));
  assert.ok(decodedText.includes('%PDF-1.7'));
  assert.ok(decodedText.endsWith('\r\n--test_boundary_123--'));

  const mapped = mapGoogleDriveFileToMeta({
    id: '1AbCdEfGhIj',
    name: 'Saved_Contract',
    size: '48120',
    modifiedTime: '2026-10-29T15:00:00.000Z',
    appProperties: {
      localDocId: 'doc_local_99',
      pageCount: '6',
      watermarkRemoved: 'true',
      starred: 'true',
    },
  });

  assert.equal(mapped.id, 'doc_local_99');
  assert.equal(mapped.driveFileId, '1AbCdEfGhIj');
  assert.equal(mapped.title, 'Saved_Contract.pdf');
  assert.equal(mapped.pageCount, 6);
  assert.equal(mapped.fileSizeBytes, 48120);
  assert.equal(mapped.watermarkRemoved, true);
  assert.equal(mapped.starred, true);
});

test('localDocumentIntelligence answers Hinglish & English PDF questions, summarizes, and formats OCR text offline', async () => {
  const {
    answerPdfQuestionLocally,
    detectQueryLanguage,
    formatOcrTextByMode,
    rewriteTextLocally,
    summarizePdfLocally,
  } = await import('./localDocumentIntelligence');

  assert.equal(detectQueryLanguage('Is PDF me main deadlines aur security rules kya hain?'), 'hinglish');
  assert.equal(detectQueryLanguage('इस दस्तावेज़ का बजट क्या है?'), 'hindi');
  assert.equal(detectQueryLanguage('What is the total budget allocation?'), 'english');

  const samplePages = [
    {
      pageNumber: 1,
      text: 'Project Horizon Architecture\nCore Infrastructure Allocation: $1,200,000\nZero-Trust Security Migration: $650,000',
    },
    {
      pageNumber: 2,
      text: 'Service Level Objectives & Security Controls\nAvailability Target: 99.99% uptime SLA across regions.\nAll storage buckets must enforce AES-256 encryption before Q3 2026.',
    },
  ];

  const qa = answerPdfQuestionLocally({
    documentTitle: 'Project_Horizon.pdf',
    pagesText: samplePages,
    activePage: 1,
    question: 'Is PDF me security encryption aur SLA target kya hai?',
  });

  assert.ok(qa.answer.includes('AES-256') || qa.answer.includes('99.99%'));
  assert.ok(qa.citedPages.includes(2));
  assert.equal(qa.followUpQuestions.length, 2);

  const budgetQa = answerPdfQuestionLocally({
    documentTitle: 'Project_Horizon.pdf',
    pagesText: samplePages,
    activePage: 1,
    question: 'What is the total budget allocation across workstreams?',
  });
  assert.ok(budgetQa.answer.includes('$1.85M') || budgetQa.answer.includes('1,850,000'));
  assert.ok(budgetQa.citedPages.includes(1));

  const summary = summarizePdfLocally({
    documentTitle: 'Project_Horizon.pdf',
    pagesText: samplePages,
    language: 'hinglish',
    mode: 'executive',
  });
  assert.ok(summary.headline.includes('Project Horizon'));
  assert.ok(summary.keyTakeaways.length >= 2);
  assert.equal(summary.pageHighlights.length, 2);

  const ocrFormatted = formatOcrTextByMode(
    'INVOICE #INV-2026-884\nItem   Qty   Amount\nAmount Due: $14,250.00 USD',
    'structured'
  );
  assert.equal(ocrFormatted.documentType, 'Invoice / Billing Statement');
  assert.ok(ocrFormatted.extractedText.includes('## INVOICE #INV-2026-884'));
  assert.ok(ocrFormatted.extractedText.includes('|'));

  const rewritten = rewriteTextLocally(
    "we don't need to utilize complex tools in order to recieve fast results",
    'formal'
  );
  assert.ok(rewritten.revisedText.includes('do not'));
  assert.ok(rewritten.revisedText.includes('receive'));
});

test('resolveTextMarkupBounds snaps single clicks, 0-height horizontal sweeps, and multi-line drags to PDF text spans', () => {
  const sampleSpans = [
    {
      id: 'line_1',
      pageNumber: 1,
      str: '1. Executive Summary',
      x: 0.1,
      y: 0.2,
      width: 0.35,
      height: 0.024,
      fontSize: 14,
      angleDeg: 0,
    },
    {
      id: 'line_2',
      pageNumber: 1,
      str: 'Project Horizon establishes a unified document pipeline.',
      x: 0.1,
      y: 0.24,
      width: 0.65,
      height: 0.02,
      fontSize: 11,
      angleDeg: 0,
    },
  ];

  // 1. Single click on heading highlights the entire heading span cleanly
  const singleClick = resolveTextMarkupBounds({ x: 0.18, y: 0.21 }, { x: 0.18, y: 0.21 }, sampleSpans);
  assert.equal(singleClick.length, 1);
  assert.equal(singleClick[0].text, '1. Executive Summary');
  assert.ok(singleClick[0].width >= 0.35);
  assert.ok(singleClick[0].height >= 0.024);

  // 2. Horizontal sweep with zero vertical movement (dy = 0) snaps to line height
  const horizontalSweep = resolveTextMarkupBounds({ x: 0.15, y: 0.25 }, { x: 0.45, y: 0.25 }, sampleSpans);
  assert.equal(horizontalSweep.length, 1);
  assert.ok(Math.abs(horizontalSweep[0].x - 0.15) < 0.005);
  assert.ok(Math.abs(horizontalSweep[0].width - 0.3) < 0.01);
  assert.ok(horizontalSweep[0].height >= 0.02);

  // 3. Multi-line drag produces 2 clean per-line highlight bands
  const multiLine = resolveTextMarkupBounds({ x: 0.12, y: 0.205 }, { x: 0.55, y: 0.255 }, sampleSpans);
  assert.equal(multiLine.length, 2);

  // 4. Scanned PDF with zero spans still creates a visible marker band on click or drag
  const scannedClick = resolveTextMarkupBounds({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, []);
  assert.equal(scannedClick.length, 1);
  assert.ok(scannedClick[0].width >= 0.12);
  assert.ok(scannedClick[0].height >= 0.02);
});

test('normalizePdfBinaryBytes, buildPdfEngineAssetUrls, and computeSafeCanvasRenderScale handle complex PDFs safely', () => {
  // 1. Clean PDF header at byte 0
  const cleanPdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
  const normClean = normalizePdfBinaryBytes(cleanPdf);
  assert.equal(normClean.isPdf, true);
  assert.equal(normClean.headerOffset, 0);
  assert.equal(normClean.bytes.byteLength, cleanPdf.byteLength);

  // 2. Portal / WhatsApp PDF with leading UTF-8 BOM + whitespace before %PDF-1.4
  const prefixed = new Uint8Array([0xef, 0xbb, 0xbf, 0x0d, 0x0a, ...cleanPdf]);
  const normPrefixed = normalizePdfBinaryBytes(prefixed);
  assert.equal(normPrefixed.isPdf, true);
  assert.equal(normPrefixed.headerOffset, 5);
  assert.equal(new TextDecoder().decode(normPrefixed.bytes.slice(0, 8)), '%PDF-1.7');

  // 3. Non-PDF PNG image bytes
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(normalizePdfBinaryBytes(pngBytes).isPdf, false);

  // 4. Engine asset URLs always include trailing slashes required by PDF.js v6
  const urls = buildPdfEngineAssetUrls('https://example.vercel.app');
  assert.equal(urls.wasmUrl, 'https://example.vercel.app/pdfjs/wasm/');
  assert.equal(urls.iccUrl, 'https://example.vercel.app/pdfjs/iccs/');
  assert.equal(urls.cMapUrl, 'https://example.vercel.app/pdfjs/cmaps/');
  assert.equal(urls.standardFontDataUrl, 'https://example.vercel.app/pdfjs/standard_fonts/');

  // 5. Standard A4/Letter page on 1x monitor gets >= 2x HiDPI supersampling for crisp graphics
  const crispScale = computeSafeCanvasRenderScale(612, 792, 1.1, 1);
  assert.equal(crispScale, 2.2);

  // 6. Massive 5000x4000pt flex banner / CAD blueprint clamps safely within browser canvas limits
  const bannerScale = computeSafeCanvasRenderScale(5000, 4000, 2.0, 2);
  assert.ok(5000 * bannerScale <= 8192);
  assert.ok(4000 * bannerScale <= 8192);
  assert.ok(5000 * bannerScale * (4000 * bannerScale) <= 20_000_001);
});




