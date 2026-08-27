import { useCallback, useEffect, useRef, useState } from 'react';

export function useFloatyConfirmation() {
  const [notice, setNotice] = useState(null);
  const timeoutRef = useRef(null);

  const clearNotice = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((message, tone = 'success') => {
    clearNotice();
    setNotice({ kind: 'notice', tone, message });
    timeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      timeoutRef.current = null;
    }, 4200);
  }, [clearNotice]);

  const confirmAction = useCallback((message, { confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'warning' } = {}) => {
    clearNotice();
    return new Promise(resolve => {
      setNotice({
        kind: 'confirm',
        tone,
        message,
        confirmLabel,
        cancelLabel,
        onConfirm: () => {
          setNotice(null);
          resolve(true);
        },
        onCancel: () => {
          setNotice(null);
          resolve(false);
        },
      });
    });
  }, [clearNotice]);

  useEffect(() => () => clearNotice(), [clearNotice]);

  return { notice, showNotice, confirmAction, clearNotice };
}

export default function FloatyConfirmation({ notice, onClose }) {
  if (!notice) return null;

  return (
    <div className={`floaty-confirmation ${notice.tone || 'success'}`} role={notice.kind === 'confirm' ? 'alertdialog' : 'status'} aria-live="polite">
      <div className="floaty-confirmation-message">{notice.message}</div>
      {notice.kind === 'confirm' ? (
        <div className="floaty-confirmation-actions">
          <button type="button" className="secondary-btn" onClick={notice.onCancel}>
            {notice.cancelLabel || 'Cancel'}
          </button>
          <button type="button" className="delete-btn" onClick={notice.onConfirm}>
            {notice.confirmLabel || 'Confirm'}
          </button>
        </div>
      ) : (
        <button type="button" className="floaty-confirmation-close" onClick={onClose} aria-label="Dismiss message">
          x
        </button>
      )}
    </div>
  );
}
