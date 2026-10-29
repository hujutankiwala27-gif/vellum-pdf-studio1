import React from 'react';
import { FileText, HardDriveUpload, Trash2, X } from 'lucide-react';
import { StudioDocumentMeta } from '../types/pdfStudio';
import { formatFileSize } from '../utils/pdfPureLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

export type DriveModalState =
  | {
      mode: 'connect';
      doc: StudioDocumentMeta;
      userEmail?: string | null;
    }
  | {
      mode: 'confirm-update';
      doc: StudioDocumentMeta;
      userEmail?: string | null;
    }
  | {
      mode: 'confirm-delete';
      doc: StudioDocumentMeta;
      userEmail?: string | null;
    }
  | null;

interface DriveActionModalProps {
  modalState: DriveModalState;
  isBusy: boolean;
  onClose: () => void;
  onConnectAndSave: (doc: StudioDocumentMeta) => Promise<void>;
  onConfirmOverwriteDrive: (doc: StudioDocumentMeta) => Promise<void>;
  onSaveAsNewCopyInDrive: (doc: StudioDocumentMeta) => Promise<void>;
  onConfirmDeleteFromDrive: (doc: StudioDocumentMeta) => Promise<void>;
  onDeleteLocalOnly: (doc: StudioDocumentMeta) => Promise<void>;
}

export const DriveActionModal: React.FC<DriveActionModalProps> = ({
  modalState,
  isBusy,
  onClose,
  onConnectAndSave,
  onConfirmOverwriteDrive,
  onSaveAsNewCopyInDrive,
  onConfirmDeleteFromDrive,
  onDeleteLocalOnly,
}) => {
  if (!modalState) return null;

  const { mode, doc, userEmail } = modalState;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="drive-modal-title" className="text-base font-bold text-slate-900">
              {mode === 'connect' && 'Save PDF to Your Google Drive'}
              {mode === 'confirm-update' && 'Update Existing File in Google Drive?'}
              {mode === 'confirm-delete' && 'Delete PDF from Google Drive?'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {mode === 'connect' &&
                (userEmail
                  ? `Reconnect Google Drive access for ${userEmail} so this PDF (with all edits and annotations) saves directly into your own Google Drive.`
                  : 'Sign in with your Google (Gmail) account to save this open PDF directly into your own free Google Drive.')}
              {mode === 'confirm-update' &&
                `This will overwrite the existing PDF file "${doc.title}" in your Google Drive${
                  userEmail ? ` (${userEmail})` : ''
                } with your latest edits and annotations.`}
              {mode === 'confirm-delete' &&
                `Are you sure you want to permanently delete "${doc.title}" from your Google Drive${
                  userEmail ? ` (${userEmail})` : ''
                }?`}
            </p>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close Google Drive dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Target Document Card */}
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 text-blue-700">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-900">{doc.title}</p>
            <p className="mt-0.5 text-[11px] font-mono text-slate-500 tabular-nums">
              {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'} ·{' '}
              {formatFileSize(doc.fileSizeBytes)}
              {doc.annotations.length > 0 ? ` · ${doc.annotations.length} edits` : ''}
            </p>
          </div>
        </div>

        {/* Modal Actions */}
        {mode === 'connect' && (
          <div className="mt-5 space-y-2.5">
            <GoogleSignInButton
              fullWidth
              disabled={isBusy}
              label={
                isBusy
                  ? 'Connecting to Google Drive...'
                  : 'Sign in with Google & Save to Drive'
              }
              onClick={() => void onConnectAndSave(doc)}
            />
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}

        {mode === 'confirm-update' && (
          <div className="mt-5 space-y-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onConfirmOverwriteDrive(doc)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <HardDriveUpload className="h-3.5 w-3.5" />
              <span>{isBusy ? 'Updating in Google Drive...' : 'Update Existing File in Drive'}</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onSaveAsNewCopyInDrive(doc)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Save as New Copy in Drive
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="w-full rounded-lg px-4 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        )}

        {mode === 'confirm-delete' && (
          <div className="mt-5 space-y-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onConfirmDeleteFromDrive(doc)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{isBusy ? 'Deleting from Google Drive...' : 'Confirm Delete from Google Drive'}</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onDeleteLocalOnly(doc)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Remove from Local Browser Only
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="w-full rounded-lg px-4 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
