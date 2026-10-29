import {
  ConversionHistoryItem,
  ExportFormat,
  StudioDocumentMeta,
} from '../types/pdfStudio';
import {
  RawGoogleDriveFile,
  buildGoogleDriveMultipartBody,
  ensurePdfExtension,
  mapGoogleDriveFileToMeta,
} from '../utils/pdfPureLogic';

const IDB_NAME = 'vellum_pdf_studio_db';
const IDB_VERSION = 1;
const STORE_BINARIES = 'pdf_binaries';
const STORE_META = 'pdf_meta';
const STORE_CONVERSIONS = 'conversion_history';

function openLocalVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_BINARIES)) {
        database.createObjectStore(STORE_BINARIES);
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_CONVERSIONS)) {
        database.createObjectStore(STORE_CONVERSIONS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalPdfBinary(docId: string, bytes: Uint8Array): Promise<void> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_BINARIES, 'readwrite');
    tx.objectStore(STORE_BINARIES).put(bytes.slice(), docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLocalPdfBinary(docId: string): Promise<Uint8Array | null> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_BINARIES, 'readonly');
    const req = tx.objectStore(STORE_BINARIES).get(docId);
    req.onsuccess = () => {
      const res = req.result;
      if (res instanceof Uint8Array) {
        resolve(res);
      } else if (res instanceof ArrayBuffer) {
        resolve(new Uint8Array(res));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalDocumentMeta(meta: StudioDocumentMeta): Promise<void> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listLocalDocumentsMeta(): Promise<StudioDocumentMeta[]> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => {
      const items = (req.result as StudioDocumentMeta[]) || [];
      items.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLocalDocument(docId: string): Promise<void> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_META, STORE_BINARIES], 'readwrite');
    tx.objectStore(STORE_META).delete(docId);
    tx.objectStore(STORE_BINARIES).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveLocalConversionHistory(item: ConversionHistoryItem): Promise<void> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_CONVERSIONS, 'readwrite');
    tx.objectStore(STORE_CONVERSIONS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listLocalConversionHistory(): Promise<ConversionHistoryItem[]> {
  const database = await openLocalVault();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_CONVERSIONS, 'readonly');
    const req = tx.objectStore(STORE_CONVERSIONS).getAll();
    req.onsuccess = () => {
      const list = (req.result as ConversionHistoryItem[]) || [];
      list.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function recordConversionLog(params: {
  sourceTitle: string;
  targetFormat: ExportFormat | 'pdf';
  pageCount: number;
  outputSizeBytes: number;
}): Promise<ConversionHistoryItem> {
  const item: ConversionHistoryItem = {
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    sourceTitle: params.sourceTitle.slice(0, 240),
    targetFormat: params.targetFormat,
    pageCount: Math.max(1, Math.round(params.pageCount)),
    outputSizeBytes: Math.max(0, Math.round(params.outputSizeBytes)),
    createdAtIso: new Date().toISOString(),
  };

  await saveLocalConversionHistory(item);
  return item;
}

// ============================================================================
// 1P Google Drive REST v3 Integration (Free User-Owned Drive Storage)
// ============================================================================

async function parseDriveError(res: Response, fallback: string): Promise<Error> {
  try {
    const json = await res.json();
    const message = json?.error?.message || fallback;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    return err;
  } catch {
    const err = new Error(fallback) as Error & { status?: number };
    err.status = res.status;
    return err;
  }
}

/**
 * Uploads a new PDF or updates an existing app-created PDF in the user's own Google Drive.
 */
export async function savePdfToGoogleDrive(params: {
  accessToken: string;
  meta: StudioDocumentMeta;
  pdfBytes: Uint8Array;
  overwriteDriveFileId?: string;
}): Promise<StudioDocumentMeta> {
  const { accessToken, meta, pdfBytes, overwriteDriveFileId } = params;
  const filename = ensurePdfExtension(meta.title);

  const driveMetadata: Record<string, unknown> = {
    name: filename,
    mimeType: 'application/pdf',
    appProperties: {
      app: 'vellum-pdf-studio',
      localDocId: meta.id.slice(0, 80),
      pageCount: String(meta.pageCount),
      watermarkRemoved: String(Boolean(meta.watermarkRemoved)),
      starred: String(Boolean(meta.starred)),
    },
  };

  const { body, contentType } = buildGoogleDriveMultipartBody(driveMetadata, pdfBytes);
  const fieldsQuery = 'id,name,size,modifiedTime,createdTime,webViewLink,appProperties';

  const endpoint = overwriteDriveFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        overwriteDriveFileId
      )}?uploadType=multipart&fields=${fieldsQuery}`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fieldsQuery}`;

  // Copy into clean ArrayBuffer for fetch BodyInit TypeScript compatibility
  const payloadCopy = new Uint8Array(body.byteLength);
  payloadCopy.set(body);

  const res = await fetch(endpoint, {
    method: overwriteDriveFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: payloadCopy,
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to save PDF to your Google Drive.');
  }

  const uploaded = (await res.json()) as RawGoogleDriveFile;
  const updatedMeta: StudioDocumentMeta = {
    ...meta,
    title: ensurePdfExtension(uploaded.name || filename),
    fileSizeBytes: pdfBytes.byteLength,
    storageLocation: 'synced',
    driveFileId: uploaded.id,
    driveWebViewLink:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    updatedAtIso: uploaded.modifiedTime || new Date().toISOString(),
  };

  await saveLocalPdfBinary(updatedMeta.id, pdfBytes);
  await saveLocalDocumentMeta(updatedMeta);
  return updatedMeta;
}

/**
 * Lists PDF files saved via Vellum PDF Studio in the user's Google Drive (drive.file scope).
 */
export async function listGoogleDrivePdfs(
  accessToken: string
): Promise<StudioDocumentMeta[]> {
  const q = encodeURIComponent("mimeType='application/pdf' and trashed=false");
  const fields = encodeURIComponent(
    'files(id,name,size,modifiedTime,createdTime,webViewLink,appProperties)'
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Unable to list PDF files from Google Drive.');
  }

  const data = (await res.json()) as { files?: RawGoogleDriveFile[] };
  return (data.files || []).map(mapGoogleDriveFileToMeta);
}

/**
 * Downloads a PDF binary directly from the user's Google Drive and caches it locally in IndexedDB.
 */
export async function downloadPdfFromGoogleDrive(
  accessToken: string,
  driveFileId: string,
  localDocId: string
): Promise<Uint8Array> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    driveFileId
  )}?alt=media`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Unable to download PDF from Google Drive.');
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  await saveLocalPdfBinary(localDocId, bytes);
  return bytes;
}

/**
 * Deletes an app-created PDF file from the user's Google Drive (must only be called after explicit user confirmation).
 */
export async function deletePdfFromGoogleDrive(
  accessToken: string,
  driveFileId: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    throw await parseDriveError(res, 'Unable to delete PDF from Google Drive.');
  }
}
