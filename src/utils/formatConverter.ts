import {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ExportFormat, PageTextData } from '../types/pdfStudio';
import {
  buildCsvFromPages,
  buildHtmlFromPages,
  buildMarkdownFromPages,
  buildWordCompatibleDocHtml,
  computeSafeCanvasRenderScale,
} from './pdfPureLogic';
import {
  extractPagesTextData,
  loadPdfProxy,
  startCrispPdfPageRender,
} from './pdfOperations';

export interface ConversionOutput {
  blob: Blob;
  filename: string;
  pageCount: number;
}

/**
 * Converts PDF bytes into any requested target format (DOCX, DOC, JPG, JPEG, PNG, TXT, MD, HTML, CSV)
 * across selected page numbers.
 */
export async function convertPdfBytesToFormat(params: {
  pdfBytes: Uint8Array;
  sourceTitle: string;
  format: ExportFormat;
  pageNumbers: number[];
  imageDpiScale?: number; // 1.5 (standard) or 2.5 (300 DPI ultra)
  jpegQuality?: number; // 0.85..0.96
  onProgress?: (completed: number, total: number) => void;
}): Promise<ConversionOutput> {
  const {
    pdfBytes,
    sourceTitle,
    format,
    pageNumbers,
    imageDpiScale = 2.0,
    jpegQuality = 0.92,
    onProgress,
  } = params;

  const baseName = sourceTitle.replace(/\.pdf$/i, '') || 'Document';
  const pdfProxy = await loadPdfProxy(pdfBytes);

  try {
    // Raster Image Formats: JPG, JPEG, PNG
    if (format === 'jpg' || format === 'jpeg' || format === 'png') {
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const ext = format;
      const renderedBlobs: { pageNum: number; blob: Blob }[] = [];

      for (let i = 0; i < pageNumbers.length; i++) {
        const pageNum = pageNumbers[i];
        const page = await pdfProxy.getPage(pageNum);
        const baseVp = page.getViewport({ scale: 1 });
        const safeScale = computeSafeCanvasRenderScale(
          baseVp.width,
          baseVp.height,
          imageDpiScale,
          1
        );
        const viewport = page.getViewport({ scale: safeScale });
        const canvas = document.createElement('canvas');

        await startCrispPdfPageRender(page, canvas, viewport).promise;

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))),
            mimeType,
            format === 'png' ? undefined : jpegQuality
          );
        });

        renderedBlobs.push({ pageNum, blob });
        onProgress?.(i + 1, pageNumbers.length);
      }

      if (renderedBlobs.length === 1) {
        return {
          blob: renderedBlobs[0].blob,
          filename: `${baseName}_page_${renderedBlobs[0].pageNum}.${ext}`,
          pageCount: 1,
        };
      }

      const zip = new JSZip();
      for (const item of renderedBlobs) {
        const padded = String(item.pageNum).padStart(3, '0');
        zip.file(`${baseName}_page_${padded}.${ext}`, item.blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return {
        blob: zipBlob,
        filename: `${baseName}_${ext.toUpperCase()}_Pages.zip`,
        pageCount: renderedBlobs.length,
      };
    }

    // Text & Document Formats: extract structured text & spans for target pages
    const pagesData: PageTextData[] = await extractPagesTextData(pdfProxy, pageNumbers);
    onProgress?.(pageNumbers.length, pageNumbers.length);

    if (format === 'docx') {
      const children: Paragraph[] = [
        new Paragraph({
          text: baseName,
          heading: HeadingLevel.TITLE,
          spacing: { after: 280 },
        }),
      ];

      pagesData.forEach((p, idx) => {
        const lines = p.text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);

        if (lines.length === 0) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `[Page ${p.pageNumber} — Visual / Scanned Page]`,
                  italics: true,
                  color: '64748B',
                }),
              ],
            })
          );
        } else {
          lines.forEach((line, lIdx) => {
            const isSectionHeading =
              (lIdx === 0 && line.length < 85 && !line.endsWith('.')) ||
              /^\d+(\.\d+)?\s+[A-Z]/.test(line);

            if (isSectionHeading) {
              children.push(
                new Paragraph({
                  text: line,
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 220, after: 120 },
                })
              );
            } else {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: line, size: 22 })],
                  spacing: { after: 140 },
                })
              );
            }
          });
        }

        if (idx < pagesData.length - 1) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
        }
      });

      const wordDoc = new Document({
        sections: [{ properties: {}, children }],
      });
      const docxBlob = await Packer.toBlob(wordDoc);
      return {
        blob: docxBlob,
        filename: `${baseName}.docx`,
        pageCount: pagesData.length,
      };
    }

    if (format === 'doc') {
      const htmlDoc = buildWordCompatibleDocHtml(sourceTitle, pagesData);
      return {
        blob: new Blob([htmlDoc], { type: 'application/msword;charset=utf-8' }),
        filename: `${baseName}.doc`,
        pageCount: pagesData.length,
      };
    }

    if (format === 'txt') {
      const plain = pagesData
        .map((p) => `=== Page ${p.pageNumber} ===\n${p.text}`)
        .join('\n\n');
      return {
        blob: new Blob([plain], { type: 'text/plain;charset=utf-8' }),
        filename: `${baseName}.txt`,
        pageCount: pagesData.length,
      };
    }

    if (format === 'md') {
      const md = buildMarkdownFromPages(sourceTitle, pagesData);
      return {
        blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }),
        filename: `${baseName}.md`,
        pageCount: pagesData.length,
      };
    }

    if (format === 'html') {
      const html = buildHtmlFromPages(sourceTitle, pagesData);
      return {
        blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
        filename: `${baseName}.html`,
        pageCount: pagesData.length,
      };
    }

    // CSV
    const csv = buildCsvFromPages(pagesData);
    return {
      blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      filename: `${baseName}.csv`,
      pageCount: pagesData.length,
    };
  } finally {
    const cleanupTarget = pdfProxy as unknown as {
      destroy?: () => Promise<void>;
      cleanup?: () => Promise<void>;
    };
    await (cleanupTarget.destroy ? cleanupTarget.destroy() : cleanupTarget.cleanup?.());
  }
}

