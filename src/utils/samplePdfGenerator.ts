import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * Generates a realistic 4-page enterprise PDF document in two passes:
 * Pass 1 builds clean vector typography, tables, and financial metrics.
 * Pass 2 stamps a realistic diagonal "CONFIDENTIAL - DRAFT COPY" watermark stream
 * onto every page (just like Adobe Acrobat / enterprise DMS tools do), allowing
 * genuine binary stream watermark detection and lossless removal.
 */
export async function generateSampleEnterprisePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const pageSpecs = [
    {
      kicker: 'EXECUTIVE PROPOSAL  |  DOCUMENT ID: VLM-2026-084',
      title: 'Project Horizon: Cloud Infrastructure & Document Modernization',
      sections: [
        {
          heading: '1. Executive Summary',
          lines: [
            'Project Horizon establishes a unified, zero-latency document processing pipeline across',
            'APAC and European engineering hubs. By consolidating legacy print workflows into an',
            'encrypted digital workspace, annual operational overhead decreases by 38.4% ($1.42M USD).',
            'Target production cutover is scheduled for Q4 2026 with full ISO-27001 audit compliance.',
          ],
        },
        {
          heading: '2. Core Performance Benchmarks',
          lines: [
            '• Multi-hundred-megabyte PDF streaming via virtualized viewport rendering (< 90ms first paint).',
            '• Lossless multi-format export supporting OOXML Word (.docx), 300-DPI JPEG/PNG, HTML5, and CSV.',
            '• Automated vector stream watermark scrubbing and in-place paragraph copy editing.',
            '• Hybrid local IndexedDB vault paired with multi-device cloud metadata synchronization.',
          ],
        },
        {
          heading: '3. Q1-Q4 Financial Allocation Summary',
          table: [
            ['Workstream', 'Lead Team', 'Timeline', 'Allocated Budget'],
            ['Core Rendering Engine', 'Platform Systems', 'Q1 - Q2', '$420,000'],
            ['Cloud Vault & Zero-Trust Rules', 'Security Ops', 'Q2 - Q3', '$315,000'],
            ['AI Summarization & Copy Studio', 'Applied ML', 'Q3', '$280,000'],
            ['Global Enterprise Rollout', 'Solutions Eng', 'Q4', '$195,000'],
          ],
        },
      ],
    },
    {
      kicker: 'TECHNICAL ARCHITECTURE  |  SECTION 02',
      title: 'High-Throughput Streaming & Format Conversion Pipeline',
      sections: [
        {
          heading: '2.1 Virtualized Page Viewport',
          lines: [
            'Traditional browser viewers rasterize every page upfront, exhausting memory on 400+ page',
            'engineering manuals. Horizon mounts lightweight aspect-ratio placeholders and renders',
            'high-DPI canvases strictly within an active IntersectionObserver window around the viewport.',
          ],
        },
        {
          heading: '2.2 Multi-Format Structural Synthesis',
          lines: [
            'When converting PDF documents to Microsoft Word (.docx) or Markdown, coordinate-sorted text',
            'spans are grouped into semantic headings, body paragraphs, and tabular rows. Raster exports',
            '(JPG, JPEG, PNG) render directly at 2.0x supersampled resolution and bundle multi-page sets',
            'into standard ZIP archives for immediate distribution.',
          ],
        },
        {
          heading: '2.3 Service Level Objectives',
          table: [
            ['Metric', 'Baseline Legacy', 'Horizon Target', 'Measured P95'],
            ['First Page Render (150MB PDF)', '4,800 ms', '< 250 ms', '118 ms'],
            ['DOCX Conversion (25 Pages)', '11.2 sec', '< 2.0 sec', '0.84 sec'],
            ['Watermark Stream Strip', 'Manual Redraw', '< 500 ms', '64 ms'],
          ],
        },
      ],
    },
    {
      kicker: 'SECURITY & GOVERNANCE  |  SECTION 03',
      title: 'Zero-Trust Access Control & Compliance Posture',
      sections: [
        {
          heading: '3.1 Attribute-Based Cloud Isolation',
          lines: [
            'Every synchronized document record enforces verified identity ownership at the database',
            'rule layer. Unbounded binary slices are partitioned into immutable 650KB subcollection',
            'chunks guarded by relational parent ownership checks to prevent cross-tenant leakage.',
          ],
        },
        {
          heading: '3.2 Redaction & Watermark Governance',
          lines: [
            'Draft proposals carry diagonal review watermarks during internal circulation. Prior to',
            'external client release, authorized editors may strip draft stream layers and apply',
            'permanent vector redaction blocks over sensitive pricing identifiers.',
          ],
        },
      ],
    },
    {
      kicker: 'APPROVAL & SIGN-OFF  |  SECTION 04',
      title: 'Executive Authorization & Implementation Schedule',
      sections: [
        {
          heading: '4.1 Key Action Items Before Launch',
          lines: [
            '1. Finalize security review of cloud workspace rules before October 31, 2026.',
            '2. Remove DRAFT watermark from client distribution package prior to partner sign-off.',
            '3. Counter-sign authorization block below using the Studio Signature tool.',
            '4. Export archival copies in both PDF and Word (.docx) formats for legal retention.',
          ],
        },
        {
          heading: '4.2 Sign-Off Block',
          lines: [
            'Prepared By:   Aarav Mehta, Principal Systems Architect',
            'Reviewed By:   Naina Kapoor, VP of Cloud Engineering',
            'Authorization: ___________________________   Date: _______________',
          ],
        },
      ],
    },
  ];

  for (let i = 0; i < pageSpecs.length; i++) {
    const spec = pageSpecs[i];
    const page = doc.addPage([612, 792]); // US Letter
    const { width, height } = page.getSize();

    // Top subtle header bar
    page.drawRectangle({
      x: 48,
      y: height - 56,
      width: width - 96,
      height: 1,
      color: rgb(0.82, 0.85, 0.9),
    });

    page.drawText(spec.kicker, {
      x: 48,
      y: height - 46,
      size: 8.5,
      font: fontMono,
      color: rgb(0.38, 0.45, 0.55),
    });

    page.drawText(spec.title, {
      x: 48,
      y: height - 86,
      size: 16,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });

    let cursorY = height - 124;

    for (const sec of spec.sections) {
      page.drawText(sec.heading, {
        x: 48,
        y: cursorY,
        size: 12,
        font: fontBold,
        color: rgb(0.11, 0.3, 0.85),
      });
      cursorY -= 20;

      if (sec.lines) {
        for (const line of sec.lines) {
          page.drawText(line, {
            x: 48,
            y: cursorY,
            size: 10.5,
            font: fontRegular,
            color: rgb(0.18, 0.23, 0.31),
          });
          cursorY -= 16;
        }
        cursorY -= 14;
      }

      if (sec.table) {
        const colWidths = [165, 120, 95, 136];
        sec.table.forEach((row, rIdx) => {
          const rowHeight = 22;
          page.drawRectangle({
            x: 48,
            y: cursorY - 6,
            width: width - 96,
            height: rowHeight,
            color: rIdx === 0 ? rgb(0.93, 0.95, 0.98) : rIdx % 2 === 0 ? rgb(0.98, 0.99, 1) : rgb(1, 1, 1),
            borderColor: rgb(0.85, 0.88, 0.92),
            borderWidth: 0.5,
          });
          let colX = 56;
          row.forEach((cell, cIdx) => {
            page.drawText(cell, {
              x: colX,
              y: cursorY,
              size: 9.5,
              font: rIdx === 0 ? fontBold : cIdx === 3 ? fontMono : fontRegular,
              color: rIdx === 0 ? rgb(0.08, 0.12, 0.2) : rgb(0.2, 0.25, 0.33),
            });
            colX += colWidths[cIdx];
          });
          cursorY -= rowHeight;
        });
        cursorY -= 18;
      }
    }

    // Footer
    page.drawRectangle({
      x: 48,
      y: 48,
      width: width - 96,
      height: 0.75,
      color: rgb(0.85, 0.88, 0.92),
    });
    page.drawText(`Page ${i + 1} of ${pageSpecs.length}`, {
      x: width - 115,
      y: 32,
      size: 9,
      font: fontMono,
      color: rgb(0.45, 0.5, 0.58),
    });
  }

  const cleanPassBytes = await doc.save();

  // Pass 2: Stamp realistic diagonal watermark in a separate content stream on each page
  return addWatermarkOverlayStream(cleanPassBytes, 'CONFIDENTIAL - DRAFT COPY');
}

