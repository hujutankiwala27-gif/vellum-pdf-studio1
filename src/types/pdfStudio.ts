export enum ActiveWorkspaceTab {
  VIEWER = 'viewer',
  CONVERTER = 'converter',
  ORGANIZER = 'organizer',
  CLOUD_LIBRARY = 'cloud_library',
}

export enum AnnotationTool {
  SELECT = 'select',
  HIGHLIGHT = 'highlight',
  UNDERLINE = 'underline',
  STRIKETHROUGH = 'strikethrough',
  INK = 'ink',
  TEXT_EDIT = 'text_edit',
  NOTE = 'note',
  RECT = 'rect',
  REDACT = 'redact',
  STAMP = 'stamp',
  SIGNATURE = 'signature',
  WATERMARK_MASK = 'watermark_mask',
}

export enum ReadingTheme {
  LIGHT = 'light',
  SEPIA = 'sepia',
  DARK = 'dark',
  INVERT = 'invert',
}

export enum PageLayoutMode {
  CONTINUOUS = 'continuous',
  SINGLE = 'single',
  DUAL = 'dual',
}

export type ExportFormat =
  | 'docx'
  | 'doc'
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'txt'
  | 'md'
  | 'html'
  | 'csv';

export type StampPreset = 'APPROVED' | 'CONFIDENTIAL' | 'FINAL' | 'REVIEWED' | 'VOID';

export interface NormalizedPoint {
  x: number; // 0..1 relative to page width
  y: number; // 0..1 relative to page height (from top)
}

export interface PdfAnnotation {
  id: string;
  pageNumber: number; // 1-indexed
  type:
    | 'highlight'
    | 'underline'
    | 'strikethrough'
    | 'ink'
    | 'text_edit'
    | 'note'
    | 'rect'
    | 'redact'
    | 'stamp'
    | 'signature'
    | 'watermark_mask';
  x: number; // 0..1 from left
  y: number; // 0..1 from top
  width: number; // 0..1
  height: number; // 0..1
  color: string; // hex e.g. #FACC15
  strokeWidth?: number;
  points?: NormalizedPoint[]; // for ink
  text?: string; // for text_edit, note, or stamp label
  originalText?: string; // when replacing existing PDF text in-place
  coverBackground?: boolean; // whiteout original text behind replacement
  fontSize?: number; // PDF points
  signatureDataUrl?: string; // PNG data URL for drawn signature
  applyToAllPages?: boolean; // used by watermark_mask
  createdAt: string;
}

export interface ExtractedTextSpan {
  id: string;
  pageNumber: number;
  str: string;
  x: number; // 0..1 from left
  y: number; // 0..1 from top
  width: number; // 0..1
  height: number; // 0..1
  fontSize: number;
  angleDeg: number;
}

export interface PageTextData {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  text: string;
  spans: ExtractedTextSpan[];
}

export interface DetectedWatermarkCandidate {
  id: string;
  text: string;
  occurrences: number;
  pagesAffected: number[];
  isDiagonal: boolean;
  confidence: 'high' | 'medium';
  sampleBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AiSummaryResult {
  headline: string;
  executiveOverview: string;
  keyTakeaways: string[];
  actionItems: string[];
  pageHighlights: { pageNumber: number; summary: string }[];
}

export interface StudioDocumentMeta {
  id: string;
  title: string;
  pageCount: number;
  fileSizeBytes: number;
  chunkCount: number;
  watermarkRemoved: boolean;
  annotations: PdfAnnotation[];
  aiSummary: string;
  starred: boolean;
  storageLocation: 'local' | 'cloud' | 'synced';
  driveFileId?: string;
  driveWebViewLink?: string;
  updatedAtIso: string;
  createdAtIso: string;
}

export type AiPanelTab = 'chat' | 'ocr' | 'summary' | 'editor';

export interface PdfSearchMatch {
  id: string;
  index: number; // 0-indexed global match order
  pageNumber: number; // 1-indexed page number
  spanId: string;
  matchedText: string;
  prefix: string;
  suffix: string;
  x: number; // normalized 0..1 sub-span left
  y: number; // normalized 0..1 top
  width: number; // normalized 0..1 sub-span width
  height: number; // normalized 0..1 height
  angleDeg?: number; // rotation angle in degrees when highlighting angled spans
}

export interface PhotoOcrResult {
  extractedText: string;
  detectedLanguage: string;
  documentType: string;
  summaryNote: string;
}

export interface PdfChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citedPages?: number[];
  followUpQuestions?: string[];
  attachedImageLabel?: string;
  createdAtIso: string;
}

export interface ConversionHistoryItem {
  id: string;
  sourceTitle: string;
  targetFormat: ExportFormat | 'pdf';
  pageCount: number;
  outputSizeBytes: number;
  createdAtIso: string;
}
