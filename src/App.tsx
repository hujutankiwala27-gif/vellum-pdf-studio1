import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type * as pdfjsLib from 'pdfjs-dist';
import {
  CheckCircle2,
  Download,
  FileOutput,
  FileText,
  FolderKanban,
  FolderOpen,
  HardDriveUpload,
  LayoutGrid,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './firebase';
import {
  ActiveWorkspaceTab,
  AiPanelTab,
  AnnotationTool,
  ConversionHistoryItem,
  DetectedWatermarkCandidate,
  ExportFormat,
  ExtractedTextSpan,
  PageTextData,
  PdfAnnotation,
  StudioDocumentMeta,
} from './types/pdfStudio';
import {
  detectWatermarkCandidates,
  ensurePdfExtension,
  formatFileSize,
  normalizePdfBinaryBytes,
} from './utils/pdfPureLogic';
import {
  addWatermarkOverlayStream,
  generateSampleEnterprisePdf,
} from './utils/samplePdfGenerator';
import {
  bakeAnnotationsIntoPdf,
  createPdfBytesFromExtractedText,
  extractPagesTextData,
  loadPdfProxy,
  removeWatermarksFromPdfBytes,
} from './utils/pdfOperations';
import {
  convertExternalFilesToPdf,
  triggerBrowserDownload,
} from './utils/formatConverter';
import {
  deleteLocalDocument,
  deletePdfFromGoogleDrive,
  downloadPdfFromGoogleDrive,
  listGoogleDrivePdfs,
  listLocalConversionHistory,
  listLocalDocumentsMeta,
  loadLocalPdfBinary,
  recordConversionLog,
  saveLocalDocumentMeta,
  saveLocalPdfBinary,
  savePdfToGoogleDrive,
} from './services/storageService';
import { PdfViewerWorkspace } from './components/PdfViewerWorkspace';
import { AiDocumentPanel } from './components/AiDocumentPanel';
import { FormatConverterView } from './components/FormatConverterView';
import { PageOrganizerView } from './components/PageOrganizerView';
import { CloudLibraryView } from './components/CloudLibraryView';
import { WatermarkStudioModal } from './components/WatermarkStudioModal';
import { SignaturePadModal } from './components/SignaturePadModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { DriveActionModal, DriveModalState } from './components/DriveActionModal';
import { PdfPasswordModal } from './components/PdfPasswordModal';

const SAMPLE_DOC_ID = 'doc_project_horizon_sample';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>(ActiveWorkspaceTab.VIEWER);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Google Account & User-Owned Google Drive State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [localDocs, setLocalDocs] = useState<StudioDocumentMeta[]>([]);
  const [driveDocs, setDriveDocs] = useState<StudioDocumentMeta[]>([]);
  const [conversionHistory, setConversionHistory] = useState<ConversionHistoryItem[]>([]);
  const [isSavingDrive, setIsSavingDrive] = useState(false);
  const [driveModalState, setDriveModalState] = useState<DriveModalState>(null);

  // Active PDF Document State
  const [activeDocMeta, setActiveDocMeta] = useState<StudioDocumentMeta | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfProxy, setPdfProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pagesTextData, setPagesTextData] = useState<PageTextData[]>([]);
  const [activePage, setActivePage] = useState<number>(1);

  // Undo / Redo Annotation History
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [undoStack, setUndoStack] = useState<PdfAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<PdfAnnotation[][]>([]);

  // Tool & Modal State
  const [activeTool, setActiveTool] = useState<AnnotationTool>(AnnotationTool.SELECT);
  const [isWatermarkModalOpen, setIsWatermarkModalOpen] = useState(false);
  const [isProcessingWatermark, setIsProcessingWatermark] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<{
    dataUrl: string;
    label: string;
  } | null>(null);

  // AI Studio Panel State
  const [isAiPanelOpen, setIsAiPanelOpen] = useState<boolean>(false);
  const [activeAiTab, setActiveAiTab] = useState<AiPanelTab>('chat');
  const [selectedSpanForAi, setSelectedSpanForAi] = useState<{
    text: string;
    span: ExtractedTextSpan;
  } | null>(null);

  // Status Banner, Password Unlock & Drag Drop
  const [statusBanner, setStatusBanner] = useState<{
    type: 'info' | 'error';
    message: string;
  } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingPasswordPrompt, setPendingPasswordPrompt] = useState<{
    meta: StudioDocumentMeta;
    bytes: Uint8Array;
    preserveAnnotations?: PdfAnnotation[];
    incorrectAttempt: boolean;
  } | null>(null);
  const [isUnlockingPdf, setIsUnlockingPdf] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeProxyRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const watermarkCandidates: DetectedWatermarkCandidate[] =
    detectWatermarkCandidates(pagesTextData);

  useEffect(() => {
    if (!statusBanner || statusBanner.type !== 'info') return;
    const timer = setTimeout(() => setStatusBanner(null), 4800);
    return () => clearTimeout(timer);
  }, [statusBanner]);

  const refreshLocalVaultLists = useCallback(async () => {
    const [docs, convs] = await Promise.all([
      listLocalDocumentsMeta(),
      listLocalConversionHistory(),
    ]);
    setLocalDocs(docs);
    setConversionHistory(convs);
  }, []);

  const refreshGoogleDriveFiles = useCallback(async (tokenOverride?: string | null) => {
    const token = tokenOverride ?? (await getAccessToken());
    if (!token) {
      setDriveDocs([]);
      return;
    }
    try {
      const files = await listGoogleDrivePdfs(token);
      setDriveDocs(files);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setDriveAccessToken(null);
      }
      console.error('Google Drive list error:', err);
    }
  }, []);

  // Hydrate PDF bytes into PDF.js proxy + coordinate text extractor
  const mountPdfIntoEngine = useCallback(
    async (
      meta: StudioDocumentMeta,
      rawInputBytes: Uint8Array,
      preserveAnnotations?: PdfAnnotation[],
      password?: string
    ) => {
      const normalized = normalizePdfBinaryBytes(rawInputBytes);
      const bytes = normalized.isPdf ? normalized.bytes : rawInputBytes;

      let proxy: pdfjsLib.PDFDocumentProxy;
      try {
        proxy = await loadPdfProxy(bytes, password);
      } catch (err) {
        const errObj = err as { name?: string; code?: number; message?: string };
        if (errObj?.name === 'PasswordException') {
          setPendingPasswordPrompt({
            meta,
            bytes,
            preserveAnnotations,
            incorrectAttempt: Boolean(password),
          });
          setStatusBanner(null);
          return;
        }
        throw err;
      }

      if (activeProxyRef.current) {
        try {
          const prev = activeProxyRef.current as unknown as {
            destroy?: () => Promise<void>;
            cleanup?: () => Promise<void>;
          };
          await (prev.destroy ? prev.destroy() : prev.cleanup?.());
        } catch {
          // ignore
        }
      }

      activeProxyRef.current = proxy;
      setPendingPasswordPrompt(null);

      const updatedMeta: StudioDocumentMeta = {
        ...meta,
        pageCount: proxy.numPages,
        fileSizeBytes: bytes.byteLength,
        annotations: preserveAnnotations ?? meta.annotations,
        updatedAtIso: new Date().toISOString(),
      };

      setPdfBytes(bytes);
      setPdfProxy(proxy);
      setActiveDocMeta(updatedMeta);
      setAnnotations(updatedMeta.annotations);
      setUndoStack([]);
      setRedoStack([]);
      setActivePage(1);

      const extracted = await extractPagesTextData(proxy);
      setPagesTextData(extracted);

      await saveLocalPdfBinary(updatedMeta.id, bytes);
      await saveLocalDocumentMeta(updatedMeta);
      await refreshLocalVaultLists();
    },
    [refreshLocalVaultLists]
  );

  // Initialize Firebase Auth & in-memory Google Drive OAuth token listener
  useEffect(() => {
    const unsub = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setDriveAccessToken(token);
        void refreshGoogleDriveFiles(token);
      },
      (user) => {
        setCurrentUser(user ?? null);
        setDriveAccessToken(null);
        setDriveDocs([]);
      }
    );
    return () => unsub();
  }, [refreshGoogleDriveFiles]);

  // Boot initial document (loads from local vault or generates deterministic 4-page sample PDF)
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      const existingLocal = await listLocalDocumentsMeta();
      const convs = await listLocalConversionHistory();
      if (!mounted) return;
      setLocalDocs(existingLocal);
      setConversionHistory(convs);

      if (existingLocal.length > 0) {
        const first = existingLocal[0];
        const bin = await loadLocalPdfBinary(first.id);
        if (bin && mounted) {
          await mountPdfIntoEngine(first, bin, first.annotations);
          return;
        }
      }

      const sampleBytes = await generateSampleEnterprisePdf();
      if (!mounted) return;
      const now = new Date().toISOString();
      const sampleMeta: StudioDocumentMeta = {
        id: SAMPLE_DOC_ID,
        title: 'Project_Horizon_Enterprise_Proposal.pdf',
        pageCount: 4,
        fileSizeBytes: sampleBytes.byteLength,
        chunkCount: 0,
        watermarkRemoved: false,
        annotations: [],
        aiSummary: '',
        starred: true,
        storageLocation: 'local',
        createdAtIso: now,
        updatedAtIso: now,
      };
      await mountPdfIntoEngine(sampleMeta, sampleBytes, []);
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [mountPdfIntoEngine]);

  // Persist annotation updates into activeDocMeta & local IndexedDB
  const persistAnnotationsUpdate = useCallback(
    async (nextAnnotations: PdfAnnotation[]) => {
      setAnnotations(nextAnnotations);
      if (!activeDocMeta) return;
      const nextMeta: StudioDocumentMeta = {
        ...activeDocMeta,
        annotations: nextAnnotations,
        updatedAtIso: new Date().toISOString(),
      };
      setActiveDocMeta(nextMeta);
      await saveLocalDocumentMeta(nextMeta);
      await refreshLocalVaultLists();
    },
    [activeDocMeta, refreshLocalVaultLists]
  );

  const handleAddAnnotation = (ann: PdfAnnotation) => {
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    const next = [...annotations, ann];
    void persistAnnotationsUpdate(next);
  };

  const handleUpdateAnnotation = (id: string, patch: Partial<PdfAnnotation>) => {
    const next = annotations.map((a) => (a.id === id ? { ...a, ...patch } : a));
    void persistAnnotationsUpdate(next);
  };

  const handleDeleteAnnotation = (id: string) => {
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    const next = annotations.filter((a) => a.id !== id);
    void persistAnnotationsUpdate(next);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setUndoStack((u) => u.slice(0, -1));
    void persistAnnotationsUpdate(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const restored = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, annotations]);
    setRedoStack((r) => r.slice(0, -1));
    void persistAnnotationsUpdate(restored);
  };

  // Open any PDF (standard, CMYK/ICC, PDF/A, PDF/X, WhatsApp octet-stream, password-locked) or image file
  const handleLoadUploadedFile = async (file: File) => {
    setStatusBanner({ type: 'info', message: `Opening ${file.name}...` });
    try {
      const arrayBuf = await file.arrayBuffer();
      const rawBytes = new Uint8Array(arrayBuf);
      const pdfCheck = normalizePdfBinaryBytes(rawBytes);

      let finalBytes = pdfCheck.bytes;
      let finalTitle = ensurePdfExtension(file.name.slice(0, 236));

      if (!pdfCheck.isPdf) {
        const lowerName = file.name.toLowerCase();
        const isConvertibleFile =
          file.type.startsWith('image/') ||
          /\.(png|jpe?g|webp|bmp|txt|md)$/i.test(lowerName);

        if (isConvertibleFile) {
          const converted = await convertExternalFilesToPdf([file]);
          finalBytes = converted.pdfBytes;
          finalTitle = converted.title;
        } else if (
          !lowerName.endsWith('.pdf') &&
          file.type !== 'application/pdf' &&
          file.type !== 'application/x-pdf'
        ) {
          setStatusBanner({
            type: 'error',
            message:
              'Selected file is not a valid PDF or supported image (.pdf, .png, .jpg, .webp).',
          });
          return;
        }
      }

      const now = new Date().toISOString();
      const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newMeta: StudioDocumentMeta = {
        id: docId,
        title: finalTitle,
        pageCount: 1,
        fileSizeBytes: finalBytes.byteLength,
        chunkCount: 0,
        watermarkRemoved: false,
        annotations: [],
        aiSummary: '',
        starred: false,
        storageLocation: 'local',
        createdAtIso: now,
        updatedAtIso: now,
      };
      await mountPdfIntoEngine(newMeta, finalBytes, []);
      setActiveTab(ActiveWorkspaceTab.VIEWER);
      setStatusBanner(null);
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to parse PDF file.',
      });
    }
  };

  const handleUnlockPasswordProtectedPdf = async (password: string) => {
    if (!pendingPasswordPrompt) return;
    setIsUnlockingPdf(true);
    try {
      await mountPdfIntoEngine(
        pendingPasswordPrompt.meta,
        pendingPasswordPrompt.bytes,
        pendingPasswordPrompt.preserveAnnotations,
        password
      );
      setActiveTab(ActiveWorkspaceTab.VIEWER);
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to unlock PDF file.',
      });
    } finally {
      setIsUnlockingPdf(false);
    }
  };

  const handleExportEditedPdf = async () => {
    if (!pdfBytes || !activeDocMeta) return;
    try {
      const baked = await bakeAnnotationsIntoPdf(pdfBytes, annotations);
      const blobCopy = new Uint8Array(baked.byteLength);
      blobCopy.set(baked);
      const blob = new Blob([blobCopy], { type: 'application/pdf' });
      const outName = activeDocMeta.title.endsWith('.pdf')
        ? activeDocMeta.title
        : `${activeDocMeta.title}.pdf`;
      triggerBrowserDownload(blob, outName);
      setStatusBanner({
        type: 'info',
        message: `Downloaded ${outName} (${formatFileSize(baked.byteLength)}) with all edits embedded.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to export edited PDF.',
      });
    }
  };

  // Watermark Removal & Stamping Handlers
  const handleRemoveWatermarks = async (targetPhrases: string[]) => {
    if (!pdfBytes || !activeDocMeta) return;
    setIsProcessingWatermark(true);
    try {
      const { cleanedBytes, removedStreamsCount } = await removeWatermarksFromPdfBytes(
        pdfBytes,
        targetPhrases,
        pagesTextData
      );
      const nextMeta: StudioDocumentMeta = {
        ...activeDocMeta,
        watermarkRemoved: true,
        updatedAtIso: new Date().toISOString(),
      };
      await mountPdfIntoEngine(nextMeta, cleanedBytes, annotations);
      setIsWatermarkModalOpen(false);
      setStatusBanner({
        type: 'info',
        message:
          removedStreamsCount > 0
            ? `Stripped watermark from ${removedStreamsCount} page stream(s) cleanly.`
            : 'Cleaned target watermark layer from document.',
      });
    } finally {
      setIsProcessingWatermark(false);
    }
  };

  const handleAddWatermark = async (
    text: string,
    diagonal: boolean,
    opacity: number
  ) => {
    if (!pdfBytes || !activeDocMeta) return;
    setIsProcessingWatermark(true);
    try {
      const stampedBytes = await addWatermarkOverlayStream(pdfBytes, text, {
        diagonal,
        opacity,
      });
      const nextMeta: StudioDocumentMeta = {
        ...activeDocMeta,
        watermarkRemoved: false,
        updatedAtIso: new Date().toISOString(),
      };
      await mountPdfIntoEngine(nextMeta, stampedBytes, annotations);
      setIsWatermarkModalOpen(false);
      setStatusBanner({
        type: 'info',
        message: `Applied "${text}" watermark across all ${nextMeta.pageCount} pages.`,
      });
    } finally {
      setIsProcessingWatermark(false);
    }
  };

  // ==========================================================================
  // Google Sign-In & Direct User Google Drive Save / Open / Delete Flows
  // ==========================================================================

  const handleGoogleSignIn = async (): Promise<string | null> => {
    try {
      const result = await googleSignIn();
      if (!result) return null;
      setCurrentUser(result.user);
      setDriveAccessToken(result.accessToken);
      await refreshGoogleDriveFiles(result.accessToken);
      setStatusBanner({
        type: 'info',
        message: `Connected Google Drive (${result.user.email || 'Google Account'}).`,
      });
      return result.accessToken;
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.',
      });
      return null;
    }
  };

  const handleSignOut = async () => {
    await logout();
    setCurrentUser(null);
    setDriveAccessToken(null);
    setDriveDocs([]);
    setStatusBanner({
      type: 'info',
      message: 'Signed out of Google Drive.',
    });
  };

  const executeDriveUpload = async (
    targetMeta: StudioDocumentMeta,
    accessToken: string,
    overwriteDriveFileId?: string
  ) => {
    setIsSavingDrive(true);
    try {
      let bytesToSave: Uint8Array | null = null;
      if (targetMeta.id === activeDocMeta?.id && pdfBytes) {
        bytesToSave = await bakeAnnotationsIntoPdf(pdfBytes, annotations);
      } else {
        bytesToSave = await loadLocalPdfBinary(targetMeta.id);
      }

      if (!bytesToSave) {
        throw new Error('Open this PDF first so its pages can be uploaded to Google Drive.');
      }

      const savedMeta = await savePdfToGoogleDrive({
        accessToken,
        meta: targetMeta,
        pdfBytes: bytesToSave,
        overwriteDriveFileId,
      });

      if (activeDocMeta?.id === savedMeta.id) {
        setActiveDocMeta(savedMeta);
      }

      await Promise.all([
        refreshLocalVaultLists(),
        refreshGoogleDriveFiles(accessToken),
      ]);

      setDriveModalState(null);
      setStatusBanner({
        type: 'info',
        message: overwriteDriveFileId
          ? `Updated "${savedMeta.title}" in your Google Drive (${currentUser?.email || 'Drive'}).`
          : `Saved "${savedMeta.title}" directly to your Google Drive (${currentUser?.email || 'Drive'}).`,
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setDriveAccessToken(null);
        setDriveModalState({
          mode: 'connect',
          doc: targetMeta,
          userEmail: currentUser?.email,
        });
      }
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save PDF to Google Drive.',
      });
    } finally {
      setIsSavingDrive(false);
    }
  };

  /**
   * Entry point when user clicks "Save to Drive" on the open PDF or library row:
   * - If not signed in or no OAuth token in memory -> opens Connect Gmail / Google Drive modal.
   * - If already saved in Google Drive -> opens explicit confirmation dialog before overwriting.
   * - Otherwise -> uploads new PDF directly to the user's own Google Drive.
   */
  const handleInitiateSaveToDrive = async (targetMeta?: StudioDocumentMeta) => {
    const docToSave = targetMeta || activeDocMeta;
    if (!docToSave) return;

    const token = driveAccessToken || (await getAccessToken());
    if (!currentUser || !token) {
      setDriveModalState({
        mode: 'connect',
        doc: docToSave,
        userEmail: currentUser?.email,
      });
      return;
    }

    if (docToSave.driveFileId) {
      // Mandatory confirmation before overwriting existing Google Drive file
      setDriveModalState({
        mode: 'confirm-update',
        doc: docToSave,
        userEmail: currentUser.email,
      });
      return;
    }

    await executeDriveUpload(docToSave, token, undefined);
  };

  const handleConnectAndSaveFromModal = async (docToSave: StudioDocumentMeta) => {
    setIsSavingDrive(true);
    try {
      const token = await handleGoogleSignIn();
      if (!token) return;
      if (docToSave.driveFileId) {
        setDriveModalState({
          mode: 'confirm-update',
          doc: docToSave,
          userEmail: authUserEmailFallback(currentUser),
        });
        return;
      }
      await executeDriveUpload(docToSave, token, undefined);
    } finally {
      setIsSavingDrive(false);
    }
  };

  function authUserEmailFallback(u: User | null): string | undefined {
    return u?.email || undefined;
  }

  // Merge Local Vault + User's Google Drive PDFs without duplicates
  const mergedLibraryDocs: StudioDocumentMeta[] = React.useMemo(() => {
    const map = new Map<string, StudioDocumentMeta>();
    for (const loc of localDocs) {
      map.set(loc.id, loc);
    }
    for (const drv of driveDocs) {
      const existingById = map.get(drv.id);
      const existingByDriveId = Array.from(map.values()).find(
        (m) => m.driveFileId && m.driveFileId === drv.driveFileId
      );
      const matched = existingById || existingByDriveId;
      if (matched) {
        map.set(matched.id, {
          ...matched,
          driveFileId: drv.driveFileId,
          driveWebViewLink: drv.driveWebViewLink,
          storageLocation: 'synced',
        });
      } else {
        map.set(drv.id, drv);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.updatedAtIso.localeCompare(a.updatedAtIso)
    );
  }, [localDocs, driveDocs]);

  const handleOpenLibraryDocument = async (docItem: StudioDocumentMeta) => {
    let bytes = await loadLocalPdfBinary(docItem.id);
    if (!bytes && docItem.driveFileId) {
      let token = driveAccessToken || (await getAccessToken());
      if (!token) {
        token = await handleGoogleSignIn();
      }
      if (!token) return;

      setStatusBanner({
        type: 'info',
        message: `Opening "${docItem.title}" from your Google Drive...`,
      });
      try {
        bytes = await downloadPdfFromGoogleDrive(token, docItem.driveFileId, docItem.id);
      } catch (err) {
        setStatusBanner({
          type: 'error',
          message:
            err instanceof Error ? err.message : 'Unable to download PDF from Google Drive.',
        });
        return;
      }
    }

    if (!bytes) {
      setStatusBanner({
        type: 'error',
        message: 'PDF binary is not cached locally. Upload the file or sign in to Google Drive.',
      });
      return;
    }

    await mountPdfIntoEngine(docItem, bytes, docItem.annotations);
    setActiveTab(ActiveWorkspaceTab.VIEWER);
    setStatusBanner(null);
  };

  const handleToggleStarDocument = async (docItem: StudioDocumentMeta) => {
    const updated: StudioDocumentMeta = {
      ...docItem,
      starred: !docItem.starred,
      updatedAtIso: new Date().toISOString(),
    };
    await saveLocalDocumentMeta(updated);
    if (activeDocMeta?.id === updated.id) {
      setActiveDocMeta(updated);
    }
    await refreshLocalVaultLists();
  };

  const handleRequestDeleteDocument = (docItem: StudioDocumentMeta) => {
    if (docItem.driveFileId && driveAccessToken) {
      // Mandatory explicit confirmation dialog before deleting from user's Google Drive
      setDriveModalState({
        mode: 'confirm-delete',
        doc: docItem,
        userEmail: currentUser?.email,
      });
      return;
    }
    void handleDeleteLocalOnly(docItem);
  };

  const handleDeleteLocalOnly = async (docItem: StudioDocumentMeta) => {
    await deleteLocalDocument(docItem.id);
    await refreshLocalVaultLists();
    setDriveModalState(null);
    setStatusBanner({
      type: 'info',
      message: `Removed "${docItem.title}" from local browser vault.`,
    });
  };

  const handleConfirmDeleteFromDrive = async (docItem: StudioDocumentMeta) => {
    setIsSavingDrive(true);
    try {
      const token = driveAccessToken || (await getAccessToken());
      if (token && docItem.driveFileId) {
        await deletePdfFromGoogleDrive(token, docItem.driveFileId);
      }
      await deleteLocalDocument(docItem.id);
      await Promise.all([
        refreshLocalVaultLists(),
        refreshGoogleDriveFiles(token),
      ]);
      setDriveModalState(null);
      setStatusBanner({
        type: 'info',
        message: `Deleted "${docItem.title}" from your Google Drive and local vault.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to delete file from Google Drive.',
      });
    } finally {
      setIsSavingDrive(false);
    }
  };

  // AI Panel callbacks
  const handleSaveAiSummaryJson = async (summaryJson: string) => {
    if (!activeDocMeta) return;
    const updated: StudioDocumentMeta = {
      ...activeDocMeta,
      aiSummary: summaryJson,
      updatedAtIso: new Date().toISOString(),
    };
    setActiveDocMeta(updated);
    await saveLocalDocumentMeta(updated);
    await refreshLocalVaultLists();
  };

  const handleApplyAiEditedTextToPage = (
    revisedText: string,
    targetSpan?: ExtractedTextSpan
  ) => {
    const targetPage = targetSpan ? targetSpan.pageNumber : activePage;
    handleAddAnnotation({
      id: `ann_ai_${Date.now()}`,
      pageNumber: targetPage,
      type: 'text_edit',
      x: targetSpan ? targetSpan.x : 0.1,
      y: targetSpan ? targetSpan.y : 0.18,
      width: targetSpan ? Math.max(0.28, targetSpan.width) : 0.72,
      height: targetSpan ? Math.max(0.03, targetSpan.height) : 0.08,
      color: '#0F172A',
      text: revisedText,
      originalText: targetSpan?.str,
      coverBackground: true,
      fontSize: targetSpan ? Math.max(9, Math.min(16, Math.round(targetSpan.fontSize))) : 11,
      createdAt: new Date().toISOString(),
    });
    setActiveTab(ActiveWorkspaceTab.VIEWER);
    setStatusBanner({
      type: 'info',
      message: `Applied AI-edited text onto Page ${targetPage}.`,
    });
  };

  const handleCreateNewPdfFromOcrText = async (
    title: string,
    extractedText: string
  ) => {
    try {
      const builtBytes = await createPdfBytesFromExtractedText(title, extractedText);
      const now = new Date().toISOString();
      const newMeta: StudioDocumentMeta = {
        id: `doc_ocr_${Date.now()}`,
        title: title.slice(0, 240),
        pageCount: 1,
        fileSizeBytes: builtBytes.byteLength,
        chunkCount: 0,
        watermarkRemoved: false,
        annotations: [],
        aiSummary: '',
        starred: false,
        storageLocation: 'local',
        createdAtIso: now,
        updatedAtIso: now,
      };
      await mountPdfIntoEngine(newMeta, builtBytes, []);
      setActiveTab(ActiveWorkspaceTab.VIEWER);
      setStatusBanner({
        type: 'info',
        message: `Created and opened "${newMeta.title}" from extracted photo text.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to generate PDF from extracted text.',
      });
    }
  };

  const navItems: {
    tab: ActiveWorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { tab: ActiveWorkspaceTab.VIEWER, label: 'PDF Reader & Editor', icon: FileText },
    { tab: ActiveWorkspaceTab.CONVERTER, label: 'Format Converter', icon: FileOutput },
    { tab: ActiveWorkspaceTab.ORGANIZER, label: 'Page Organizer', icon: LayoutGrid },
    { tab: ActiveWorkspaceTab.CLOUD_LIBRARY, label: 'Google Drive & Vault', icon: FolderKanban },
  ];

  const activeTabLabel =
    navItems.find((n) => n.tab === activeTab)?.label || 'PDF Studio';

  const isSavedInDrive = Boolean(
    activeDocMeta?.driveFileId || activeDocMeta?.storageLocation === 'synced'
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) void handleLoadUploadedFile(dropped);
      }}
      className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900"
    >
      {/* Hidden Global PDF & High-Res Document Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,application/x-pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) void handleLoadUploadedFile(picked);
        }}
        className="hidden"
      />

      {/* Drag & Drop Overlay */}
      {isDraggingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6">
          <div className="rounded-xl border-2 border-dashed border-white bg-slate-900/90 px-10 py-8 text-center text-white">
            <p className="text-lg font-semibold">Drop PDF file anywhere to open instantaneously</p>
            <p className="mt-1 text-xs text-slate-300">
              Supports lightweight documents up to multi-hundred-MB engineering manuals
            </p>
          </div>
        </div>
      )}

      {/* Left Workspace Sidebar (Desktop) */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white">
        <div>
          <div className="flex h-14 items-center border-b border-slate-200 px-5">
            <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Vellum PDF Studio
            </span>
          </div>

          <nav aria-label="Primary Workspace" className="space-y-1 p-3">
            {navItems.map(({ tab, label, icon: Icon }) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Recent Workspace Files Quick Switcher */}
          <div className="mt-4 border-t border-slate-200 px-4 pt-4">
            <p className="text-xs font-semibold text-slate-900">Workspace Files</p>
            <div className="mt-2 space-y-1">
              {mergedLibraryDocs.slice(0, 5).map((docItem) => {
                const isCurrent = docItem.id === activeDocMeta?.id;
                return (
                  <button
                    key={docItem.id}
                    type="button"
                    onClick={() => void handleOpenLibraryDocument(docItem)}
                    className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                      isCurrent
                        ? 'bg-blue-50 font-semibold text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <p className="truncate">{docItem.title}</p>
                    <p className="mt-0.5 text-[11px] font-normal text-slate-400 tabular-nums">
                      {docItem.pageCount}p · {formatFileSize(docItem.fileSizeBytes)}
                      {docItem.driveFileId ? ' · Drive' : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Google Account & Drive Footer */}
        <div className="border-t border-slate-200 p-3 space-y-2">
          {currentUser && driveAccessToken ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {currentUser.displayName || 'Google Drive Connected'}
                </p>
                <p className="truncate text-[11px] text-slate-500">{currentUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                aria-label="Sign out of Google Drive"
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <GoogleSignInButton
              fullWidth
              label={currentUser ? 'Connect Google Drive' : 'Sign in with Google'}
              onClick={() => void handleGoogleSignIn()}
            />
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col justify-between bg-white p-4 shadow-xl">
            <div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-base font-bold text-slate-900">Vellum PDF Studio</span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map(({ tab, label, icon: Icon }) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium ${
                      activeTab === tab
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
            </div>

            <div className="border-t border-slate-200 pt-3">
              {currentUser && driveAccessToken ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-600">{currentUser.email}</span>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="text-xs font-medium text-slate-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <GoogleSignInButton
                  fullWidth
                  label="Sign in with Google"
                  onClick={() => void handleGoogleSignIn()}
                />
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Right Main Column: Contextual Top Bar + Active Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Contextual Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open workspace menu"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span className="hidden sm:inline font-medium text-slate-600 whitespace-nowrap shrink-0">
                {activeTabLabel}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">
                /
              </span>
              <span className="truncate font-semibold text-slate-900 max-w-[180px] sm:max-w-xs md:max-w-md">
                {activeDocMeta?.title || 'Loading...'}
              </span>
              {activeDocMeta && (
                <span className="hidden md:inline font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                  · {activeDocMeta.pageCount}p · {formatFileSize(activeDocMeta.fileSizeBytes)}
                </span>
              )}
            </div>
          </div>

          {/* Primary Actions (Open PDF, Save to Google Drive, Export PDF) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="h-3.5 w-3.5 text-slate-600" />
              <span>Open PDF</span>
            </button>

            <button
              type="button"
              disabled={isSavingDrive || !activeDocMeta}
              onClick={() => void handleInitiateSaveToDrive()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isSavedInDrive ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <HardDriveUpload className="h-3.5 w-3.5 text-blue-700" />
              )}
              <span>
                {isSavingDrive
                  ? 'Saving to Drive...'
                  : isSavedInDrive
                    ? 'Saved in Drive'
                    : 'Save to Drive'}
              </span>
            </button>

            <button
              type="button"
              disabled={!pdfBytes}
              onClick={() => void handleExportEditedPdf()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </header>

        {/* Dismissible Notification Banner */}
        {statusBanner && (
          <div
            role={statusBanner.type === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between border-b px-4 py-2 text-xs font-medium ${
              statusBanner.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-slate-200 bg-slate-900 text-white'
            }`}
          >
            <span>{statusBanner.message}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              aria-label="Dismiss notification"
              className="ml-4 rounded p-0.5 opacity-80 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Active Workspace View + Optional Right AI Studio Panel */}
        <main className="flex min-h-0 flex-1 overflow-hidden">
          {activeTab === ActiveWorkspaceTab.VIEWER && (
            <PdfViewerWorkspace
              pdfProxy={pdfProxy}
              pageCount={activeDocMeta?.pageCount || 1}
              activePage={activePage}
              onActivePageChange={setActivePage}
              pagesTextData={pagesTextData}
              annotations={annotations}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onAddAnnotation={handleAddAnnotation}
              onUpdateAnnotation={handleUpdateAnnotation}
              onDeleteAnnotation={handleDeleteAnnotation}
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              pendingSignature={pendingSignature}
              onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
              watermarkCandidates={watermarkCandidates}
              onOpenWatermarkModal={() => setIsWatermarkModalOpen(true)}
              isAiPanelOpen={isAiPanelOpen}
              activeAiTab={activeAiTab}
              onOpenAiTab={(targetTab) => {
                setActiveAiTab(targetTab);
                setIsAiPanelOpen(true);
              }}
              onToggleAiPanel={() => setIsAiPanelOpen((v) => !v)}
              onSelectSpanForAi={(text, span) => {
                setSelectedSpanForAi({ text, span });
                setActiveAiTab('editor');
                setIsAiPanelOpen(true);
              }}
            />
          )}

          {activeTab === ActiveWorkspaceTab.CONVERTER && pdfBytes && activeDocMeta && (
            <div className="flex-1 overflow-y-auto">
              <FormatConverterView
                documentTitle={activeDocMeta.title}
                pdfBytes={pdfBytes}
                pageCount={activeDocMeta.pageCount}
                annotations={annotations}
                conversionHistory={conversionHistory}
                onRecordConversion={async (params: {
                  sourceTitle: string;
                  targetFormat: ExportFormat | 'pdf';
                  pageCount: number;
                  outputSizeBytes: number;
                }) => {
                  await recordConversionLog(params);
                  await refreshLocalVaultLists();
                }}
                onLoadConvertedPdfIntoViewer={async (title, builtBytes) => {
                  const now = new Date().toISOString();
                  const meta: StudioDocumentMeta = {
                    id: `doc_conv_${Date.now()}`,
                    title,
                    pageCount: 1,
                    fileSizeBytes: builtBytes.byteLength,
                    chunkCount: 0,
                    watermarkRemoved: false,
                    annotations: [],
                    aiSummary: '',
                    starred: false,
                    storageLocation: 'local',
                    createdAtIso: now,
                    updatedAtIso: now,
                  };
                  await mountPdfIntoEngine(meta, builtBytes, []);
                  setActiveTab(ActiveWorkspaceTab.VIEWER);
                }}
              />
            </div>
          )}

          {activeTab === ActiveWorkspaceTab.ORGANIZER && pdfBytes && activeDocMeta && (
            <div className="flex-1 overflow-y-auto">
              <PageOrganizerView
                pdfProxy={pdfProxy}
                pdfBytes={pdfBytes}
                documentTitle={activeDocMeta.title}
                onApplyOrganizedPdf={async (newBytes, summaryNote) => {
                  await mountPdfIntoEngine(activeDocMeta, newBytes, []);
                  setActiveTab(ActiveWorkspaceTab.VIEWER);
                  setStatusBanner({ type: 'info', message: summaryNote });
                }}
              />
            </div>
          )}

          {activeTab === ActiveWorkspaceTab.CLOUD_LIBRARY && (
            <div className="flex-1 overflow-y-auto">
              <CloudLibraryView
                currentUser={currentUser}
                hasDriveToken={Boolean(driveAccessToken)}
                documents={mergedLibraryDocs}
                activeDocId={activeDocMeta?.id || ''}
                isSyncing={isSavingDrive}
                onSignIn={async () => {
                  await handleGoogleSignIn();
                }}
                onRefreshDrive={async () => {
                  await refreshGoogleDriveFiles(driveAccessToken);
                }}
                onOpenDocument={handleOpenLibraryDocument}
                onSaveDocumentToDrive={(docItem) => {
                  void handleInitiateSaveToDrive(docItem);
                }}
                onToggleStar={handleToggleStarDocument}
                onRequestDeleteDocument={handleRequestDeleteDocument}
                onTriggerUploadFile={() => fileInputRef.current?.click()}
              />
            </div>
          )}

          {/* Collapsible Right AI Document Studio Panel */}
          {isAiPanelOpen && activeDocMeta && (
            <AiDocumentPanel
              isOpen={isAiPanelOpen}
              activeTab={activeAiTab}
              onTabChange={setActiveAiTab}
              onClose={() => setIsAiPanelOpen(false)}
              pdfProxy={pdfProxy}
              documentTitle={activeDocMeta.title}
              pagesTextData={pagesTextData}
              activePage={activePage}
              selectedSpanForAi={selectedSpanForAi}
              savedSummaryJson={activeDocMeta.aiSummary}
              onSaveSummaryJson={handleSaveAiSummaryJson}
              onApplyEditedTextToPage={handleApplyAiEditedTextToPage}
              onCreateNewPdfFromText={handleCreateNewPdfFromOcrText}
              onJumpToPage={(pageNumber) => {
                setActiveTab(ActiveWorkspaceTab.VIEWER);
                setActivePage(pageNumber);
                const el = document.getElementById(`pdf-page-anchor-${pageNumber}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <WatermarkStudioModal
        isOpen={isWatermarkModalOpen}
        onClose={() => setIsWatermarkModalOpen(false)}
        candidates={watermarkCandidates}
        isProcessing={isProcessingWatermark}
        watermarkRemoved={Boolean(activeDocMeta?.watermarkRemoved)}
        onRemoveWatermarks={handleRemoveWatermarks}
        onActivateRegionMaskTool={() => setActiveTool(AnnotationTool.WATERMARK_MASK)}
        onAddWatermark={handleAddWatermark}
      />

      <SignaturePadModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onConfirmSignature={(dataUrl, label) => {
          setPendingSignature({ dataUrl, label });
          setActiveTool(AnnotationTool.SIGNATURE);
        }}
      />

      <DriveActionModal
        modalState={driveModalState}
        isBusy={isSavingDrive}
        onClose={() => setDriveModalState(null)}
        onConnectAndSave={handleConnectAndSaveFromModal}
        onConfirmOverwriteDrive={async (docToUpdate) => {
          const token = driveAccessToken || (await getAccessToken());
          if (!token) {
            setDriveModalState({
              mode: 'connect',
              doc: docToUpdate,
              userEmail: currentUser?.email,
            });
            return;
          }
          await executeDriveUpload(docToUpdate, token, docToUpdate.driveFileId);
        }}
        onSaveAsNewCopyInDrive={async (docToSave) => {
          const token = driveAccessToken || (await getAccessToken());
          if (!token) {
            setDriveModalState({
              mode: 'connect',
              doc: docToSave,
              userEmail: currentUser?.email,
            });
            return;
          }
          await executeDriveUpload(docToSave, token, undefined);
        }}
        onConfirmDeleteFromDrive={handleConfirmDeleteFromDrive}
        onDeleteLocalOnly={handleDeleteLocalOnly}
      />

      <PdfPasswordModal
        isOpen={Boolean(pendingPasswordPrompt)}
        fileName={pendingPasswordPrompt?.meta.title || 'Protected_Document.pdf'}
        incorrectAttempt={Boolean(pendingPasswordPrompt?.incorrectAttempt)}
        isUnlocking={isUnlockingPdf}
        onClose={() => setPendingPasswordPrompt(null)}
        onSubmitPassword={(pwd) => void handleUnlockPasswordProtectedPdf(pwd)}
      />
    </div>
  );
}
