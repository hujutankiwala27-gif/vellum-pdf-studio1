import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  BlendMode,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import {
  ExtractedTextSpan,
  PageTextData,
  PdfAnnotation,
} from '../types/pdfStudio';
import {
  buildPdfEngineAssetUrls,
  normalizePdfBinaryBytes,
} from './pdfPureLogic';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

function resolveBrowserOriginBaseUrl(): string | null {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return null;
  }
  const viteBase =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/';
  try {
    return new URL(viteBase, window.location.origin).href;
  } catch {
    return `${window.location.origin}/`;
  }
}

export async function loadPdfProxy(
  bytes: Uint8Array,
  password?: string
): Promise<pdfjsLib.PDFDocumentProxy> {
  const normalized = normalizePdfBinaryBytes(bytes);
  const sourceBytes = normalized.isPdf ? normalized.bytes : bytes;

  // Always pass a fresh copy so PDF.js worker transfer never detaches the caller's Uint8Array
  const cloned = new Uint8Array(sourceBytes.length);
  cloned.set(sourceBytes);

  const originBase = resolveBrowserOriginBaseUrl();
  const assetUrls = originBase ? buildPdfEngineAssetUrls(originBase) : {};

  const loadingTask = pdfjsLib.getDocument({
    data: cloned,
    password: password || undefined,
    enableXfa: true,
    useWasm: true,
    useSystemFonts: true,
    cMapPacked: true,
    stopAtErrors: false,
    maxImageSize: -1,
    canvasMaxAreaInBytes: -1,
    ...assetUrls,
  });
  return loadingTask.promise;
}

/**
 * Renders a PDF page onto a pristine untouched offscreen staging canvas first so PDF.js v6
 * initializes its native `{ alpha: false, willReadFrequently: true }` pixel pipeline for exact
 * ICC/CMYK color management, luminosity soft masks, mesh gradients, and AcroForm/stamp appearances,
 * then atomically blits the finished frame onto `targetCanvas` with zero flicker or canvas lock conflicts.
 */
