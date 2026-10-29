import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  FolderOpen,
  HardDrive,
  HardDriveUpload,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { StudioDocumentMeta } from '../types/pdfStudio';
import { formatFileSize } from '../utils/pdfPureLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

interface CloudLibraryViewProps {
  currentUser: User | null;
  hasDriveToken: boolean;
  documents: StudioDocumentMeta[];
  activeDocId: string;
  isSyncing: boolean;
  onSignIn: () => Promise<void>;
  onRefreshDrive: () => Promise<void>;
  onOpenDocument: (docMeta: StudioDocumentMeta) => Promise<void>;
  onSaveDocumentToDrive: (docMeta: StudioDocumentMeta) => void;
  onToggleStar: (docMeta: StudioDocumentMeta) => Promise<void>;
  onRequestDeleteDocument: (docMeta: StudioDocumentMeta) => void;
  onTriggerUploadFile: () => void;
}

export const CloudLibraryView: React.FC<CloudLibraryViewProps> = ({
  currentUser,
  hasDriveToken,
  documents,
  activeDocId,
  isSyncing,
  onSignIn,
  onRefreshDrive,
  onOpenDocument,
  onSaveDocumentToDrive,
  onToggleStar,
  onRequestDeleteDocument,
  onTriggerUploadFile,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'drive' | 'starred'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = documents.filter((docItem) => {
    if (filterMode === 'drive' && !docItem.driveFileId && docItem.storageLocation === 'local') {
      return false;
    }
    if (filterMode === 'starred' && !docItem.starred) return false;
    if (
      searchQuery.trim() &&
      !docItem.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Google Drive & Local Vault
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            PDFs cache instantaneously in your local browser vault and save directly into your own free Google Drive when signed in with your Gmail account.
          </p>
          {currentUser && hasDriveToken && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Connected to Google Drive ({currentUser.email})</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!currentUser || !hasDriveToken ? (
            <GoogleSignInButton
              disabled={isSyncing}
              label={currentUser ? 'Connect Google Drive' : 'Sign in with Google'}
              onClick={() => void onSignIn()}
            />
          ) : (
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void onRefreshDrive()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Refresh Drive</span>
            </button>
          )}

          <button
            type="button"
            onClick={onTriggerUploadFile}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <FolderOpen className="h-4 w-4" />
            <span>Upload New PDF</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              filterMode === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Documents ({documents.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('drive')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              filterMode === 'drive'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Saved in Google Drive
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('starred')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              filterMode === 'starred'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Starred
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Search library documents"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents by filename..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
          />
        </div>
      </div>

      {/* Documents Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-900">No matching PDF documents</p>
          <p className="mt-1 text-xs text-slate-500">
            Upload a PDF from your device or sign in with Google to access PDFs saved in your Google Drive.
          </p>
          <button
            type="button"
            onClick={onTriggerUploadFile}
            className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            Upload PDF File
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Storage Location</th>
                <th className="px-4 py-3 font-semibold text-right">Pages</th>
                <th className="px-4 py-3 font-semibold text-right">Size</th>
                <th className="px-4 py-3 font-semibold text-right">Edits</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((docItem) => {
                const isCurrent = docItem.id === activeDocId;
                const isSavedInDrive = Boolean(
                  docItem.driveFileId || docItem.storageLocation !== 'local'
                );
                return (
                  <tr key={docItem.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => void onToggleStar(docItem)}
                          aria-label={
                            docItem.starred ? `Unstar ${docItem.title}` : `Star ${docItem.title}`
                          }
                          className="text-slate-400 hover:text-amber-500"
                        >
                          <Star
                            className={`h-4 w-4 ${
                              docItem.starred ? 'fill-amber-400 text-amber-500' : ''
                            }`}
                          />
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => void onOpenDocument(docItem)}
                            className="font-semibold text-slate-900 hover:text-blue-700 hover:underline text-left truncate block max-w-xs"
                          >
                            {docItem.title}
                          </button>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                            {isCurrent && (
                              <span className="font-medium text-blue-700">Active in Viewer</span>
                            )}
                            {isCurrent && docItem.watermarkRemoved && (
                              <span aria-hidden="true">·</span>
                            )}
                            {docItem.watermarkRemoved && <span>Watermark cleaned</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        {isSavedInDrive ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Google Drive</span>
                          </>
                        ) : (
                          <>
                            <HardDrive className="h-3.5 w-3.5 text-slate-500" />
                            <span>Local Browser Vault</span>
                          </>
                        )}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-slate-700 tabular-nums">
                      {docItem.pageCount}
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-slate-700 tabular-nums">
                      {formatFileSize(docItem.fileSizeBytes)}
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-slate-700 tabular-nums">
                      {docItem.annotations.length}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void onOpenDocument(docItem)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => onSaveDocumentToDrive(docItem)}
                          aria-label={`Save ${docItem.title} to Google Drive`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <HardDriveUpload className="h-3.5 w-3.5" />
                          <span>{isSavedInDrive ? 'Update Drive' : 'Save to Drive'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDeleteDocument(docItem)}
                          aria-label={`Delete ${docItem.title}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
