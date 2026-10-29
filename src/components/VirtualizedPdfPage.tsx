import React, { useEffect, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { MessageSquare, Trash2 } from 'lucide-react';
import {
  AnnotationTool,
  ExtractedTextSpan,
  NormalizedPoint,
  PdfAnnotation,
  PdfSearchMatch,
  ReadingTheme,
  StampPreset,
} from '../types/pdfStudio';
import {
  computeSafeCanvasRenderScale,
  getThemeCanvasFilter,
  resolveTextMarkupBounds,
} from '../utils/pdfPureLogic';
import { startCrispPdfPageRender } from '../utils/pdfOperations';

interface VirtualizedPdfPageProps {
  pdfProxy: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  zoomScale: number;
  readingTheme: ReadingTheme;
  activeTool: AnnotationTool;
  activeColor: string;
  activeStamp: StampPreset;
  pendingSignature: { dataUrl: string; label: string } | null;
  pageSpans: ExtractedTextSpan[];
  annotations: PdfAnnotation[];
  pageSearchMatches: PdfSearchMatch[];
  activeSearchMatchId: string | null;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onAddAnnotation: (ann: PdfAnnotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<PdfAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onSelectSpanForAi: (text: string, span: ExtractedTextSpan) => void;
  onVisiblePage?: (pageNumber: number) => void;
}

export const VirtualizedPdfPage: React.FC<VirtualizedPdfPageProps> = ({
  pdfProxy,
  pageNumber,
  zoomScale,
  readingTheme,
  activeTool,
  activeColor,
  activeStamp,
  pendingSignature,
  pageSpans,
  annotations,
  pageSearchMatches,
  activeSearchMatchId,
  selectedAnnotationId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSelectSpanForAi,
  onVisiblePage,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 3);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }>({
    width: Math.round(612 * zoomScale),
    height: Math.round(792 * zoomScale),
  });
  const [isRendered, setIsRendered] = useState(false);

  // Drag / Ink state
  const [dragStart, setDragStart] = useState<NormalizedPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<NormalizedPoint | null>(null);
  const [inkPoints, setInkPoints] = useState<NormalizedPoint[]>([]);

  // Inline Text Edit popover state
  const [editingDraft, setEditingDraft] = useState<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    originalText?: string;
    coverBackground: boolean;
    fontSize: number;
  } | null>(null);

  const [localSelectedAnnId, setLocalSelectedAnnId] = useState<string | null>(null);
  const selectedAnnId =
    selectedAnnotationId !== undefined ? selectedAnnotationId : localSelectedAnnId;
  const setSelectedAnnId = (id: string | null) => {
    setLocalSelectedAnnId(id);
    onSelectAnnotation?.(id);
  };

  // Virtualized IntersectionObserver for large 500+ page PDFs
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
            if (entry.intersectionRatio >= 0.35) {
              onVisiblePage?.(pageNumber);
            }
          }
        }
      },
      { rootMargin: '600px 0px 600px 0px', threshold: [0.05, 0.4] }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [pageNumber, onVisiblePage]);

  // Ensure page renders immediately when jumped to via global search
  useEffect(() => {
    if (
      activeSearchMatchId &&
      pageSearchMatches.some((m) => m.id === activeSearchMatchId)
    ) {
      setIsNearViewport(true);
    }
  }, [activeSearchMatchId, pageSearchMatches]);

  // Render high-DPI PDF page via untouched offscreen staging canvas for 100% faithful ICC/CMYK color & complex graphics
  useEffect(() => {
    let cancelled = false;
    let cancelRender: (() => void) | null = null;

    async function renderPage() {
      try {
        const page = await pdfProxy.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssViewport = page.getViewport({ scale: zoomScale });
        setPageDimensions({
          width: Math.max(1, Math.round(cssViewport.width)),
          height: Math.max(1, Math.round(cssViewport.height)),
        });

        if (!isNearViewport || !canvasRef.current) return;

        const safeRenderScale = computeSafeCanvasRenderScale(
          baseViewport.width,
          baseViewport.height,
          zoomScale,
          typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 2
        );
        const hiViewport = page.getViewport({ scale: safeRenderScale });
        const activeJob = startCrispPdfPageRender(page, canvasRef.current, hiViewport);
        cancelRender = activeJob.cancel;
        await activeJob.promise;

        if (!cancelled) {
          setIsRendered(true);
        }
      } catch (err) {
        if (!cancelled && err instanceof Error && !err.message.includes('Rendering cancelled')) {
          console.error(`Render error on page ${pageNumber}:`, err);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [pdfProxy, pageNumber, zoomScale, isNearViewport]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLDivElement>): NormalizedPoint => {
    const surface = e.currentTarget ?? containerRef.current;
    if (!surface) {
      return { x: 0, y: 0 };
    }
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const isTextMarkupTool =
    activeTool === AnnotationTool.HIGHLIGHT ||
    activeTool === AnnotationTool.UNDERLINE ||
    activeTool === AnnotationTool.STRIKETHROUGH;

  const isDragBoxTool =
    isTextMarkupTool ||
    activeTool === AnnotationTool.RECT ||
    activeTool === AnnotationTool.REDACT ||
    activeTool === AnnotationTool.WATERMARK_MASK;

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('button, input, textarea')) {
      return;
    }
    if (activeTool === AnnotationTool.SELECT && e.target !== e.currentTarget) {
      return;
    }

    setSelectedAnnId(null);
    const pt = getNormalizedPoint(e);

    if (activeTool === AnnotationTool.INK) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic pointer capture errors
      }
      setInkPoints([pt]);
      return;
    }

    if (isDragBoxTool) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic pointer capture errors
      }
      setDragStart(pt);
      setDragCurrent(pt);
      return;
    }

    if (activeTool === AnnotationTool.TEXT_EDIT) {
      setEditingDraft({
        x: pt.x,
        y: pt.y,
        width: 0.32,
        height: 0.04,
        text: '',
        coverBackground: false,
        fontSize: 12,
      });
      return;
    }

    if (activeTool === AnnotationTool.NOTE) {
      onAddAnnotation({
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        type: 'note',
        x: pt.x,
        y: pt.y,
        width: 0.04,
        height: 0.04,
        color: '#F59E0B',
        text: 'Review comment',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    if (activeTool === AnnotationTool.STAMP) {
      onAddAnnotation({
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        type: 'stamp',
        x: Math.min(0.75, pt.x),
        y: Math.min(0.92, pt.y),
        width: 0.2,
        height: 0.045,
        color: activeStamp === 'APPROVED' ? '#16A34A' : activeStamp === 'CONFIDENTIAL' || activeStamp === 'VOID' ? '#DC2626' : '#1D4ED8',
        text: activeStamp,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    if (activeTool === AnnotationTool.SIGNATURE && pendingSignature) {
      onAddAnnotation({
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        type: 'signature',
        x: Math.min(0.72, pt.x),
        y: Math.min(0.88, pt.y),
        width: 0.24,
        height: 0.08,
        color: '#0F172A',
        text: pendingSignature.label,
        signatureDataUrl: pendingSignature.dataUrl,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = getNormalizedPoint(e);
    if (activeTool === AnnotationTool.INK && inkPoints.length > 0) {
      setInkPoints((prev) => [...prev, pt]);
      return;
    }
    if (isDragBoxTool && dragStart) {
      setDragCurrent(pt);
    }
  };

  const handleOverlayPointerUp = () => {
    if (activeTool === AnnotationTool.INK && inkPoints.length >= 2) {
      const xs = inkPoints.map((p) => p.x);
      const ys = inkPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      onAddAnnotation({
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        type: 'ink',
        x: minX,
        y: minY,
        width: Math.max(0.01, maxX - minX),
        height: Math.max(0.01, maxY - minY),
        color: activeColor,
        strokeWidth: 2.4,
        points: inkPoints,
        createdAt: new Date().toISOString(),
      });
      setInkPoints([]);
      return;
    }
    setInkPoints([]);

    if (isDragBoxTool && dragStart && dragCurrent) {
      if (isTextMarkupTool) {
        const markupTypeMap: Record<string, PdfAnnotation['type']> = {
          [AnnotationTool.HIGHLIGHT]: 'highlight',
          [AnnotationTool.UNDERLINE]: 'underline',
          [AnnotationTool.STRIKETHROUGH]: 'strikethrough',
        };
        const resolvedRects = resolveTextMarkupBounds(dragStart, dragCurrent, pageSpans);
        const nowIso = new Date().toISOString();

        resolvedRects.forEach((rect, idx) => {
          const newId = `ann_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
          onAddAnnotation({
            id: newId,
            pageNumber,
            type: markupTypeMap[activeTool] || 'highlight',
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            color: activeColor,
            text: rect.text,
            createdAt: nowIso,
          });
        });
      } else {
        const x = Math.min(dragStart.x, dragCurrent.x);
        const y = Math.min(dragStart.y, dragCurrent.y);
        const width = Math.abs(dragCurrent.x - dragStart.x);
        const height = Math.abs(dragCurrent.y - dragStart.y);

        if (width > 0.01 || height > 0.008) {
          const typeMap: Record<string, PdfAnnotation['type']> = {
            [AnnotationTool.RECT]: 'rect',
            [AnnotationTool.REDACT]: 'redact',
            [AnnotationTool.WATERMARK_MASK]: 'watermark_mask',
          };
          const newId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          onAddAnnotation({
            id: newId,
            pageNumber,
            type: typeMap[activeTool] || 'rect',
            x,
            y,
            width: Math.max(0.02, width),
            height: Math.max(0.015, height),
            color: activeColor,
            applyToAllPages: activeTool === AnnotationTool.WATERMARK_MASK,
            createdAt: new Date().toISOString(),
          });
        }
      }
      setDragStart(null);
      setDragCurrent(null);
    }
  };

  const handleOverlayPointerCancel = () => {
    setInkPoints([]);
    setDragStart(null);
    setDragCurrent(null);
  };

  const commitInlineTextEdit = () => {
    if (!editingDraft) return;
    const trimmed = editingDraft.text.trim();
    if (editingDraft.id) {
      if (!trimmed && !editingDraft.coverBackground) {
        onDeleteAnnotation(editingDraft.id);
      } else {
        onUpdateAnnotation(editingDraft.id, { text: editingDraft.text });
      }
    } else if (trimmed || editingDraft.coverBackground) {
      onAddAnnotation({
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        type: 'text_edit',
        x: editingDraft.x,
        y: editingDraft.y,
        width: editingDraft.width,
        height: editingDraft.height,
        color: editingDraft.coverBackground ? '#0F172A' : activeColor,
        text: editingDraft.text,
        originalText: editingDraft.originalText,
        coverBackground: editingDraft.coverBackground,
        fontSize: editingDraft.fontSize,
        createdAt: new Date().toISOString(),
      });
    }
    setEditingDraft(null);
  };

  const cursorClass =
    activeTool === AnnotationTool.SELECT
      ? 'cursor-default'
      : activeTool === AnnotationTool.TEXT_EDIT
        ? 'cursor-text'
        : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      data-testid={`pdf-page-${pageNumber}`}
      id={`pdf-page-anchor-${pageNumber}`}
      className="relative mx-auto select-none shadow-sm border border-slate-300 bg-white transition-shadow"
      style={{
        width: `${pageDimensions.width}px`,
        height: `${pageDimensions.height}px`,
      }}
    >
      {/* Skeleton placeholder before canvas paints */}
      {!isRendered && (
        <div className="absolute inset-0 flex flex-col justify-between bg-white p-10 animate-pulse">
          <div className="space-y-4">
            <div className="h-3 w-1/3 rounded bg-slate-200" />
            <div className="h-6 w-3/4 rounded bg-slate-200" />
            <div className="mt-6 space-y-2.5">
              <div className="h-3 w-full rounded bg-slate-100" />
              <div className="h-3 w-11/12 rounded bg-slate-100" />
              <div className="h-3 w-4/5 rounded bg-slate-100" />
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Rendering Page {pageNumber}...
          </span>
        </div>
      )}

      {/* High-DPI Color-Managed PDF Canvas (zero CSS filter in Original Color mode) */}
      <canvas
        ref={canvasRef}
        style={
          readingTheme === ReadingTheme.LIGHT
            ? undefined
            : { filter: getThemeCanvasFilter(readingTheme) }
        }
        className="block h-full w-full"
      />

      {/* Direct Canvas-Blended Highlighter Ink Layer (no z-index wrapper so mix-blend-multiply blends directly with PDF text) */}
      {annotations
        .filter((a) => a.type === 'highlight')
        .map((ann) => (
          <div
            key={`hl_fill_${ann.id}`}
            data-testid="pdf-highlight-fill"
            className="pointer-events-none absolute rounded-xs mix-blend-multiply"
            style={{
              left: `${ann.x * 100}%`,
              top: `${ann.y * 100}%`,
              width: `${ann.width * 100}%`,
              height: `${ann.height * 100}%`,
              backgroundColor: ann.color,
              opacity: 0.55,
            }}
          />
        ))}

      {/* Live Highlighter Marker Preview while Dragging */}
      {dragStart && dragCurrent && activeTool === AnnotationTool.HIGHLIGHT && (
        <div
          className="pointer-events-none absolute rounded-xs mix-blend-multiply"
          style={{
            left: `${Math.min(dragStart.x, dragCurrent.x) * 100}%`,
            top: `${Math.max(0, Math.min(dragStart.y, dragCurrent.y) - 0.008) * 100}%`,
            width: `${Math.max(0.015, Math.abs(dragCurrent.x - dragStart.x)) * 100}%`,
            height: `${Math.max(0.02, Math.abs(dragCurrent.y - dragStart.y)) * 100}%`,
            backgroundColor: activeColor,
            opacity: 0.55,
          }}
        />
      )}

      {/* Global Search Sub-Span Highlights Layer */}
      {pageSearchMatches.map((match) => {
        const isActiveMatch = match.id === activeSearchMatchId;
        const isRotated = Boolean(match.angleDeg && Math.abs(match.angleDeg) >= 3);
        return (
          <div
            key={match.id}
            id={`pdf-search-match-${match.id}`}
            data-testid={isActiveMatch ? 'active-pdf-search-match' : 'pdf-search-match'}
            className={`pointer-events-none absolute rounded-xs mix-blend-multiply transition-colors ${
              isActiveMatch
                ? 'z-20 bg-amber-300/90 ring-2 ring-blue-700'
                : 'z-10 bg-yellow-200/85 ring-1 ring-amber-400/70'
            }`}
            style={{
              left: `${match.x * 100}%`,
              top: `${match.y * 100}%`,
              width: `${match.width * 100}%`,
              height: `${match.height * 100}%`,
              transformOrigin: isRotated ? 'left bottom' : undefined,
              transform: isRotated ? `rotate(${-(match.angleDeg || 0)}deg)` : undefined,
            }}
          />
        );
      })}

      {/* Interactive Clickable Existing PDF Text Spans when in Direct Text Edit mode */}
      {activeTool === AnnotationTool.TEXT_EDIT &&
        pageSpans
          .filter((s) => s.str.trim().length > 1 && Math.abs(s.angleDeg) < 5)
          .map((span) => (
            <button
              key={span.id}
              type="button"
              title="Click to edit this PDF text directly or rewrite with AI"
              aria-label={`Edit PDF text: ${span.str.slice(0, 40)}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectSpanForAi(span.str, span);
                setEditingDraft({
                  x: span.x,
                  y: span.y,
                  width: Math.max(0.18, span.width),
                  height: Math.max(0.022, span.height),
                  text: span.str,
                  originalText: span.str,
                  coverBackground: true,
                  fontSize: Math.max(9, Math.min(22, Math.round(span.fontSize))),
                });
              }}
              className="absolute rounded-xs border border-transparent hover:border-blue-500/70 hover:bg-blue-500/10 focus-visible:border-blue-600 focus-visible:outline-none text-left"
              style={{
                left: `${span.x * 100}%`,
                top: `${span.y * 100}%`,
                width: `${span.width * 100}%`,
                height: `${span.height * 100}%`,
              }}
            />
          ))}

      {/* SVG Ink Layer */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        {annotations
          .filter((a) => a.type === 'ink' && a.points && a.points.length >= 2)
          .map((ann) => (
            <polyline
              key={ann.id}
              fill="none"
              stroke={ann.color}
              strokeWidth={(ann.strokeWidth || 2.4) * 1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={ann.points!.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
            />
          ))}
        {inkPoints.length >= 2 && (
          <polyline
            fill="none"
            stroke={activeColor}
            strokeWidth={3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={inkPoints.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
          />
        )}
      </svg>

      {/* Interactive Pointer Capture Surface */}
      <div
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
        onPointerCancel={handleOverlayPointerCancel}
        className={`absolute inset-0 ${cursorClass} ${
          activeTool !== AnnotationTool.SELECT ? 'touch-none' : ''
        }`}
      >
        {/* Active Drag Preview for non-highlight box tools */}
        {dragStart && dragCurrent && activeTool !== AnnotationTool.HIGHLIGHT && (
          <div
            className="pointer-events-none absolute border-2"
            style={{
              left: `${Math.min(dragStart.x, dragCurrent.x) * 100}%`,
              top: `${Math.min(dragStart.y, dragCurrent.y) * 100}%`,
              width: `${Math.max(0.01, Math.abs(dragCurrent.x - dragStart.x)) * 100}%`,
              height: `${Math.max(0.01, Math.abs(dragCurrent.y - dragStart.y)) * 100}%`,
              borderColor: activeColor,
            }}
          />
        )}

        {/* Rendered Annotations Interactive Controls */}
        {annotations
          .filter((a) => a.type !== 'ink')
          .map((ann) => {
            const isSelected = selectedAnnId === ann.id;
            const allowBoxPointer =
              activeTool === AnnotationTool.SELECT ||
              ann.type === 'note' ||
              ann.type === 'text_edit';
            return (
              <div
                key={ann.id}
                onClick={(e) => {
                  if (!allowBoxPointer) return;
                  e.stopPropagation();
                  setSelectedAnnId(ann.id);
                  if (ann.type === 'text_edit') {
                    setEditingDraft({
                      id: ann.id,
                      x: ann.x,
                      y: ann.y,
                      width: ann.width,
                      height: ann.height,
                      text: ann.text || '',
                      originalText: ann.originalText,
                      coverBackground: Boolean(ann.coverBackground),
                      fontSize: ann.fontSize || 11,
                    });
                  }
                }}
                style={{
                  left: `${ann.x * 100}%`,
                  top: `${ann.y * 100}%`,
                  width: ann.type === 'note' ? 'auto' : `${ann.width * 100}%`,
                  height: ann.type === 'note' ? 'auto' : `${ann.height * 100}%`,
                }}
                className={`group absolute ${
                  allowBoxPointer ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
                } ${isSelected ? 'ring-2 ring-blue-600 z-20 rounded-xs' : 'z-10'}`}
              >
                {ann.type === 'highlight' && <div className="h-full w-full" />}
                {ann.type === 'underline' && (
                  <div
                    className="h-full w-full border-b-2"
                    style={{ borderColor: ann.color }}
                  />
                )}
                {ann.type === 'strikethrough' && (
                  <div
                    className="flex h-full w-full items-center"
                    style={{ minHeight: `${ann.height * pageDimensions.height}px` }}
                  >
                    <div className="w-full border-t-2" style={{ borderColor: ann.color }} />
                  </div>
                )}
                {ann.type === 'rect' && (
                  <div
                    className="h-full w-full border-2"
                    style={{ borderColor: ann.color, minHeight: `${ann.height * pageDimensions.height}px` }}
                  />
                )}
                {ann.type === 'redact' && (
                  <div
                    className="h-full w-full bg-slate-950"
                    title="Redacted area"
                    style={{ minHeight: `${ann.height * pageDimensions.height}px` }}
                  />
                )}
                {ann.type === 'watermark_mask' && (
                  <div
                    className="h-full w-full bg-white ring-1 ring-dashed ring-slate-300 group-hover:ring-blue-500"
                    title={ann.applyToAllPages ? 'Clean watermark mask (applied to all pages)' : 'Clean watermark mask'}
                    style={{ minHeight: `${ann.height * pageDimensions.height}px` }}
                  />
                )}
                {ann.type === 'text_edit' && (
                  <div
                    className={`w-full px-0.5 leading-snug whitespace-pre-wrap ${
                      ann.coverBackground ? 'bg-white' : ''
                    }`}
                    style={{
                      color: ann.color,
                      fontSize: `${Math.round((ann.fontSize || 11) * zoomScale)}px`,
                    }}
                  >
                    {ann.text}
                  </div>
                )}
                {ann.type === 'note' && (
                  <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 shadow-xs">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <input
                      type="text"
                      aria-label="Sticky note comment"
                      value={ann.text || ''}
                      onChange={(e) => onUpdateAnnotation(ann.id, { text: e.target.value })}
                      className="w-36 bg-transparent text-xs text-amber-950 focus:outline-none"
                    />
                  </div>
                )}
                {ann.type === 'stamp' && (
                  <div
                    className="inline-flex items-center justify-center border-2 bg-white/90 px-2.5 py-1 text-xs font-bold tracking-wider uppercase whitespace-nowrap"
                    style={{ borderColor: ann.color, color: ann.color }}
                  >
                    {ann.text}
                  </div>
                )}
                {ann.type === 'signature' && ann.signatureDataUrl && (
                  <img
                    src={ann.signatureDataUrl}
                    alt={ann.text || 'Applied e-signature'}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain"
                  />
                )}

                {/* Delete button on hover or selection */}
                <button
                  type="button"
                  aria-label={`Delete ${ann.type} annotation`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAnnotation(ann.id);
                    if (selectedAnnId === ann.id) {
                      setSelectedAnnId(null);
                    }
                  }}
                  className={`pointer-events-auto absolute -top-3 -right-3 ${
                    isSelected ? 'flex' : 'hidden group-hover:flex'
                  } h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-red-600 shadow-sm hover:bg-red-50`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}

        {/* Inline Direct PDF Text Editor Box */}
        {editingDraft && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${Math.min(0.68, editingDraft.x) * 100}%`,
              top: `${editingDraft.y * 100}%`,
            }}
            className="absolute z-30 w-72 rounded-lg border border-blue-600 bg-white p-2.5 shadow-lg"
          >
            <p className="mb-1 text-[11px] font-semibold text-slate-700">
              {editingDraft.coverBackground ? 'Edit Existing PDF Text In-Place' : 'Insert Text on Page'}
            </p>
            <textarea
              autoFocus
              rows={2}
              aria-label="PDF text content editor"
              value={editingDraft.text}
              onChange={(e) =>
                setEditingDraft((prev) => (prev ? { ...prev, text: e.target.value } : null))
              }
              placeholder="Type text..."
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingDraft(null)}
                className="rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitInlineTextEdit}
                className="rounded bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
              >
                Apply Text
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Subtle corner page indicator */}
      <div className="pointer-events-none absolute right-2 bottom-1.5 text-[11px] font-mono text-slate-400 tabular-nums">
        {pageNumber}
      </div>
    </div>
  );
};
