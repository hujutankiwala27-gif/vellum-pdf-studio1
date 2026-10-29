import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileUp,
} from 'lucide-react';
import {
  ConversionHistoryItem,
  ExportFormat,
  PdfAnnotation,
} from '../types/pdfStudio';
import { formatFileSize, parsePageRange } from '../utils/pdfPureLogic';
import { bakeAnnotationsIntoPdf } from '../utils/pdfOperations';
import {
  convertExternalFilesToPdf,
  convertPdfBytesToFormat,
  triggerBrowserDownload,
} from '../utils/formatConverter';

interface FormatConverterViewProps {
  documentTitle: string;
  pdfBytes: Uint8Array;
  pageCount: number;
  annotations: PdfAnnotation[];
  conversionHistory: ConversionHistoryItem[];
  onRecordConversion: (params: {
    sourceTitle: string;
    targetFormat: ExportFormat | 'pdf';
    pageCount: number;
    outputSizeBytes: number;
  }) => Promise<void>;
  onLoadConvertedPdfIntoViewer: (title: string, bytes: Uint8Array) => Promise<void>;
}

const FORMAT_OPTIONS: {
  id: ExportFormat;
  label: string;
  extLabel: string;
  description: string;
  category: 'Word & Docs' | 'Images' | 'Web & Data';
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'docx',
    label: 'Microsoft Word',
    extLabel: '.DOCX',
    description: 'Editable OOXML Word document preserving headings, paragraphs, and page breaks.',
    category: 'Word & Docs',
    icon: FileText,
  },
  {
    id: 'doc',
    label: 'Word Classic',
    extLabel: '.DOC',
    description: 'Legacy MS Word rich document compatible with older Office suites.',
    category: 'Word & Docs',
    icon: FileText,
  },
  {
    id: 'jpg',
    label: 'JPG Image',
    extLabel: '.JPG',
    description: 'High-resolution JPEG pages (single .jpg or bundled .zip for multi-page).',
    category: 'Images',
    icon: FileImage,
  },
  {
    id: 'jpeg',
    label: 'JPEG Print Grade',
    extLabel: '.JPEG',
    description: 'Archival JPEG export with configurable 150-300 DPI supersampling.',
    category: 'Images',
    icon: FileImage,
  },
  {
    id: 'png',
    label: 'PNG Lossless',
    extLabel: '.PNG',
    description: 'Lossless crisp raster images ideal for diagrams, CAD, and charts.',
    category: 'Images',
    icon: FileImage,
  },
  {
    id: 'txt',
    label: 'Plain Text',
    extLabel: '.TXT',
    description: 'Clean UTF-8 extracted text organized sequentially by page.',
    category: 'Word & Docs',
    icon: FileText,
  },
  {
    id: 'md',
    label: 'Markdown',
    extLabel: '.MD',
    description: 'Structured Markdown ready for Notion, GitHub, or documentation wikis.',
    category: 'Web & Data',
    icon: FileCode2,
  },
  {
    id: 'html',
    label: 'Standalone HTML5',
    extLabel: '.HTML',
    description: 'Self-contained semantic web document with responsive typography.',
    category: 'Web & Data',
    icon: FileCode2,
  },
  {
    id: 'csv',
    label: 'Excel / CSV Table',
    extLabel: '.CSV',
    description: 'Extracts row-aligned PDF columns into spreadsheet-ready CSV format.',
    category: 'Web & Data',
    icon: FileSpreadsheet,
  },
];