export async function addWatermarkOverlayStream(
  pdfBytes: Uint8Array,
  watermarkText: string,
  options?: { opacity?: number; diagonal?: boolean; colorHex?: string }
): Promise<Uint8Array> {
  const stampedDoc = await PDFDocument.load(pdfBytes.slice());
  const wmFont = await stampedDoc.embedFont(StandardFonts.HelveticaBold);
  const opacity = options?.opacity ?? 0.18;
  const diagonal = options?.diagonal ?? true;
  const hex = (options?.colorHex || '#DC2626').replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255 || 0.86;
  const g = parseInt(hex.slice(2, 4), 16) / 255 || 0.15;
  const b = parseInt(hex.slice(4, 6), 16) / 255 || 0.15;

  for (const page of stampedDoc.getPages()) {
    const { width, height } = page.getSize();
    if (diagonal) {
      page.drawText(watermarkText, {
        x: width * 0.14,
        y: height * 0.34,
        size: 34,
        font: wmFont,
        color: rgb(r, g, b),
        opacity,
        rotate: degrees(38),
      });
    } else {
      page.drawText(watermarkText, {
        x: width * 0.2,
        y: height * 0.5,
        size: 30,
        font: wmFont,
        color: rgb(r, g, b),
        opacity,
      });
    }
  }

  // Save with useObjectStreams: false so overlaid streams remain cleanly inspectable
  return stampedDoc.save({ useObjectStreams: false });
}
