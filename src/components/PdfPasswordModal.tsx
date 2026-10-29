import React, { useState } from 'react';
import { Eye, EyeOff, Lock, X } from 'lucide-react';

interface PdfPasswordModalProps {
  isOpen: boolean;
  fileName: string;
  incorrectAttempt: boolean;
  isUnlocking: boolean;
  onClose: () => void;
  onSubmitPassword: (password: string) => void;
}

export const PdfPasswordModal: React.FC<PdfPasswordModalProps> = ({
  isOpen,
  fileName,
  incorrectAttempt,
  isUnlocking,
  onClose,
  onSubmitPassword,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    onSubmitPassword(password);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-pdf-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="unlock-pdf-modal-title"
                className="text-sm font-bold text-slate-900"
              >
                Password-Protected PDF
              </h2>
              <p className="mt-0.5 truncate max-w-[260px] text-xs text-slate-500">
                {fileName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPassword('');
              onClose();
            }}
            aria-label="Close password dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="pdf-unlock-password-input"
              className="block text-xs font-medium text-slate-700"
            >
              Enter document password (e.g., e-Aadhaar, Bank Statement, or owner password)
            </label>
            <div className="relative mt-1.5">
              <input
                id="pdf-unlock-password-input"
                type={showPassword ? 'text' : 'password'}
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Document password..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide PDF password' : 'Show PDF password'}
                className="absolute top-1.5 right-2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                {showPassword ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {incorrectAttempt && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                Incorrect password. Check uppercase/lowercase letters or digits and try again.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setPassword('');
                onClose();
              }}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isUnlocking}
              className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {isUnlocking ? 'Unlocking...' : 'Unlock & Open PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
