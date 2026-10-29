import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eraser,
  EyeOff,
  FileSignature,
  Highlighter,
  Layers,
  ListFilter,
  MessageSquarePlus,
  MousePointer,
  PanelLeft,
  PenTool,
  Redo2,
  ScanText,
  Search,
  Sparkles,
  Square,
  Stamp,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AiPanelTab,
  AnnotationTool,
  DetectedWatermarkCandidate,
  ExtractedTextSpan,
  PageLayoutMode,
  PageTextData,
  PdfAnnotation,
  PdfSearchMatch,
  ReadingTheme,
  StampPreset,
} from '../types/pdfStudio';
import { findGlobalSearchMatches } from '../utils/pdfPureLogic';
import { VirtualizedPdfPage } from './VirtualizedPdfPage';

interface PdfViewerWorkspaceProps {
  pdfProxy: pdfjsLib.PDFDocumentProxy | null;
  pageCount: number;
  activePage: number;
  onActivePageChange: (page: number) => void;
  pagesTextData: PageTextData[];
  annotations: PdfAnnotation[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddAnnotation: (ann: PdfAnnotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<PdfAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  activeTool: AnnotationTool;
  onSelectTool: (tool: AnnotationTool) => void;
  pendingSignature: { dataUrl: string; label: string } | null;
  onOpenSignatureModal: () => void;
  watermarkCandidates: DetectedWatermarkCandidate[];
  onOpenWatermarkModal: () => void;
  isAiPanelOpen: boolean;
  activeAiTab: AiPanelTab;
  onOpenAiTab: (tab: AiPanelTab) => void;
  onToggleAiPanel: () => void;
  onSelectSpanForAi: (text: string, span: ExtractedTextSpan) => void;
}

const COLOR_SWATCHES = [
  { hex: '#FACC15', label: 'Yellow Highlight', bgClass: 'bg-yellow-300' },
  { hex: '#4ADE80', label: 'Green Highlight', bgClass: 'bg-emerald-400' },
  { hex: '#38BDF8', label: 'Sky Blue Highlight', bgClass: 'bg-sky-400' },
  { hex: '#F472B6', label: 'Pink Highlight', bgClass: 'bg-pink-400' },
  { hex: '#FB923C', label: 'Orange Highlight', bgClass: 'bg-orange-400' },
  { hex: '#EF4444', label: 'Crimson Red', bgClass: 'bg-red-500' },
];

export const PdfViewerWorkspace: React.FC<PdfViewerWorkspaceProps> = ({
  pdfProxy,
  pageCount,
  activePage,
  onActivePageChange,
  pagesTextData,
  annotations,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  activeTool,
  onSelectTool,
  pendingSignature,
  onOpenSignatureModal,
  watermarkCandidates,
  onOpenWatermarkModal,
  isAiPanelOpen,
  activeAiTab,
  onOpenAiTab,
  onToggleAiPanel,
  onSelectSpanForAi,
}) => {
  const [zoomScale, setZoomScale] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
      ? Math.max(0.48, Number(((window.innerWidth - 36) / 612).toFixed(2)))
      : 1.1
  );
  const [layoutMode, setLayoutMode] = useState<PageLayoutMode>(PageLayoutMode.CONTINUOUS);
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>(ReadingTheme.LIGHT);
  const [activeColor, setActiveColor] = useState<string>('#FACC15');
  const [activeStamp, setActiveStamp] = useState<StampPreset>('APPROVED');

  // Global Document Search State
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [wholeWord, setWholeWord] = useState<boolean>(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [showSearchResultsList, setShowSearchResultsList] = useState<boolean>(false);

  const [showLeftDrawer, setShowLeftDrawer] = useState<boolean>(false);
  const [leftDrawerTab, setLeftDrawerTab] = useState<'pages' | 'annotations'>('pages');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const handleChooseColor = (hex: string) => {
    setActiveColor(hex);
    if (selectedAnnotationId) {
      const targetAnn = annotations.find((a) => a.id === selectedAnnotationId);
      if (targetAnn && targetAnn.type !== 'redact' && targetAnn.type !== 'watermark_mask') {
        onUpdateAnnotation(selectedAnnotationId, { color: hex });
        return;
      }
    }
    if (
      activeTool === AnnotationTool.SELECT ||
      activeTool === AnnotationTool.REDACT ||
      activeTool === AnnotationTool.WATERMARK_MASK ||
      activeTool === AnnotationTool.SIGNATURE
    ) {
      onSelectTool(AnnotationTool.HIGHLIGHT);
    }
  };

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setZoomScale(Math.max(0.48, Number(((window.innerWidth - 36) / 612).toFixed(2))));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Global Ctrl+F / Cmd+F keyboard shortcut to open in-document search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const scrollToPage = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(pageCount, target));
      onActivePageChange(clamped);
      if (layoutMode !== PageLayoutMode.SINGLE) {
        const el = document.getElementById(`pdf-page-anchor-${clamped}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [layoutMode, onActivePageChange, pageCount]
  );

  // Compute ordered global search matches across all PDF pages
  const globalSearchMatches: PdfSearchMatch[] = useMemo(
    () =>
      findGlobalSearchMatches(pagesTextData, searchQuery, {
        caseSensitive,
        wholeWord,
      }),
    [pagesTextData, searchQuery, caseSensitive, wholeWord]
  );

  // Group matches by pageNumber for fast O(1) lookup per VirtualizedPdfPage
  const matchesByPage = useMemo(() => {
    const map = new Map<number, PdfSearchMatch[]>();
    for (const match of globalSearchMatches) {
      const existing = map.get(match.pageNumber);
      if (existing) {
        existing.push(match);
      } else {
        map.set(match.pageNumber, [match]);
      }
    }
    return map;
  }, [globalSearchMatches]);

  const safeActiveMatchIndex =
    globalSearchMatches.length === 0
      ? 0
      : Math.min(activeMatchIndex, globalSearchMatches.length - 1);

  const activeSearchMatch: PdfSearchMatch | null =
    globalSearchMatches[safeActiveMatchIndex] ?? null;

  const navigateToSearchMatch = useCallback(
    (targetIdx: number) => {
      if (globalSearchMatches.length === 0) return;
      const wrapped =
        ((targetIdx % globalSearchMatches.length) + globalSearchMatches.length) %
        globalSearchMatches.length;
      const target = globalSearchMatches[wrapped];
      setActiveMatchIndex(wrapped);
      onActivePageChange(target.pageNumber);

      requestAnimationFrame(() => {
        const matchEl = document.getElementById(`pdf-search-match-${target.id}`);
        if (matchEl) {
          matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          const pageEl = document.getElementById(`pdf-page-anchor-${target.pageNumber}`);
          pageEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    },
    [globalSearchMatches, onActivePageChange]
  );

  // When query or filter changes, jump to first match automatically if query is non-empty
  const handleSearchQueryChange = (nextQuery: string) => {
    setSearchQuery(nextQuery);
    setActiveMatchIndex(0);
    if (nextQuery.trim()) {
      const nextMatches = findGlobalSearchMatches(pagesTextData, nextQuery, {
        caseSensitive,
        wholeWord,
      });
      if (nextMatches.length > 0) {
        const first = nextMatches[0];
        onActivePageChange(first.pageNumber);
        requestAnimationFrame(() => {
          const pageEl = document.getElementById(`pdf-page-anchor-${first.pageNumber}`);
          pageEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }
  };

  // Global watermark masks apply to every page
  const globalMasks = annotations.filter((a) => a.type === 'watermark_mask' && a.applyToAllPages);

  const getAnnotationsForPage = (pageNum: number) => [
    ...globalMasks,
    ...annotations.filter(
      (a) => a.pageNumber === pageNum && !(a.type === 'watermark_mask' && a.applyToAllPages)
    ),
  ];

  const getSpansForPage = (pageNum: number) =>
    pagesTextData.find((p) => p.pageNumber === pageNum)?.spans || [];

  const visiblePagesList =
    layoutMode === PageLayoutMode.SINGLE
      ? [activePage]
      : Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-slate-100">
      {/* Studio Tool Ribbon */}
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-1.5 gap-y-1.5 border-b border-slate-200 bg-white px-2 py-1.5">
        {/* Left Zone: Drawer + Page Nav + Zoom + Layout/Theme */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowLeftDrawer((v) => !v)}
            aria-label="Toggle pages and annotations drawer"
            title="Toggle Pages & Annotations"
            className={`inline-flex items-center gap-1 rounded-md p-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              showLeftDrawer
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

          {/* Page Stepper */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={activePage <= 1}
              onClick={() => scrollToPage(activePage - 1)}
              aria-label="Previous page"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-xs font-mono text-slate-700 tabular-nums whitespace-nowrap shrink-0">
              {activePage} / {pageCount}
            </span>
            <button
              type="button"
              disabled={activePage >= pageCount}
              onClick={() => scrollToPage(activePage + 1)}
              aria-label="Next page"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
              aria-label="Zoom out"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomScale(1.1)}
              aria-label="Reset zoom to 100 percent"
              className="rounded px-1 py-1 text-xs font-mono text-slate-700 hover:bg-slate-100 tabular-nums whitespace-nowrap shrink-0"
            >
              {Math.round((zoomScale / 1.1) * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.min(2.6, Number((z + 0.15).toFixed(2))))}
              aria-label="Zoom in"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Layout & Comfort Theme Selectors */}
          <select
            aria-label="Page layout mode"
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as PageLayoutMode)}
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-700 focus:border-blue-700 focus:outline-none"
          >
            <option value={PageLayoutMode.CONTINUOUS}>Continuous</option>
            <option value={PageLayoutMode.SINGLE}>Single</option>
            <option value={PageLayoutMode.DUAL}>Spread</option>
          </select>