export function startCrispPdfPageRender(
  page: pdfjsLib.PDFPageProxy,
  targetCanvas: HTMLCanvasElement,
  viewport: pdfjsLib.PageViewport
): { promise: Promise<void>; cancel: () => void } {
  const pixelWidth = Math.max(1, Math.ceil(viewport.width));
  const pixelHeight = Math.max(1, Math.ceil(viewport.height));

  const stagingCanvas = document.createElement('canvas');
  stagingCanvas.width = pixelWidth;
  stagingCanvas.height = pixelHeight;

  let cancelled = false;
  const renderTask = page.render({
    canvas: stagingCanvas,
    viewport,
    intent: 'display',
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
    background: 'rgb(255,255,255)',
  });

  const promise = renderTask.promise.then(() => {
    if (cancelled) return;
    targetCanvas.width = pixelWidth;
    targetCanvas.height = pixelHeight;

    let outCtx: CanvasRenderingContext2D | null = null;
    try {
      outCtx = targetCanvas.getContext('2d', {
        alpha: false,
        colorSpace: 'srgb',
      });
    } catch {
      outCtx = targetCanvas.getContext('2d', { alpha: false });
    }
    if (!outCtx) {
      outCtx = targetCanvas.getContext('2d');
    }
    if (!outCtx) return;

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(stagingCanvas, 0, 0, pixelWidth, pixelHeight);
    // Release staging backing memory immediately after blit
    stagingCanvas.width = 0;
    stagingCanvas.height = 0;
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        renderTask.cancel();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Extracts text spans and normalized bounding coordinates (accounting for CropBox offsets
 * and 0/90/180/270 page rotations via `pdfjsLib.Util.transform`) in parallel batches.
 */
export async function extractPagesTextData(
  pdfProxy: pdfjsLib.PDFDocumentProxy,
  pageNumbers?: number[]
): Promise<PageTextData[]> {
  const total = pdfProxy.numPages;
  const targets =
    pageNumbers && pageNumbers.length > 0
      ? pageNumbers.filter((n) => n >= 1 && n <= total)
      : Array.from({ length: Math.min(total, 120) }, (_, i) => i + 1);

  const results: PageTextData[] = [];
  const batchSize = 8;

  for (let i = 0; i < targets.length; i += batchSize) {
    const slice = targets.slice(i, i + batchSize);
    const batchData = await Promise.all(
      slice.map(async (pageNum) => {
        const page = await pdfProxy.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const spans: ExtractedTextSpan[] = [];
        const linePieces: { y: number; x: number; str: string }[] = [];

        textContent.items.forEach((rawItem, idx) => {
          if (!('str' in rawItem) || !rawItem.str) return;
          // Transform from PDF user space (accounting for CropBox & page rotation) into top-left viewport space
          const combinedTx = pdfjsLib.Util.transform(viewport.transform, rawItem.transform);
          const fontHeightPx = Math.hypot(combinedTx[2], combinedTx[3]) || Math.hypot(combinedTx[0], combinedTx[1]) || 11;
          const angleRad = Math.atan2(-combinedTx[1], combinedTx[0]);
          const angleDeg = (angleRad * 180) / Math.PI;

          const vx = combinedTx[4];
          const vy = combinedTx[5];
          const itemWidthPt = rawItem.width || rawItem.str.length * fontHeightPx * 0.52;
          const itemHeightPt = rawItem.height || fontHeightPx * 1.18;

          const normX = Math.max(0, Math.min(0.98, vx / viewport.width));
          const normY = Math.max(
            0,
            Math.min(0.98, (vy - itemHeightPt * 0.84) / viewport.height)
          );
          const normW = Math.min(1 - normX, Math.max(0.02, itemWidthPt / viewport.width));
          const normH = Math.min(1 - normY, Math.max(0.014, itemHeightPt / viewport.height));

          spans.push({
            id: `span_${pageNum}_${idx}`,
            pageNumber: pageNum,
            str: rawItem.str,
            x: normX,
            y: normY,
            width: normW,
            height: normH,
            fontSize: fontHeightPx,
            angleDeg,
          });

          linePieces.push({
            y: Math.round(vy / 6) * 6,
            x: vx,
            str: rawItem.str,
          });
        });

        // Sort reading order top-to-bottom, left-to-right
        linePieces.sort((a, b) => (Math.abs(a.y - b.y) <= 6 ? a.x - b.x : a.y - b.y));
        const lines: string[] = [];
        let lastY: number | null = null;
        let currentLine = '';

        for (const piece of linePieces) {
          if (lastY === null || Math.abs(piece.y - lastY) <= 6) {
            currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + piece.str;
          } else {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = piece.str;
          }
          lastY = piece.y;
        }
        if (currentLine.trim()) lines.push(currentLine.trim());

        return {
          pageNumber: pageNum,
          widthPt: viewport.width,
          heightPt: viewport.height,
          text: lines.join('\n'),
          spans,
        };
      })
    );
    results.push(...batchData);
  }

  return results;
}

/**
 * Helper to decode PDF raw stream bytes (handles uncompressed & browser DecompressionStream('deflate'))
 */
async function decodePdfStreamText(rawBytes: Uint8Array, isFlate: boolean): Promise<string> {
  if (!isFlate) {
    return new TextDecoder('latin1').decode(rawBytes);
  }
  if (typeof DecompressionStream !== 'undefined') {
    for (const fmt of ['deflate', 'deflate-raw'] as const) {
      try {
        const ds = new DecompressionStream(fmt);
        const writer = ds.writable.getWriter();
        writer.write(rawBytes.slice());
        writer.close();
        const outBuf = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder('latin1').decode(new Uint8Array(outBuf));
      } catch {
        // try next deflate format
      }
    }
  }
  return new TextDecoder('latin1').decode(rawBytes);
}

function stringToHexPattern(text: string): string {
  return Array.from(text)
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}

/**
 * Removes watermarks from a PDF binary via 3 complementary mechanisms:
 * 1. Separate Content-Stream Removal: Detects overlaid PDF streams containing watermark artifacts,
 *    rotated single-phrase overlays, or matching watermark text (ASCII or hex-encoded) and detaches
 *    only that stream ref so underlying text/tables remain 100% intact.
 * 2. Inline Content-Stream Scrubbing: Strips `/Artifact ... /Watermark ... BDC ... EMC` and literal
 *    `(TargetWatermark) Tj` blocks inside single-stream PDFs.
 * 3. Coordinate Scrub Fallback: If a single-stream compressed font encoded watermark still remains,
 *    applies clean paper-white vector masks over non-overlapping watermark bounds or user-drawn masks.
 */
export async function removeWatermarksFromPdfBytes(
  pdfBytes: Uint8Array,
  targetWatermarkTexts: string[],
  existingPagesData: PageTextData[]
): Promise<{ cleanedBytes: Uint8Array; removedStreamsCount: number }> {
  const pdfDoc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  let removedStreamsCount = 0;

  const normalizedTargets = targetWatermarkTexts
    .map((t) => t.trim())
    .filter(Boolean);
  const hexTargets = normalizedTargets.map((t) => ({
    rawLower: t.toLowerCase(),
    hexLower: stringToHexPattern(t),
  }));

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const contentsEntry = page.node.get(PDFName.of('Contents'));

    if (contentsEntry instanceof PDFArray && contentsEntry.size() > 1) {
      const keptRefs: PDFRef[] = [];
      const totalStreams = contentsEntry.size();

      for (let sIdx = 0; sIdx < totalStreams; sIdx++) {
        const item = contentsEntry.get(sIdx);
        const lookedUp = pdfDoc.context.lookup(item);

        if (lookedUp instanceof PDFRawStream) {
          const filterObj = lookedUp.dict.get(PDFName.of('Filter'));
          const filterStr = filterObj ? filterObj.toString() : '';
          const isFlate = filterStr.includes('FlateDecode');
          const decoded = await decodePdfStreamText(lookedUp.contents, isFlate);
          const decodedLower = decoded.toLowerCase();

          const hasWatermarkTag =
            decoded.includes('/Watermark') || decodedLower.includes('watermark');
          const matchesTargetText = hexTargets.some(
            (t) =>
              decodedLower.includes(t.rawLower) ||
              (t.hexLower.length >= 6 && decodedLower.includes(t.hexLower))
          );

          // Check if this overlaid stream (typically the last stream appended to the page)
          // is a small standalone rotated overlay stamp (< 1400 chars with rotation matrix + single Tj/TJ)
          const tjMatches = decoded.match(/\bT[jJ]\b/g) || [];
          const isAppendedOverlayStamp =
            sIdx === totalStreams - 1 &&
            decoded.length < 1800 &&
            tjMatches.length >= 1 &&
            tjMatches.length <= 3 &&
            /\s-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+cm/.test(
              decoded
            );

          if (hasWatermarkTag || matchesTargetText || (normalizedTargets.length > 0 && isAppendedOverlayStamp)) {
            removedStreamsCount += 1;
            continue; // Drop this watermark stream!
          }
        }

        if (item instanceof PDFRef) {
          keptRefs.push(item);
        }
      }

      if (keptRefs.length > 0 && keptRefs.length < totalStreams) {
        const newArr = pdfDoc.context.obj(keptRefs);
        page.node.set(PDFName.of('Contents'), newArr);
        continue;
      }
    }

    // Layer 2: Single-stream inline operator scrubbing
    const singleRef =
      contentsEntry instanceof PDFRef
        ? contentsEntry
        : contentsEntry instanceof PDFArray && contentsEntry.size() === 1 && contentsEntry.get(0) instanceof PDFRef
          ? (contentsEntry.get(0) as PDFRef)
          : null;

    if (singleRef) {
      const streamObj = pdfDoc.context.lookup(singleRef);
      if (streamObj instanceof PDFRawStream) {
        const filterObj = streamObj.dict.get(PDFName.of('Filter'));
        const isFlate = filterObj ? filterObj.toString().includes('FlateDecode') : false;
        const decoded = await decodePdfStreamText(streamObj.contents, isFlate);
        let scrubbed = decoded;

        // Remove /Watermark ... BDC ... EMC blocks
        scrubbed = scrubbed.replace(/\/Artifact\s*<<[^>]*\/Watermark[^>]*>>\s*BDC[\s\S]*?EMC/g, '');

        for (const t of normalizedTargets) {
          const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const literalRegex = new RegExp(`\\(${escaped}\\)\\s*Tj`, 'gi');
          scrubbed = scrubbed.replace(literalRegex, '() Tj');
          const hex = stringToHexPattern(t);
          if (hex.length >= 6) {
            const hexRegex = new RegExp(`<${hex}>\\s*Tj`, 'gi');
            scrubbed = scrubbed.replace(hexRegex, '<> Tj');
          }
        }

        if (scrubbed !== decoded) {
          const encodedBytes = new TextEncoder().encode(scrubbed);
          const replacement = pdfDoc.context.flateStream(encodedBytes);
          const newRef = pdfDoc.context.register(replacement);
          page.node.set(PDFName.of('Contents'), newRef);
          removedStreamsCount += 1;
          continue;
        }
      }
    }

    // Layer 3 Fallback: Coordinate scrub for non-angled headers/stamps if still untouched
    const pageMeta = existingPagesData.find((d) => d.pageNumber === pIdx + 1);
    if (pageMeta && normalizedTargets.length > 0) {
      const { width, height } = page.getSize();
      for (const span of pageMeta.spans) {
        const lower = span.str.trim().toLowerCase();
        if (normalizedTargets.some((t) => lower === t.toLowerCase() || lower.includes(t.toLowerCase()))) {
          const pdfX = span.x * width;
          const pdfY = height - (span.y + span.height) * height;
          page.drawRectangle({
            x: Math.max(0, pdfX - 2),
            y: Math.max(0, pdfY - 2),
            width: span.width * width + 4,
            height: span.height * height + 4,
            color: rgb(1, 1, 1),
          });
          removedStreamsCount += 1;
        }
      }
    }
  }

  const cleanedBytes = await pdfDoc.save();
  return { cleanedBytes, removedStreamsCount };
}

function hexToRgbColor(hex: string) {
  const clean = (hex || '#1D4ED8').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0.11,
    Number.isFinite(g) ? g : 0.3,
    Number.isFinite(b) ? b : 0.85
  );
}

/**
 * Bakes all Studio annotations, highlights, ink strokes, direct text edits,
 * redactions, stamps, watermark masks, and signatures into a real PDF binary.
 */
export async function bakeAnnotationsIntoPdf(
  pdfBytes: Uint8Array,
  annotations: PdfAnnotation[]
): Promise<Uint8Array> {
  const normalized = normalizePdfBinaryBytes(pdfBytes);
  const cleanSourceBytes = normalized.isPdf ? normalized.bytes : pdfBytes;

  if (annotations.length === 0) {
    return cleanSourceBytes.slice();
  }

  const pdfDoc = await PDFDocument.load(cleanSourceBytes.slice(), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  // Check whether document defines a print OutputIntent (e.g. PDF/X-4 CMYK)
  const hasOutputIntents = Boolean(pdfDoc.catalog.get(PDFName.of('OutputIntents')));

  // Expand applyToAllPages watermark masks across all pages
  const globalMasks = annotations.filter((a) => a.type === 'watermark_mask' && a.applyToAllPages);

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageNum = pIdx + 1;
    const page = pages[pIdx];
    const cropBox = page.getCropBox();
    const originX = cropBox.x || 0;
    const originY = cropBox.y || 0;
    const width = cropBox.width || page.getSize().width;
    const height = cropBox.height || page.getSize().height;

    const pageAnns = [
      ...globalMasks,
      ...annotations.filter(
        (a) => a.pageNumber === pageNum && !(a.type === 'watermark_mask' && a.applyToAllPages)
      ),
    ];

    if (
      pageAnns.length > 0 &&
      !hasOutputIntents &&
      !page.node.get(PDFName.of('Group'))
    ) {
      // Lock page transparency blending space to DeviceRGB when adding semi-transparent
      // highlights/stamps so Acrobat/PDFium never shifts page colors into uncalibrated CMYK
      const rgbTransparencyGroup = pdfDoc.context.obj({
        Type: 'Group',
        S: 'Transparency',
        CS: 'DeviceRGB',
        I: true,
      });
      page.node.set(PDFName.of('Group'), rgbTransparencyGroup);
    }

    for (const ann of pageAnns) {
      const pdfX = originX + ann.x * width;
      const boxW = Math.max(8, ann.width * width);
      const boxH = Math.max(8, ann.height * height);
      const pdfY = originY + height - ann.y * height - boxH;
      const color = hexToRgbColor(ann.color);

      if (ann.type === 'highlight') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: boxW,
          height: boxH,
          color,
          opacity: 0.48,
          blendMode: BlendMode.Multiply,
        });
      } else if (ann.type === 'underline') {
        page.drawLine({
          start: { x: pdfX, y: pdfY },
          end: { x: pdfX + boxW, y: pdfY },
          thickness: 2,
          color,
        });
      } else if (ann.type === 'strikethrough') {
        page.drawLine({
          start: { x: pdfX, y: pdfY + boxH * 0.5 },
          end: { x: pdfX + boxW, y: pdfY + boxH * 0.5 },
          thickness: 1.8,
          color,
        });
      } else if (ann.type === 'rect') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: boxW,
          height: boxH,
          borderColor: color,
          borderWidth: ann.strokeWidth || 2,
        });
      } else if (ann.type === 'redact') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: boxW,
          height: boxH,
          color: rgb(0.05, 0.07, 0.11),
        });
      } else if (ann.type === 'watermark_mask') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: boxW,
          height: boxH,
          color: rgb(1, 1, 1),
        });
      } else if (ann.type === 'ink' && ann.points && ann.points.length >= 2) {
        for (let i = 1; i < ann.points.length; i++) {
          const p0 = ann.points[i - 1];
          const p1 = ann.points[i];
          page.drawLine({
            start: { x: originX + p0.x * width, y: originY + height - p0.y * height },
            end: { x: originX + p1.x * width, y: originY + height - p1.y * height },
            thickness: ann.strokeWidth || 2.2,
            color,
          });
        }
      } else if (ann.type === 'text_edit' && ann.text !== undefined) {
        const fSize = ann.fontSize || 11;
        if (ann.coverBackground) {
          page.drawRectangle({
            x: Math.max(originX, pdfX - 2),
            y: Math.max(originY, pdfY - 2),
            width: Math.max(boxW + 6, ann.text.length * fSize * 0.54),
            height: boxH + 4,
            color: rgb(1, 1, 1),
          });
        }
        if (ann.text.trim()) {
          const lines = ann.text.split('\n');
          lines.forEach((line, lIdx) => {
            page.drawText(line, {
              x: pdfX,
              y: originY + height - ann.y * height - fSize - lIdx * (fSize * 1.25),
              size: fSize,
              font: fontRegular,
              color,
            });
          });
        }
      } else if (ann.type === 'note') {
        page.drawRectangle({
          x: pdfX,
          y: originY + height - ann.y * height - 18,
          width: 18,
          height: 18,
          color: rgb(0.96, 0.62, 0.04),
        });
        if (ann.text) {
          page.drawText(`[Note: ${ann.text.slice(0, 80)}]`, {
            x: pdfX + 22,
            y: originY + height - ann.y * height - 13,
            size: 8.5,
            font: fontBold,
            color: rgb(0.55, 0.32, 0.02),
          });
        }
      } else if (ann.type === 'stamp' && ann.text) {
        const label = ann.text.toUpperCase();
        const stampW = Math.max(95, label.length * 9 + 20);
        const stampH = 26;
        const stampY = originY + height - ann.y * height - stampH;
        page.drawRectangle({
          x: pdfX,
          y: stampY,
          width: stampW,
          height: stampH,
          borderColor: color,
          borderWidth: 2,
          color: rgb(1, 1, 1),
          opacity: 0.9,
        });
        page.drawText(label, {
          x: pdfX + 10,
          y: stampY + 8,
          size: 11,
          font: fontBold,
          color,
        });
      } else if (ann.type === 'signature' && ann.signatureDataUrl) {
        try {
          const base64Part = ann.signatureDataUrl.split(',')[1];
          const pngBytes = Uint8Array.from(atob(base64Part), (c) => c.charCodeAt(0));
          const pngImg = await pdfDoc.embedPng(pngBytes);
          page.drawImage(pngImg, {
            x: pdfX,
            y: pdfY,
            width: boxW,
            height: boxH,
          });
        } catch {
          if (ann.text) {
            page.drawText(ann.text, {
              x: pdfX,
              y: pdfY + 6,
              size: 16,
              font: fontBold,
              color,
            });
          }
        }
      }
    }
  }

  return pdfDoc.save();
}

