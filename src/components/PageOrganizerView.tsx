import React, { useEffect, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import {
  ArrowLeft,
  ArrowRight,
  CopyPlus,
  FilePlus2,
  RotateCw,
  Trash2,
} from 'lucide-react';
import {
  applyPageOrganizerOperations,
  mergePdfDocuments,
  startCrispPdfPageRender,
} from '../utils/pdfOperations';

interface PageOrganizerItem {
  key: string;
  originalPageNumber: number;
  rotationDeltaDeg: number;
}

interface PageOrganizerViewProps {
  pdfProxy: pdfjsLib.PDFDocumentProxy | null;
  pdfBytes: Uint8Array;
  documentTitle: string;
  onApplyOrganizedPdf: (newBytes: Uint8Array, summaryNote: string) => Promise<void>;
}

const PageThumbCanvas: React.FC<{
  pdfProxy: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  rotationDeltaDeg: number;
}> = ({ pdfProxy, pageNumber, rotationDeltaDeg }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cancelJob: (() => void) | null = null;
    async function paint() {
      try {
        const page = await pdfProxy.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const vp = page.getViewport({
          scale: 0.48,
          rotation: (page.rotate + rotationDeltaDeg) % 360,
        });
        const job = startCrispPdfPageRender(page, canvasRef.current, vp);
        cancelJob = job.cancel;
        await job.promise;
      } catch {
        // ignore rapid unmount
      }
    }
    void paint();
    return () => {
      cancelled = true;
      cancelJob?.();
    };
  }, [pdfProxy, pageNumber, rotationDeltaDeg]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto max-h-48 w-auto border border-slate-200 bg-white shadow-2xs"
    />
  );
};

export const PageOrganizerView: React.FC<PageOrganizerViewProps> = ({
  pdfProxy,
  pdfBytes,
  documentTitle,
  onApplyOrganizedPdf,
}) => {
  const [items, setItems] = useState<PageOrganizerItem[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pdfProxy) return;
    setItems(
      Array.from({ length: pdfProxy.numPages }, (_, idx) => ({
        key: `pg_${idx + 1}_${Date.now()}`,
        originalPageNumber: idx + 1,
        rotationDeltaDeg: 0,
      }))
    );
  }, [pdfProxy]);

  const handleRotate = (index: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? { ...it, rotationDeltaDeg: (it.rotationDeltaDeg + 90) % 360 }
          : it
      )
    );
  };

  const handleDuplicate = (index: number) => {
    setItems((prev) => {
      const target = prev[index];
      const clone: PageOrganizerItem = {
        ...target,
        key: `dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      };
      const next = [...prev];
      next.splice(index + 1, 0, clone);
      return next;
    });
  };

  const handleMove = (index: number, delta: -1 | 1) => {
    const dest = index + delta;
    if (dest < 0 || dest >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(dest, 0, moved);
      return next;
    });
  };

  const handleDelete = (index: number) => {
    if (items.length <= 1) {
      setErrorMsg('A PDF document must retain at least 1 page.');
      return;
    }
    setErrorMsg(null);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCommitChanges = async () => {
    if (items.length === 0) return;
    setIsApplying(true);
    setErrorMsg(null);
    try {
      const updated = await applyPageOrganizerOperations(pdfBytes, items);
      await onApplyOrganizedPdf(updated, `Updated page structure (${items.length} pages).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reorganize pages.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleMergePdfFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    setIsApplying(true);
    setErrorMsg(null);
    try {
      const buffers = await Promise.all(
        files.map(async (f) => new Uint8Array(await f.arrayBuffer()))
      );
      const merged = await mergePdfDocuments([pdfBytes, ...buffers]);
      await onApplyOrganizedPdf(merged, `Merged ${files.length} additional PDF file(s).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to merge PDF files.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Page Organizer & PDF Merger
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Rotate, reorder, duplicate, delete pages, or merge external PDFs into{' '}
            <span className="font-semibold text-slate-900">{documentTitle}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={mergeInputRef}
            type="file"
            multiple
            accept="application/pdf,.pdf"
            onChange={handleMergePdfFiles}
            className="hidden"
          />
          <button
            type="button"
            disabled={isApplying}
            onClick={() => mergeInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-4 w-4 text-slate-600" />
            Merge Another PDF
          </button>
          <button
            type="button"
            disabled={isApplying}
            onClick={handleCommitChanges}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isApplying ? 'Applying...' : 'Apply Page Order & Rotations'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {errorMsg}
        </p>
      )}

      {pdfProxy && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item, idx) => (
            <div
              key={item.key}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5"
            >
              <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums mb-2">
                <span className="font-mono font-semibold text-slate-800">#{idx + 1}</span>
                <span>
                  Src p.{item.originalPageNumber}
                  {item.rotationDeltaDeg > 0 ? ` · +${item.rotationDeltaDeg}°` : ''}
                </span>
              </div>

              <div className="flex min-h-48 items-center justify-center rounded-lg bg-slate-50 p-2">
                <PageThumbCanvas
                  pdfProxy={pdfProxy}
                  pageNumber={item.originalPageNumber}
                  rotationDeltaDeg={item.rotationDeltaDeg}
                />
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMove(idx, -1)}
                    aria-label={`Move page ${idx + 1} left`}
                    className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() => handleMove(idx, 1)}
                    aria-label={`Move page ${idx + 1} right`}
                    className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleRotate(idx)}
                    aria-label={`Rotate page ${idx + 1} clockwise`}
                    className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(idx)}
                    aria-label={`Duplicate page ${idx + 1}`}
                    className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(idx)}
                    aria-label={`Delete page ${idx + 1}`}
                    className="rounded p-1 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