          <select
            aria-label="Reading color theme"
            value={readingTheme}
            onChange={(e) => setReadingTheme(e.target.value as ReadingTheme)}
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-700 focus:border-blue-700 focus:outline-none"
          >
            <option value={ReadingTheme.LIGHT}>Original Color</option>
            <option value={ReadingTheme.SEPIA}>Sepia</option>
            <option value={ReadingTheme.DARK}>Dark</option>
            <option value={ReadingTheme.INVERT}>Invert</option>
          </select>
        </div>

        {/* Center Zone: Annotation, Highlighter & Always-Visible Color Palette */}
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {[
            { tool: AnnotationTool.SELECT, icon: MousePointer, label: 'Select', showText: false },
            { tool: AnnotationTool.HIGHLIGHT, icon: Highlighter, label: 'Highlight', showText: true },
            { tool: AnnotationTool.UNDERLINE, icon: Underline, label: 'Underline', showText: false },
            { tool: AnnotationTool.STRIKETHROUGH, icon: Strikethrough, label: 'Strike', showText: false },
            { tool: AnnotationTool.INK, icon: PenTool, label: 'Draw', showText: false },
            { tool: AnnotationTool.TEXT_EDIT, icon: Type, label: 'Edit Text', showText: false },
            { tool: AnnotationTool.NOTE, icon: MessageSquarePlus, label: 'Note', showText: false },
            { tool: AnnotationTool.RECT, icon: Square, label: 'Shape', showText: false },
            { tool: AnnotationTool.REDACT, icon: EyeOff, label: 'Redact', showText: false },
            { tool: AnnotationTool.STAMP, icon: Stamp, label: 'Stamp', showText: false },
          ].map(({ tool, icon: Icon, label, showText }) => {
            const isActive = activeTool === tool;
            return (
              <button
                key={tool}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => {
                  if (tool !== AnnotationTool.SELECT) {
                    setSelectedAnnotationId(null);
                  }
                  onSelectTool(tool);
                }}
                className={`inline-flex items-center gap-1 rounded-md ${
                  showText ? 'px-2 py-1.5' : 'p-1.5'
                } text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {showText && <span>{label}</span>}
              </button>
            );
          })}

          {/* Always-Visible Highlighter & Annotation Color Swatches + Custom Color Picker */}
          <div
            role="group"
            aria-label="Highlight and annotation colors"
            className="mx-0.5 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1"
          >
            {COLOR_SWATCHES.map((sw) => {
              const isCurrent = activeColor.toLowerCase() === sw.hex.toLowerCase();
              return (
                <button
                  key={sw.hex}
                  type="button"
                  title={sw.label}
                  aria-label={sw.label}
                  onClick={() => handleChooseColor(sw.hex)}
                  className={`h-4 w-4 rounded-full border transition-transform ${sw.bgClass} ${
                    isCurrent
                      ? 'scale-125 border-slate-950 ring-2 ring-slate-900/30'
                      : 'border-slate-300 hover:scale-110'
                  }`}
                />
              );
            })}
            <input
              type="color"
              aria-label="Custom highlight color"
              title="Pick any custom color"
              value={activeColor}
              onChange={(e) => handleChooseColor(e.target.value)}
              className="h-4 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </div>

          {activeTool === AnnotationTool.STAMP && (
            <select
              aria-label="Stamp preset"
              value={activeStamp}
              onChange={(e) => setActiveStamp(e.target.value as StampPreset)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
            >
              <option value="APPROVED">APPROVED</option>
              <option value="CONFIDENTIAL">CONFIDENTIAL</option>
              <option value="FINAL">FINAL</option>
              <option value="REVIEWED">REVIEWED</option>
              <option value="VOID">VOID</option>
            </select>
          )}

          <button
            type="button"
            onClick={() => {
              if (pendingSignature) {
                onSelectTool(AnnotationTool.SIGNATURE);
              } else {
                onOpenSignatureModal();
              }
            }}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTool === AnnotationTool.SIGNATURE
                ? 'bg-blue-700 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileSignature className="h-3.5 w-3.5" />
            <span>Sign</span>
          </button>

          {/* Undo / Redo */}
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo annotation"
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="Redo annotation"
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right Zone: Global Find + Watermark + Photo OCR + AI Chat Studio */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label="Toggle global text search"
            aria-expanded={isSearchOpen}
            onClick={() => {
              setIsSearchOpen((prev) => {
                const next = !prev;
                if (next) {
                  requestAnimationFrame(() => {
                    searchInputRef.current?.focus();
                  });
                }
                return next;
              });
            }}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              isSearchOpen || searchQuery.trim()
                ? 'border-blue-700 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>
              Find{searchQuery.trim() ? ` (${globalSearchMatches.length})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenWatermarkModal}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTool === AnnotationTool.WATERMARK_MASK
                ? 'border-blue-700 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Eraser className="h-3.5 w-3.5 text-slate-600" />
            <span>
              Watermark{watermarkCandidates.length > 0 ? ` (${watermarkCandidates.length})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onOpenAiTab('ocr')}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              isAiPanelOpen && activeAiTab === 'ocr'
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <ScanText className="h-3.5 w-3.5 text-blue-600" />
            <span>Photo OCR</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isAiPanelOpen && activeAiTab === 'chat') {
                onToggleAiPanel();
              } else {
                onOpenAiTab('chat');
              }
            }}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              isAiPanelOpen && activeAiTab !== 'ocr'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <span>AI Chat</span>
          </button>
        </div>
      </div>

      {/* Global Document Search Bar & Quick-Navigation Strip */}
      {isSearchOpen && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-[180px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="Global PDF text search"
                value={searchQuery}
                onChange={(e) => handleSearchQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateToSearchMatch(
                      e.shiftKey ? safeActiveMatchIndex - 1 : safeActiveMatchIndex + 1
                    );
                  } else if (e.key === 'Escape') {
                    setIsSearchOpen(false);
                  }
                }}
                placeholder="Find across all PDF pages (Enter for next)..."
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            {/* Search Filter Toggles */}
            <button
              type="button"
              aria-pressed={caseSensitive}
              title="Match Case"
              onClick={() => {
                setCaseSensitive((v) => !v);
                setActiveMatchIndex(0);
              }}
              className={`rounded-md border px-2 py-1 text-xs font-mono font-semibold whitespace-nowrap shrink-0 transition-colors ${
                caseSensitive
                  ? 'border-blue-700 bg-blue-700 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              Aa
            </button>

            <button
              type="button"
              aria-pressed={wholeWord}
              title="Match Whole Word"
              onClick={() => {
                setWholeWord((v) => !v);
                setActiveMatchIndex(0);
              }}
              className={`rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                wholeWord
                  ? 'border-blue-700 bg-blue-700 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              Whole Word
            </button>

            {/* Tabular Match Counter + Prev / Next */}
            <span
              aria-live="polite"
              className="px-1.5 text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap shrink-0"
            >
              {!searchQuery.trim()
                ? 'Type to search'
                : globalSearchMatches.length === 0
                  ? '0 matches'
                  : `${safeActiveMatchIndex + 1} / ${globalSearchMatches.length}`}
            </span>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={globalSearchMatches.length === 0}
                onClick={() => navigateToSearchMatch(safeActiveMatchIndex - 1)}
                aria-label="Previous search match"
                title="Previous match (Shift+Enter)"
                className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={globalSearchMatches.length === 0}
                onClick={() => navigateToSearchMatch(safeActiveMatchIndex + 1)}
                aria-label="Next search match"
                title="Next match (Enter)"
                className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={globalSearchMatches.length === 0}
              onClick={() => setShowSearchResultsList((v) => !v)}
              aria-expanded={showSearchResultsList}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 ${
                showSearchResultsList
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" />
              <span>All Results ({globalSearchMatches.length})</span>
            </button>

            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveMatchIndex(0);
                  setShowSearchResultsList(false);
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 whitespace-nowrap shrink-0"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(false);
                setShowSearchResultsList(false);
              }}
              aria-label="Close global search bar"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Contextual Helper Strip when special mode is active */}
      {(activeTool === AnnotationTool.TEXT_EDIT ||
        activeTool === AnnotationTool.WATERMARK_MASK ||
        activeTool === AnnotationTool.SIGNATURE) && (
        <div className="flex items-start sm:items-center justify-between gap-3 border-b border-blue-200 bg-blue-50/70 px-4 py-1.5 text-xs text-slate-800">
          <span className="min-w-0 flex-1 leading-snug">
            {activeTool === AnnotationTool.TEXT_EDIT &&
              'Direct Text Edit Mode: Click any existing PDF line to replace it in-place (or rewrite with AI), or click blank space to add new text.'}
            {activeTool === AnnotationTool.WATERMARK_MASK &&
              'Multi-Page Watermark Mask: Drag a box over any logo/corner watermark to cleanly mask that region across every page.'}
            {activeTool === AnnotationTool.SIGNATURE &&
              'Signature Placement: Click anywhere on a PDF page to stamp your e-signature, or click Change Signature.'}
          </span>
          <div className="flex items-center gap-2">
            {activeTool === AnnotationTool.SIGNATURE && (
              <button
                type="button"
                onClick={onOpenSignatureModal}
                className="font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0"
              >
                Redraw Signature
              </button>
            )}
            <button
              type="button"
              onClick={() => onSelectTool(AnnotationTool.SELECT)}
              className="font-semibold text-slate-700 hover:underline whitespace-nowrap shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Reader Body: Optional Left Drawer + Scrollable Virtualized Viewport + Optional Search Results List */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {showLeftDrawer && (
          <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="grid grid-cols-2 gap-1 border-b border-slate-200 p-2">
              <button
                type="button"
                onClick={() => setLeftDrawerTab('pages')}
                className={`flex items-center justify-center gap-1 rounded py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                  leftDrawerTab === 'pages' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Pages ({pageCount})
              </button>
              <button
                type="button"
                onClick={() => setLeftDrawerTab('annotations')}
                className={`flex items-center justify-center gap-1 rounded py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                  leftDrawerTab === 'annotations' ? 'bg-slate-100 text-slate-900' : 'text-slate-600'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Edits ({annotations.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {leftDrawerTab === 'pages' ? (
                Array.from({ length: pageCount }, (_, idx) => {
                  const pNum = idx + 1;
                  const pageMatchCount = matchesByPage.get(pNum)?.length || 0;
                  const snippet =
                    pagesTextData
                      .find((p) => p.pageNumber === pNum)
                      ?.text.split('\n')[0]
                      ?.slice(0, 48) || `Page ${pNum}`;
                  return (
                    <button
                      key={pNum}
                      type="button"
                      onClick={() => scrollToPage(pNum)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        activePage === pNum
                          ? 'border-blue-700 bg-blue-50/50 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono font-semibold tabular-nums">
                        <span>Page {pNum}</span>
                        <span className="text-[11px] font-normal text-slate-500">
                          {pageMatchCount > 0
                            ? `${pageMatchCount} hit(s)`
                            : getAnnotationsForPage(pNum).length > 0
                              ? `${getAnnotationsForPage(pNum).length} edit(s)`
                              : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{snippet}</p>
                    </button>
                  );
                })
              ) : annotations.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-500">
                  Highlights, notes, stamps, and direct text edits appear here.
                </p>
              ) : (
                annotations.map((ann) => (
                  <div
                    key={ann.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => scrollToPage(ann.pageNumber)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="font-semibold capitalize text-slate-800">
                        {ann.type.replace('_', ' ')} · p.{ann.pageNumber}
                      </p>
                      {ann.text && (
                        <p className="truncate text-[11px] text-slate-500">{ann.text}</p>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAnnotation(ann.id)}
                      aria-label={`Remove ${ann.type} on page ${ann.pageNumber}`}
                      className="ml-2 text-xs text-red-600 hover:underline whitespace-nowrap shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Main PDF Canvas Scroll Area */}
        <div
          className={`flex-1 overflow-auto p-4 sm:p-6 ${
            readingTheme === ReadingTheme.DARK || readingTheme === ReadingTheme.INVERT
              ? 'bg-slate-900'
              : readingTheme === ReadingTheme.SEPIA
                ? 'bg-stone-200/80'
                : 'bg-slate-200/70'
          }`}
        >
          {pdfProxy ? (
            <div
              className={
                layoutMode === PageLayoutMode.DUAL
                  ? 'mx-auto grid max-w-fit grid-cols-1 gap-6 xl:grid-cols-2'
                  : 'space-y-6'
              }
            >
              {visiblePagesList.map((pageNum) => (
                <VirtualizedPdfPage
                  key={pageNum}
                  pdfProxy={pdfProxy}
                  pageNumber={pageNum}
                  zoomScale={layoutMode === PageLayoutMode.DUAL ? zoomScale * 0.78 : zoomScale}
                  readingTheme={readingTheme}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  activeStamp={activeStamp}
                  pendingSignature={pendingSignature}
                  pageSpans={getSpansForPage(pageNum)}
                  annotations={getAnnotationsForPage(pageNum)}
                  pageSearchMatches={matchesByPage.get(pageNum) || []}
                  activeSearchMatchId={activeSearchMatch?.id || null}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelectAnnotation={setSelectedAnnotationId}
                  onAddAnnotation={onAddAnnotation}
                  onUpdateAnnotation={onUpdateAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onSelectSpanForAi={onSelectSpanForAi}
                  onVisiblePage={
                    layoutMode === PageLayoutMode.SINGLE ? undefined : onActivePageChange
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-medium text-slate-600">Loading PDF Engine...</p>
            </div>
          )}
        </div>

        {/* Collapsible Search Results Quick-Navigation Drawer */}
        {isSearchOpen && showSearchResultsList && globalSearchMatches.length > 0 && (
          <aside
            aria-label="Global search results"
            className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5">
              <span className="text-xs font-semibold text-slate-900">
                Search Matches ·{' '}
                <span className="font-mono text-slate-500 tabular-nums">
                  {globalSearchMatches.length}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setShowSearchResultsList(false)}
                aria-label="Close search results list"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {globalSearchMatches.map((match) => {
                const isSelected = match.index === safeActiveMatchIndex;
                return (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => navigateToSearchMatch(match.index)}
                    className={`w-full px-3.5 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                      <span className={isSelected ? 'font-semibold text-blue-700' : ''}>
                        Page {match.pageNumber}
                      </span>
                      <span>#{match.index + 1}</span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-slate-700 break-words">
                      <span className="text-slate-500">{match.prefix}</span>
                      <mark className="rounded-xs bg-amber-200 px-0.5 font-semibold text-slate-900">
                        {match.matchedText}
                      </mark>
                      <span className="text-slate-500">{match.suffix}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
