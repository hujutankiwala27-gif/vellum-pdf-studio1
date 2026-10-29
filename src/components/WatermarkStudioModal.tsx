import React, { useState } from 'react';
import { CheckCircle2, Eraser, Plus, ScanSearch, ShieldAlert, X } from 'lucide-react';
import { DetectedWatermarkCandidate } from '../types/pdfStudio';

interface WatermarkStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidates: DetectedWatermarkCandidate[];
  isProcessing: boolean;
  watermarkRemoved: boolean;
  onRemoveWatermarks: (targetPhrases: string[]) => Promise<void>;
  onActivateRegionMaskTool: () => void;
  onAddWatermark: (text: string, diagonal: boolean, opacity: number) => Promise<void>;
}

export const WatermarkStudioModal: React.FC<WatermarkStudioModalProps> = ({
  isOpen,
  onClose,
  candidates,
  isProcessing,
  watermarkRemoved,
  onRemoveWatermarks,
  onActivateRegionMaskTool,
  onAddWatermark,
}) => {
  const [activeTab, setActiveTab] = useState<'remove' | 'add'>('remove');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [customPhrase, setCustomPhrase] = useState('');
  const [newWatermarkText, setNewWatermarkText] = useState('CONFIDENTIAL');
  const [isDiagonal, setIsDiagonal] = useState(true);
  const [opacityPct, setOpacityPct] = useState(20);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isSelected = (id: string) => selectedIds[id] ?? true;

  const handleRunRemoval = async () => {
    setErrorMessage(null);
    const chosenPhrases = candidates
      .filter((c) => isSelected(c.id))
      .map((c) => c.text);

    if (customPhrase.trim()) {
      chosenPhrases.push(customPhrase.trim());
    }

    if (chosenPhrases.length === 0) {
      setErrorMessage('Select at least one detected watermark or enter watermark text to strip.');
      return;
    }

    try {
      await onRemoveWatermarks(chosenPhrases);
      setCustomPhrase('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to strip watermark.');
    }
  };

  const handleApplyNewWatermark = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!newWatermarkText.trim()) {
      setErrorMessage('Enter watermark text before stamping pages.');
      return;
    }
    try {
      await onAddWatermark(newWatermarkText.trim(), isDiagonal, opacityPct / 100);
      setActiveTab('remove');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to stamp watermark.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watermark-studio-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 id="watermark-studio-title" className="text-lg font-semibold text-slate-900">
              Watermark Studio
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Inspect PDF content streams to strip diagonal stamps, repeating overlays, or corner marks.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Watermark Studio"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={() => {
              setActiveTab('remove');
              setErrorMessage(null);
            }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'remove'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eraser className="h-3.5 w-3.5" />
            Remove Watermarks
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('add');
              setErrorMessage(null);
            }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'add'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Watermark
          </button>
        </div>

        {activeTab === 'remove' ? (
          <div className="mt-5 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800">
                  Detected Stream Watermarks ({candidates.length})
                </h3>
                {watermarkRemoved && (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Watermarks stripped
                  </span>
                )}
              </div>

              {candidates.length === 0 ? (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    <ScanSearch className="h-4 w-4 text-slate-500" />
                    No automatic diagonal or repeating text watermarks detected.
                  </div>
                  <p className="mt-1 text-slate-500">
                    You can still strip a specific phrase below or use the Multi-Page Region Mask tool to erase image/logo watermarks across all pages.
                  </p>
                </div>
              ) : (
                <div className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {candidates.map((cand) => {
                    const checked = isSelected(cand.id);
                    return (
                      <label
                        key={cand.id}
                        className="flex cursor-pointer items-start gap-3 p-3.5 hover:bg-slate-50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedIds((prev) => ({ ...prev, [cand.id]: e.target.checked }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            “{cand.text}”
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                            <span>{cand.isDiagonal ? 'Diagonal vector overlay' : 'Repeating text stamp'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{cand.pagesAffected.length} pages affected</span>
                            <span aria-hidden="true">·</span>
                            <span>{cand.confidence === 'high' ? 'High confidence' : 'Medium confidence'}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="custom-watermark-phrase"
                className="block text-xs font-medium text-slate-700"
              >
                Target Specific Watermark Text (Optional)
              </label>
              <input
                id="custom-watermark-phrase"
                type="text"
                value={customPhrase}
                onChange={(e) => setCustomPhrase(e.target.value)}
                placeholder="e.g. DO NOT DISTRIBUTE or www.example.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="pr-3">
                <p className="text-xs font-semibold text-slate-800">
                  Have a raster logo or corner image watermark?
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Draw a clean mask box once to erase that exact region across every page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onActivateRegionMaskTool();
                  onClose();
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Use Region Mask Tool
              </button>
            </div>

            {errorMessage && (
              <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {errorMessage}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleRunRemoval}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isProcessing ? 'Stripping Watermarks...' : 'Remove Selected Watermarks'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleApplyNewWatermark} className="mt-5 space-y-4">
            <div>
              <label htmlFor="new-wm-text" className="block text-xs font-medium text-slate-700">
                Watermark Text
              </label>
              <input
                id="new-wm-text"
                type="text"
                value={newWatermarkText}
                onChange={(e) => setNewWatermarkText(e.target.value)}
                placeholder="CONFIDENTIAL - INTERNAL USE"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Orientation</label>
                <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setIsDiagonal(true)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                      isDiagonal ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Diagonal (38°)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDiagonal(false)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                      !isDiagonal ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Horizontal
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="wm-opacity-range" className="block text-xs font-medium text-slate-700 tabular-nums">
                  Opacity ({opacityPct}%)
                </label>
                <input
                  id="wm-opacity-range"
                  type="range"
                  min={8}
                  max={60}
                  value={opacityPct}
                  onChange={(e) => setOpacityPct(Number(e.target.value))}
                  className="mt-3 w-full accent-blue-700"
                />
              </div>
            </div>

            {errorMessage && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {errorMessage}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isProcessing ? 'Stamping Pages...' : 'Apply Watermark to All Pages'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
