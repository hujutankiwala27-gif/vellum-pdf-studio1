import React, { useEffect, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import {
  Camera,
  Check,
  Copy,
  FilePlus2,
  FileText,
  ImagePlus,
  MessageSquare,
  PenLine,
  ScanText,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AiPanelTab,
  AiSummaryResult,
  ExtractedTextSpan,
  PageTextData,
  PdfChatMessage,
  PhotoOcrResult,
} from '../types/pdfStudio';
import { extractCitedPageNumbers } from '../utils/pdfPureLogic';
import { renderPdfPageToDataUrl } from '../utils/pdfOperations';
import {
  answerPdfQuestionLocally,
  LocalOcrMode,
  rewriteTextLocally,
  runBrowserPhotoOcr,
  summarizePdfLocally,
} from '../utils/localDocumentIntelligence';

interface AiDocumentPanelProps {
  isOpen: boolean;
  activeTab: AiPanelTab;
  onTabChange: (tab: AiPanelTab) => void;
  onClose: () => void;
  pdfProxy: pdfjsLib.PDFDocumentProxy | null;
  documentTitle: string;
  pagesTextData: PageTextData[];
  activePage: number;
  selectedSpanForAi: { text: string; span: ExtractedTextSpan } | null;
  savedSummaryJson: string;
  onSaveSummaryJson: (summaryJson: string) => void;
  onApplyEditedTextToPage: (revisedText: string, targetSpan?: ExtractedTextSpan) => void;
  onCreateNewPdfFromText: (title: string, extractedText: string) => Promise<void>;
  onJumpToPage: (pageNumber: number) => void;
}

function readFileAsDataUrl(file: File): Promise<{
  dataUrl: string;
  base64: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve({
        dataUrl,
        base64,
        mimeType: file.type || 'image/png',
      });
    };
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

export const AiDocumentPanel: React.FC<AiDocumentPanelProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  pdfProxy,
  documentTitle,
  pagesTextData,
  activePage,
  selectedSpanForAi,
  savedSummaryJson,
  onSaveSummaryJson,
  onApplyEditedTextToPage,
  onCreateNewPdfFromText,
  onJumpToPage,
}) => {
  // 1. Multi-Turn PDF Chatbot State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<PdfChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatAttachment, setChatAttachment] = useState<{
    dataUrl: string;
    base64: string;
    mimeType: string;
    label: string;
    extractedText?: string;
  } | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // 2. Photo / Scanned Page OCR State (100% Free Browser WASM OCR)
  const [ocrImage, setOcrImage] = useState<{
    dataUrl: string;
    base64: string;
    mimeType: string;
    sourceLabel: string;
  } | null>(null);
  const [ocrMode, setOcrMode] = useState<LocalOcrMode>('verbatim');
  const [ocrResult, setOcrResult] = useState<PhotoOcrResult | null>(null);
  const [editableOcrText, setEditableOcrText] = useState('');
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ percent: number; status: string } | null>(null);
  const [isCreatingPdfFromOcr, setIsCreatingPdfFromOcr] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copiedOcr, setCopiedOcr] = useState(false);

  // 3. Summarizer State
  const [summaryLang, setSummaryLang] = useState<'english' | 'hinglish' | 'hindi'>('english');
  const [summaryMode, setSummaryMode] = useState<'executive' | 'action-items' | 'page-by-page'>(
    'executive'
  );
  const [summaryResult, setSummaryResult] = useState<AiSummaryResult | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // 4. AI Text Editor State
  const [editorSourceText, setEditorSourceText] = useState('');
  const [editAction, setEditAction] = useState<string>('improve');
  const [customInstruction, setCustomInstruction] = useState('');
  const [revisedOutput, setRevisedOutput] = useState<{
    revisedText: string;
    changeNotes: string;
  } | null>(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const ocrFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (savedSummaryJson) {
      try {
        setSummaryResult(JSON.parse(savedSummaryJson));
      } catch {
        setSummaryResult(null);
      }
    } else {
      setSummaryResult(null);
    }
  }, [savedSummaryJson, documentTitle]);

  // Reset chat thread when switching to a brand-new PDF document
  useEffect(() => {
    setChatMessages([]);
    setChatError(null);
  }, [documentTitle]);

  useEffect(() => {
    if (selectedSpanForAi?.text) {
      setEditorSourceText(selectedSpanForAi.text);
      setRevisedOutput(null);
      onTabChange('editor');
    }
  }, [selectedSpanForAi, onTabChange]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isSendingChat]);

  if (!isOpen) return null;

  const maxPages = Math.max(1, pagesTextData.length);

  // --- Chat Handlers ---
  const sendChatPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) {
      setChatError('Enter a question about this PDF or attached photo.');
      return;
    }

    const attachmentSnapshot = chatAttachment;
    const userMsg: PdfChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      attachedImageLabel: attachmentSnapshot?.label,
      createdAtIso: new Date().toISOString(),
    };

    setChatError(null);
    setChatInput('');
    setChatAttachment(null);
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSendingChat(true);

    try {
      let attachedImageText = attachmentSnapshot?.extractedText || '';
      if (attachmentSnapshot && !attachedImageText) {
        const scanned = await runBrowserPhotoOcr(attachmentSnapshot.dataUrl, 'verbatim');
        attachedImageText = scanned.extractedText;
      }

      const data = answerPdfQuestionLocally({
        documentTitle,
        pagesText: pagesTextData.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
        activePage,
        question: trimmed,
        attachedImageText: attachedImageText || undefined,
        attachedImageLabel: attachmentSnapshot?.label,
      });

      const rawAnswer = String(data.answer || '');
      const parsedCitations: number[] = Array.isArray(data.citedPages)
        ? data.citedPages.filter((n: unknown) => typeof n === 'number' && n >= 1 && n <= maxPages)
        : [];
      const fallbackCitations = extractCitedPageNumbers(rawAnswer, maxPages);
      const mergedCitations = Array.from(new Set([...parsedCitations, ...fallbackCitations])).sort(
        (a, b) => a - b
      );

      const assistantMsg: PdfChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        content: rawAnswer,
        citedPages: mergedCitations,
        followUpQuestions: data.followUpQuestions,
        createdAtIso: new Date().toISOString(),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to analyze PDF pages locally.');
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleAttachActivePdfPageToChat = async () => {
    if (!pdfProxy) return;
    try {
      setChatError(null);
      const rendered = await renderPdfPageToDataUrl(pdfProxy, activePage, 1.8);
      setChatAttachment({
        ...rendered,
        label: `Page ${activePage} Snapshot`,
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not capture active PDF page.');
    }
  };

  const handleAttachExternalPhotoToChat = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setChatError('Select a valid image file (PNG, JPG, WEBP).');
      return;
    }
    try {
      setChatError(null);
      const loaded = await readFileAsDataUrl(file);
      setChatAttachment({
        ...loaded,
        label: file.name.slice(0, 36),
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not read image.');
    }
  };

  // --- Photo OCR Handlers (100% Free Local Browser OCR) ---
  const executePhotoOcr = async (
    targetImage: { dataUrl: string; base64: string; mimeType: string; sourceLabel: string },
    selectedMode: LocalOcrMode = ocrMode
  ) => {
    setIsRunningOcr(true);
    setOcrError(null);
    setOcrProgress({ percent: 10, status: 'Starting free browser OCR...' });
    try {
      const result = await runBrowserPhotoOcr(
        targetImage.dataUrl,
        selectedMode,
        (percent, status) => {
          setOcrProgress({ percent, status });
        }
      );
      setOcrResult(result);
      setEditableOcrText(result.extractedText || '');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Failed to extract text from photo.');
    } finally {
      setIsRunningOcr(false);
      setOcrProgress(null);
    }
  };

  const handleSelectPhotoForOcr = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setOcrError('Please upload an image file (JPG, JPEG, PNG, or WEBP).');
      return;
    }
    try {
      setOcrError(null);
      const loaded = await readFileAsDataUrl(file);
      const nextImg = {
        ...loaded,
        sourceLabel: file.name,
      };
      setOcrImage(nextImg);
      await executePhotoOcr(nextImg, ocrMode);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Unable to load selected photo.');
    }
  };

  const handleScanCurrentPdfPageOcr = async () => {
    if (!pdfProxy) return;
    setIsRunningOcr(true);
    setOcrError(null);
    try {
      const rendered = await renderPdfPageToDataUrl(pdfProxy, activePage, 2.0);
      const nextImg = {
        ...rendered,
        sourceLabel: `${documentTitle} — Page ${activePage}`,
      };
      setOcrImage(nextImg);
      await executePhotoOcr(nextImg, ocrMode);
    } catch (err) {
      setIsRunningOcr(false);
      setOcrError(err instanceof Error ? err.message : 'Unable to scan active PDF page.');
    }
  };

  // --- Summarizer & Editor Handlers (100% Free Local Engine) ---
  const handleGenerateSummary = async () => {
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const data = summarizePdfLocally({
        documentTitle,
        pagesText: pagesTextData.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
        language: summaryLang,
        mode: summaryMode,
      });
      setSummaryResult(data);
      onSaveSummaryJson(JSON.stringify(data));
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Unable to summarize document.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleLoadActivePageIntoEditor = () => {
    const found = pagesTextData.find((p) => p.pageNumber === activePage);
    if (found?.text) {
      setEditorSourceText(found.text.slice(0, 1200));
      setEditorError(null);
    }
  };

  const handleRunAiEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editorSourceText.trim()) {
      setEditorError('Enter or select PDF text before running Text Rewriter.');
      return;
    }
    setIsEditingText(true);
    setEditorError(null);
    try {
      const data = rewriteTextLocally(editorSourceText, editAction, customInstruction);
      setRevisedOutput(data);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Failed to edit text.');
    } finally {
      setIsEditingText(false);
    }
  };

  const handleCopySummary = () => {
    if (!summaryResult) return;
    const text = [
      summaryResult.headline,
      '',
      summaryResult.executiveOverview,
      '',
      'Key Takeaways:',
      ...summaryResult.keyTakeaways.map((t) => `- ${t}`),
      '',
      'Action Items:',
      ...summaryResult.actionItems.map((a) => `- ${a}`),
    ].join('\n');
    void navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 1800);
  };

  const ocrWordCount = editableOcrText.trim()
    ? editableOcrText.trim().split(/\s+/).length
    : 0;

  const latestAssistantMsg = [...chatMessages]
    .reverse()
    .find((m) => m.role === 'assistant');

  return (
    <aside
      aria-label="AI Document Studio"
      onPaste={(e) => {
        if (activeTab !== 'ocr') return;
        const item = Array.from(e.clipboardData.items).find((it) =>
          it.type.startsWith('image/')
        );
        const file = item?.getAsFile();
        if (file) {
          e.preventDefault();
          void handleSelectPhotoForOcr(file);
        }
      }}
      className="fixed inset-0 z-40 flex h-full w-full flex-col bg-white lg:static lg:z-auto lg:w-[410px] lg:shrink-0 lg:border-l lg:border-slate-200"
    >
      {/* Hidden File Inputs for Photo OCR & Chat Vision */}
      <input
        ref={ocrFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) void handleSelectPhotoForOcr(picked);
        }}
        className="hidden"
      />
      <input
        ref={chatPhotoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) void handleAttachExternalPhotoToChat(picked);
        }}
        className="hidden"
      />

      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Smart Document Assistant</h2>
          <p className="truncate text-xs text-slate-500">
            100% Free Browser Engine · PDF Chat · OCR · Summary
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Document Assistant"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 4 Single-Line Functional Tabs */}
      <div className="border-b border-slate-200 px-3 py-2">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
            { id: 'ocr' as const, label: 'Photo OCR', icon: ScanText },
            { id: 'summary' as const, label: 'Summary', icon: FileText },
            { id: 'editor' as const, label: 'Edit', icon: PenLine },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeTab === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* TAB 1: DIRECT PDF-GROUNDED CHATBOT */}
        {activeTab === 'chat' && (
          <div className="flex h-full min-h-0 flex-col justify-between">
            {/* Scrollable Messages Viewport */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="truncate">
                  Grounded on <strong className="font-semibold text-slate-800">{maxPages}p</strong> · Viewing p.{activePage}
                </span>
                {chatMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setChatMessages([]);
                      setChatError(null);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {chatMessages.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      Ask anything directly from this PDF
                    </p>
                    <p className="mt-1 leading-relaxed text-slate-600">
                      Reads all {maxPages} pages, cites exact page numbers, and answers in English, Hinglish, or Hindi. You can also attach a photo or current page snapshot below.
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <p className="text-[11px] font-medium text-slate-500">Quick prompts:</p>
                    {[
                      'What is the total budget allocation across all workstreams?',
                      'Is PDF me main deadlines aur security rules kya hain?',
                      `Explain the key details on Page ${activePage} in bullet points.`,
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => void sendChatPrompt(preset)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-800 hover:border-blue-600 hover:bg-blue-50/30 transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg p-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'ml-6 bg-slate-900 text-white'
                        : 'mr-2 border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    {msg.attachedImageLabel && (
                      <p className="mb-1.5 text-[11px] font-mono opacity-80">
                        Attached: {msg.attachedImageLabel}
                      </p>
                    )}
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                    {msg.role === 'assistant' && (
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {msg.citedPages && msg.citedPages.length > 0 ? (
                            msg.citedPages.map((pNum) => (
                              <button
                                key={pNum}
                                type="button"
                                onClick={() => onJumpToPage(pNum)}
                                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-mono font-medium text-blue-700 hover:border-blue-600 hover:bg-blue-50 tabular-nums whitespace-nowrap shrink-0"
                              >
                                Page {pNum}
                              </button>
                            ))
                          ) : (
                            <span className="text-[11px] text-slate-400">PDF grounded</span>
                          )}
                        </div>

                        <button
                          type="button"
                          aria-label="Copy assistant answer"
                          onClick={() => {
                            void navigator.clipboard.writeText(msg.content);
                            setCopiedMsgId(msg.id);
                            setTimeout(() => setCopiedMsgId(null), 1500);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap shrink-0"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Clickable Follow-up Suggestions from Latest Assistant Reply */}
              {!isSendingChat &&
                latestAssistantMsg?.followUpQuestions &&
                latestAssistantMsg.followUpQuestions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[11px] font-medium text-slate-500">Suggested follow-ups:</p>
                    {latestAssistantMsg.followUpQuestions.map((followUp, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => void sendChatPrompt(followUp)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 hover:border-blue-600 transition-colors"
                      >
                        {followUp}
                      </button>
                    ))}
                  </div>
                )}

              {isSendingChat && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 animate-pulse">
                  Reading PDF pages and preparing answer...
                </div>
              )}

              {chatError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
                >
                  {chatError}
                </p>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chat Composer with Visual Page / Photo Attachment */}
            <div className="border-t border-slate-200 bg-white p-3 space-y-2">
              {chatAttachment && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-1.5 text-xs text-slate-800">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src={chatAttachment.dataUrl}
                      alt={chatAttachment.label}
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 shrink-0 rounded object-cover border border-slate-300 bg-white"
                    />
                    <span className="truncate font-medium">{chatAttachment.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChatAttachment(null)}
                    aria-label="Remove attached image"
                    className="rounded p-0.5 text-slate-500 hover:text-slate-900"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!pdfProxy}
                  onClick={() => void handleAttachActivePdfPageToChat()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Camera className="h-3 w-3 text-blue-600" />
                  <span>Attach Page {activePage}</span>
                </button>
                <button
                  type="button"
                  onClick={() => chatPhotoInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  <ImagePlus className="h-3 w-3 text-slate-600" />
                  <span>Attach Photo</span>
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChatPrompt(chatInput);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  aria-label="Ask AI chatbot about the PDF"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything from this PDF (Hindi / English)..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSendingChat}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: PHOTO / SCANNED PAGE OCR & TEXT GENERATOR */}
        {activeTab === 'ocr' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Photo & Scanned Page Text Reader (OCR)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                Upload or paste any photo (JPG, PNG, camera scan, notes, invoice) or scan the active PDF page to extract clean, editable text.
              </p>
            </div>

            {/* Extraction Mode */}
            <div>
              <label htmlFor="photo-ocr-mode" className="block text-xs font-medium text-slate-700">
                Reading & Extraction Mode
              </label>
              <select
                id="photo-ocr-mode"
                value={ocrMode}
                onChange={(e) => {
                  const nextMode = e.target.value as LocalOcrMode;
                  setOcrMode(nextMode);
                  if (ocrImage) {
                    void executePhotoOcr(ocrImage, nextMode);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="verbatim">Exact Verbatim Text (100% Faithful OCR)</option>
                <option value="structured">Structured Headings, Key Fields & Tables</option>
                <option value="clean-paragraphs">Clean Reflowed Paragraphs (Fix Line Wraps)</option>
                <option value="bilingual-hin-eng">Hindi + English Script OCR (हिंदी + English)</option>
              </select>
            </div>

            {/* Primary Upload Photo + Scan Current PDF Page Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isRunningOcr}
                onClick={() => ocrFileInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Upload Photo</span>
              </button>

              <button
                type="button"
                disabled={isRunningOcr || !pdfProxy}
                onClick={() => void handleScanCurrentPdfPageOcr()}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <ScanText className="h-3.5 w-3.5 text-blue-700" />
                <span>Read Page {activePage}</span>
              </button>
            </div>

            {/* Dropzone when no image is loaded */}
            {!ocrImage && !isRunningOcr && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleSelectPhotoForOcr(file);
                }}
                className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center"
              >
                <Camera className="mx-auto h-6 w-6 text-slate-400" />
                <p className="mt-2 text-xs font-medium text-slate-700">
                  Drop a photo here or press Ctrl+V to paste a screenshot
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Supports printed pages, handwritten notes, tables, Hindi & English
                </p>
              </div>
            )}

            {/* Loaded Image Preview */}
            {ocrImage && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-700">
                    {ocrImage.sourceLabel}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isRunningOcr}
                      onClick={() => void executePhotoOcr(ocrImage, ocrMode)}
                      className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      Re-scan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOcrImage(null);
                        setOcrResult(null);
                        setEditableOcrText('');
                      }}
                      aria-label="Clear scanned image"
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="max-h-36 overflow-hidden rounded border border-slate-200 bg-white flex items-center justify-center">
                  <img
                    src={ocrImage.dataUrl}
                    alt={ocrImage.sourceLabel}
                    referrerPolicy="no-referrer"
                    className="max-h-36 w-auto object-contain"
                  />
                </div>
              </div>
            )}

            {isRunningOcr && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {ocrProgress?.status || 'Running free in-browser OCR...'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 shrink-0">
                    {ocrProgress?.percent ?? 15}%
                  </span>
                </div>
                <progress
                  value={Math.max(8, ocrProgress?.percent ?? 15)}
                  max={100}
                  aria-label="OCR progress"
                  className="h-1.5 w-full overflow-hidden rounded-full accent-blue-600"
                />
              </div>
            )}

            {ocrError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                {ocrError}
              </p>
            )}

            {/* Extracted Text Result & End-to-End Actions */}
            {(ocrResult || editableOcrText) && !isRunningOcr && (
              <div className="space-y-3 border-t border-slate-200 pt-3">
                {ocrResult && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">
                        {ocrResult.documentType} · {ocrResult.detectedLanguage}
                      </span>
                      <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                        {ocrWordCount} words
                      </span>
                    </div>
                    {ocrResult.summaryNote && (
                      <p className="text-xs text-slate-600">{ocrResult.summaryNote}</p>
                    )}
                  </div>
                )}

                <textarea
                  rows={8}
                  aria-label="Extracted text from photo"
                  value={editableOcrText}
                  onChange={(e) => setEditableOcrText(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs leading-relaxed text-slate-900 focus:border-blue-700 focus:outline-none"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(editableOcrText);
                      setCopiedOcr(true);
                      setTimeout(() => setCopiedOcr(false), 1600);
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    {copiedOcr ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copiedOcr ? 'Copied Text' : 'Copy Text'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onApplyEditedTextToPage(editableOcrText)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <PenLine className="h-3.5 w-3.5 text-blue-700" />
                    <span>Place on Page {activePage}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isCreatingPdfFromOcr || !editableOcrText.trim()}
                    onClick={async () => {
                      setIsCreatingPdfFromOcr(true);
                      try {
                        const baseLabel =
                          ocrImage?.sourceLabel.replace(/\.[^.]+$/, '') || 'Scanned_Photo_Text';
                        await onCreateNewPdfFromText(`${baseLabel}_OCR.pdf`, editableOcrText);
                      } finally {
                        setIsCreatingPdfFromOcr(false);
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    <span>{isCreatingPdfFromOcr ? 'Building PDF...' : 'Open as New PDF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (ocrImage) {
                        setChatAttachment({
                          dataUrl: ocrImage.dataUrl,
                          base64: ocrImage.base64,
                          mimeType: ocrImage.mimeType,
                          label: ocrImage.sourceLabel.slice(0, 32),
                          extractedText: editableOcrText,
                        });
                      }
                      onTabChange('chat');
                      setChatInput('Summarize the key points from this scanned photo.');
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Ask in Chat</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DOCUMENT SUMMARIZER */}
        {activeTab === 'summary' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ai-summary-mode" className="block text-xs font-medium text-slate-700">
                  Summary Depth
                </label>
                <select
                  id="ai-summary-mode"
                  value={summaryMode}
                  onChange={(e) => setSummaryMode(e.target.value as typeof summaryMode)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="executive">Executive Brief</option>
                  <option value="action-items">Action Items & Risks</option>
                  <option value="page-by-page">Page Breakdown</option>
                </select>
              </div>
              <div>
                <label htmlFor="ai-summary-lang" className="block text-xs font-medium text-slate-700">
                  Output Language
                </label>
                <select
                  id="ai-summary-lang"
                  value={summaryLang}
                  onChange={(e) => setSummaryLang(e.target.value as typeof summaryLang)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  <option value="english">English</option>
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">Hindi (हिंदी)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={isSummarizing || pagesTextData.length === 0}
              onClick={handleGenerateSummary}
              className="w-full rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isSummarizing ? 'Analyzing PDF Pages...' : 'Generate Document Summary'}
            </button>

            {summaryError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                {summaryError}
              </p>
            )}

            {summaryResult ? (
              <div className="space-y-4 border-t border-slate-200 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                    {summaryResult.headline}
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    aria-label="Copy summary to clipboard"
                    className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    {copiedSummary ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedSummary ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <p className="text-xs leading-relaxed text-slate-700">
                  {summaryResult.executiveOverview}
                </p>

                <div>
                  <h4 className="text-xs font-semibold text-slate-900">Key Takeaways</h4>
                  <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                    {summaryResult.keyTakeaways.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                {summaryResult.actionItems.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">Action Items</h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                      {summaryResult.actionItems.map((item, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summaryResult.pageHighlights.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">Page Highlights</h4>
                    <div className="mt-2 divide-y divide-slate-200 border-t border-b border-slate-200">
                      {summaryResult.pageHighlights.map((ph, idx) => (
                        <div key={idx} className="py-2.5">
                          <button
                            type="button"
                            onClick={() => onJumpToPage(ph.pageNumber)}
                            className="text-xs font-mono font-medium text-blue-700 hover:underline tabular-nums"
                          >
                            Page {ph.pageNumber}
                          </button>
                          <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                            {ph.summary}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              !isSummarizing && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  Click <span className="font-semibold text-slate-800">Generate Document Summary</span> to synthesize all {pagesTextData.length} pages into executive takeaways, action items, and clickable page citations.
                </div>
              )
            )}
          </div>
        )}

        {/* TAB 4: AI DIRECT PDF TEXT EDITOR */}
        {activeTab === 'editor' && (
          <form onSubmit={handleRunAiEdit} className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label htmlFor="ai-editor-source" className="text-xs font-medium text-slate-700">
                Source Passage
              </label>
              <button
                type="button"
                onClick={handleLoadActivePageIntoEditor}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
              >
                Load Page {activePage} Text
              </button>
            </div>

            <textarea
              id="ai-editor-source"
              rows={4}
              value={editorSourceText}
              onChange={(e) => {
                setEditorSourceText(e.target.value);
                setEditorError(null);
              }}
              placeholder="Click any line on the PDF with the Text Edit tool, or paste text here..."
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />

            <div>
              <label htmlFor="ai-edit-action" className="block text-xs font-medium text-slate-700">
                Rewrite Style
              </label>
              <select
                id="ai-edit-action"
                value={editAction}
                onChange={(e) => setEditAction(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="improve">Improve Clarity & Spacing</option>
                <option value="shorten">Condense & Shorten</option>
                <option value="bullets">Convert to Bullet Points</option>
                <option value="formal">Executive / Legal Formal</option>
                <option value="simplify">Plain & Simple Language</option>
                <option value="grammar">Fix Grammar & Typos</option>
                <option value="titlecase">Title Case</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="custom">Custom Instruction (e.g. replace X with Y)</option>
              </select>
            </div>

            {editAction === 'custom' && (
              <div>
                <label htmlFor="ai-custom-prompt" className="block text-xs font-medium text-slate-700">
                  Custom Editing Instruction
                </label>
                <input
                  id="ai-custom-prompt"
                  type="text"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  placeholder='e.g. replace "Draft" with "Approved"'
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isEditingText}
              className="w-full rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isEditingText ? 'Formatting Passage...' : 'Rewrite & Format Text'}
            </button>

            {editorError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                {editorError}
              </p>
            )}

            {revisedOutput && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">{revisedOutput.changeNotes}</p>
                <textarea
                  rows={5}
                  aria-label="AI revised text output"
                  value={revisedOutput.revisedText}
                  onChange={(e) =>
                    setRevisedOutput((prev) =>
                      prev ? { ...prev, revisedText: e.target.value } : null
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onApplyEditedTextToPage(
                        revisedOutput.revisedText,
                        selectedSpanForAi?.span
                      )
                    }
                    className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {selectedSpanForAi ? 'Replace Selected PDF Text' : `Place on Page ${activePage}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(revisedOutput.revisedText)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </aside>
  );
};