/**
 * Page Organizer operations: reorder, rotate, duplicate, or delete pages, and merge extra PDFs.
 */
export async function applyPageOrganizerOperations(
  pdfBytes: Uint8Array,
  items: { originalPageNumber: number; rotationDeltaDeg: number }[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();

  const indices = items.map((item) => item.originalPageNumber - 1);
  const copiedPages = await outDoc.copyPages(srcDoc, indices);

  copiedPages.forEach((copied, idx) => {
    const delta = items[idx].rotationDeltaDeg || 0;
    if (delta !== 0) {
      const current = copied.getRotation().angle;
      copied.setRotation(degrees((current + delta + 360) % 360));
    }
    outDoc.addPage(copied);
  });

  return outDoc.save();
}

export async function mergePdfDocuments(chunks: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of chunks) {
    const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/**
 * Renders a specific PDF page onto an offscreen high-resolution canvas and returns a PNG data URL
 * so scanned PDF pages, tables, or diagrams can be read via Photo OCR or attached to AI Chat.
 */
export async function renderPdfPageToDataUrl(
  pdfProxy: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 2.0
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  const safePage = Math.max(1, Math.min(pdfProxy.numPages, pageNumber));
  const page = await pdfProxy.getPage(safePage);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');

  await startCrispPdfPageRender(page, canvas, viewport).promise;

  const mimeType = 'image/png';
  const dataUrl = canvas.toDataURL(mimeType);
  const base64 = dataUrl.split(',')[1] || '';
  return { dataUrl, base64, mimeType };
}

/**
 * Converts extracted OCR text (English, Hinglish, or full Unicode/Devanagari Hindi) into a clean PDF.
 */
export async function createPdfBytesFromExtractedText(
  title: string,
  text: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);

  // Check if text contains non-WinAnsi Unicode characters (e.g. Devanagari Hindi)
  const hasExtendedUnicode = /[^\u0009\u000A\u000D\u0020-\u00FF]/.test(text);

  if (!hasExtendedUnicode) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage([612, 792]);
    let y = 742;

    page.drawText(title.slice(0, 80), {
      x: 48,
      y,
      size: 14,
      font: boldFont,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 26;

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const chunks = rawLine.match(/.{1,84}/g) || [''];
      for (const chunk of chunks) {
        if (y < 52) {
          page = pdfDoc.addPage([612, 792]);
          y = 742;
        }
        page.drawText(chunk, {
          x: 48,
          y,
          size: 10.5,
          font,
          color: rgb(0.12, 0.16, 0.23),
        });
        y -= 15.5;
      }
    }
    return pdfDoc.save();
  }

  // Full Unicode / Devanagari Hindi path via 2x DPI paginated canvas embedding
  const pageWidthPx = 1224;
  const pageHeightPx = 1584;
  const marginPx = 96;
  const maxLineWidth = pageWidthPx - marginPx * 2;
  const lineHeight = 34;

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');
  if (!mCtx) {
    throw new Error('Canvas context unavailable for Unicode PDF rendering.');
  }
  mCtx.font = '22px system-ui, -apple-system, sans-serif';

  const wrappedLines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) {
      wrappedLines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (mCtx.measureText(candidate).width > maxLineWidth && currentLine) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  const linesPerPage = Math.floor((pageHeightPx - marginPx * 2 - 60) / lineHeight);
  const totalPages = Math.max(1, Math.ceil(wrappedLines.length / linesPerPage));

  for (let p = 0; p < totalPages; p++) {
    const canvas = document.createElement('canvas');
    canvas.width = pageWidthPx;
    canvas.height = pageHeightPx;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);

    let y = marginPx + 24;
    if (p === 0) {
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(title.slice(0, 65), marginPx, y);
      y += 48;
    }

    ctx.fillStyle = '#1E293B';
    ctx.font = '22px system-ui, -apple-system, sans-serif';
    const slice = wrappedLines.slice(p * linesPerPage, (p + 1) * linesPerPage);
    for (const line of slice) {
      ctx.fillText(line, marginPx, y);
      y += lineHeight;
    }

    const pngDataUrl = canvas.toDataURL('image/png');
    const pngBase64 = pngDataUrl.split(',')[1] || '';
    const binary = atob(pngBase64);
    const pngBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      pngBytes[i] = binary.charCodeAt(i);
    }
    const embedded = await pdfDoc.embedPng(pngBytes);
    const pdfPage = pdfDoc.addPage([612, 792]);
    pdfPage.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
  }

  return pdfDoc.save();
}