/**
 * Reverse Converter: Converts JPG, JPEG, PNG, TXT, or MD files into a clean multi-page PDF.
 */
export async function convertExternalFilesToPdf(files: File[]): Promise<{
  pdfBytes: Uint8Array;
  title: string;
}> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const file of files) {
    const lower = file.name.toLowerCase();
    const buf = new Uint8Array(await file.arrayBuffer());

    if (lower.endsWith('.png') || file.type === 'image/png') {
      const img = await pdfDoc.embedPng(buf);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      file.type === 'image/jpeg'
    ) {
      const img = await pdfDoc.embedJpg(buf);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (
      lower.endsWith('.webp') ||
      lower.endsWith('.bmp') ||
      file.type.startsWith('image/')
    ) {
      // Convert WebP / BMP / other browser-decodable raster graphics losslessly into sRGB PNG
      const bitmapUrl = URL.createObjectURL(file);
      try {
        const decodedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error(`Unable to decode image ${file.name}`));
          el.src = bitmapUrl;
        });
        const cnv = document.createElement('canvas');
        cnv.width = Math.max(1, decodedImg.naturalWidth || decodedImg.width);
        cnv.height = Math.max(1, decodedImg.naturalHeight || decodedImg.height);
        const ctx = cnv.getContext('2d', { colorSpace: 'srgb' }) || cnv.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable for image conversion.');
        ctx.drawImage(decodedImg, 0, 0);
        const pngDataUrl = cnv.toDataURL('image/png');
        const base64Part = pngDataUrl.split(',')[1] || '';
        const pngBytes = Uint8Array.from(atob(base64Part), (c) => c.charCodeAt(0));
        const embedded = await pdfDoc.embedPng(pngBytes);
        const page = pdfDoc.addPage([embedded.width, embedded.height]);
        page.drawImage(embedded, {
          x: 0,
          y: 0,
          width: embedded.width,
          height: embedded.height,
        });
      } finally {
        URL.revokeObjectURL(bitmapUrl);
      }
    } else {
      const rawText = new TextDecoder('utf-8').decode(buf);
      const lines = rawText.split(/\r?\n/);
      let page = pdfDoc.addPage([612, 792]);
      let y = 740;

      for (const rawLine of lines) {
        const chunks = rawLine.match(/.{1,82}/g) || [''];
        for (const chunk of chunks) {
          if (y < 54) {
            page = pdfDoc.addPage([612, 792]);
            y = 740;
          }
          page.drawText(chunk, {
            x: 48,
            y,
            size: 10.5,
            font,
            color: rgb(0.1, 0.14, 0.2),
          });
          y -= 15;
        }
      }
    }
  }

  const outBytes = await pdfDoc.save();
  const baseName = (files[0]?.name || 'Converted_Document').replace(/\.[^.]+$/, '');
  return {
    pdfBytes: outBytes,
    title: `${baseName}.pdf`,
  };
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