export const FormatConverterView: React.FC<FormatConverterViewProps> = ({
  documentTitle,
  pdfBytes,
  pageCount,
  annotations,
  conversionHistory,
  onRecordConversion,
  onLoadConvertedPdfIntoViewer,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('docx');
  const [pageRangeInput, setPageRangeInput] = useState('all');
  const [dpiScale, setDpiScale] = useState<number>(2.0);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastExportSuccess, setLastExportSuccess] = useState<string | null>(null);

  const reverseInputRef = useRef<HTMLInputElement | null>(null);

  const handleRunConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLastExportSuccess(null);

    const parsed = parsePageRange(pageRangeInput, pageCount);
    if (parsed.error) {
      setErrorMessage(parsed.error);
      return;
    }

    setIsConverting(true);
    setProgressText(`Preparing ${parsed.pages.length} page(s)...`);

    try {
      const effectiveBytes = includeAnnotations
        ? await bakeAnnotationsIntoPdf(pdfBytes, annotations)
        : pdfBytes;

      const output = await convertPdfBytesToFormat({
        pdfBytes: effectiveBytes,
        sourceTitle: documentTitle,
        format: selectedFormat,
        pageNumbers: parsed.pages,
        imageDpiScale: dpiScale,
        onProgress: (done, total) => {
          setProgressText(`Converting page ${done} of ${total}...`);
        },
      });

      triggerBrowserDownload(output.blob, output.filename);
      await onRecordConversion({
        sourceTitle: documentTitle,
        targetFormat: selectedFormat,
        pageCount: output.pageCount,
        outputSizeBytes: output.blob.size,
      });

      setLastExportSuccess(
        `Exported ${output.filename} (${formatFileSize(output.blob.size)})`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Format conversion failed.');
    } finally {
      setIsConverting(false);
      setProgressText(null);
    }
  };

  const handleReverseFilesToPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;

    setErrorMessage(null);
    setIsConverting(true);
    setProgressText('Building PDF from uploaded files...');
    try {
      const { pdfBytes: builtBytes, title } = await convertExternalFilesToPdf(fileList);
      await onRecordConversion({
        sourceTitle: fileList.map((f) => f.name).join(', '),
        targetFormat: 'pdf',
        pageCount: fileList.length,
        outputSizeBytes: builtBytes.byteLength,
      });
      await onLoadConvertedPdfIntoViewer(title, builtBytes);
      setLastExportSuccess(`Created ${title} and opened in Viewer.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not convert files to PDF.');
    } finally {
      setIsConverting(false);
      setProgressText(null);
    }
  };

  const isImageFormat =
    selectedFormat === 'jpg' || selectedFormat === 'jpeg' || selectedFormat === 'png';

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Universal Format Converter
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Convert <span className="font-semibold text-slate-900">{documentTitle}</span> ({pageCount} pages · {formatFileSize(pdfBytes.byteLength)}) into Word, JPG, JPEG, PNG, HTML, Markdown, or CSV.
          </p>
        </div>

        <div>
          <input
            ref={reverseInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.txt,.md"
            onChange={handleReverseFilesToPdf}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => reverseInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileUp className="h-4 w-4 text-slate-600" />
            JPG / TXT to PDF
          </button>
        </div>
      </div>

      {/* Format Selection Grid */}
      <form onSubmit={handleRunConversion} className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = selectedFormat === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelectedFormat(opt.id);
                  setErrorMessage(null);
                }}
                className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? 'border-blue-700 bg-blue-50/40 ring-1 ring-blue-700'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${active ? 'text-blue-700' : 'text-slate-500'}`} />
                    <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-500">
                    {opt.extLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Conversion Controls Bar */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3 lg:grid-cols-4 items-end">
          <div>
            <label htmlFor="converter-page-range" className="block text-xs font-medium text-slate-700">
              Page Selection (1-{pageCount})
            </label>
            <input
              id="converter-page-range"
              type="text"
              value={pageRangeInput}
              onChange={(e) => {
                setPageRangeInput(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="all or e.g. 1-3, 4"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          {isImageFormat ? (
            <div>
              <label htmlFor="converter-dpi-select" className="block text-xs font-medium text-slate-700">
                Render Resolution
              </label>
              <select
                id="converter-dpi-select"
                value={dpiScale}
                onChange={(e) => setDpiScale(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value={1.5}>Standard Web (150 DPI)</option>
                <option value={2.0}>High Print (220 DPI)</option>
                <option value={2.8}>Ultra Archival (300 DPI)</option>
              </select>
            </div>
          ) : (
            <div>
              <span className="block text-xs font-medium text-slate-700">Edits & Annotations</span>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAnnotations}
                  onChange={(e) => setIncludeAnnotations(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                Include in-place text edits
              </label>
            </div>
          )}

          <div className="sm:col-span-1 lg:col-span-2 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isConverting}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              {isConverting
                ? progressText || 'Converting...'
                : `Convert & Download .${selectedFormat.toUpperCase()}`}
            </button>
          </div>
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
            {errorMessage}
          </p>
        )}

        {lastExportSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{lastExportSuccess}</span>
          </div>
        )}
      </form>

      {/* Conversion History Table */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Recent Conversions</h2>
        {conversionHistory.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
            Converted Word, JPG, PNG, and data files will be logged here with exact output sizes.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Source Document</th>
                  <th className="px-4 py-3 font-semibold">Format</th>
                  <th className="px-4 py-3 font-semibold text-right">Pages</th>
                  <th className="px-4 py-3 font-semibold text-right">Output Size</th>
                  <th className="px-4 py-3 font-semibold text-right">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {conversionHistory.slice(0, 12).map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-medium text-slate-900 max-w-xs truncate">
                      {row.sourceTitle}
                    </td>
                    <td className="px-4 py-2.5 font-mono uppercase text-slate-700">
                      {row.targetFormat}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                      {row.pageCount}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                      {formatFileSize(row.outputSizeBytes)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500 tabular-nums">
                      {new Date(row.createdAtIso).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
