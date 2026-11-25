/**
 * The one way the app shows a failed request: calm and neutral (no red, no raw error text), a short specific message
 * and action from lib/errorCatalogue.ts, the reference (the request's X-Request-ID, which is on its line in
 * backend/logs/urbanos.log) with a Copy button, and Retry when the caller can retry and retrying can help.
 *
 * Give it the thrown `error` (preferred) or a `message` string that has travelled through string-only code (a
 * "Reference: …" at its end is picked up).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Check, Info, RefreshCw } from 'lucide-react';
import { friendlyFrom, type ErrorContext } from '../../lib/errorCatalogue';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* clipboard blocked: fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function ReferenceCopy({ reference, requestId }: { reference: string; requestId?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  return (
    <span className="uos-notice-ref">
      Reference: <code data-testid="error-reference">{reference}</code>
      <button type="button" className="uos-notice-btn" onClick={() => void copyText(requestId ?? reference).then(setCopied)}
        aria-label={copied ? 'Reference copied' : 'Copy reference'} title={copied ? 'Copied' : 'Copy reference'}>
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}{copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export interface ErrorNoticeProps {
  error?: unknown;
  message?: string | null;
  context?: ErrorContext;
  /** Offered only when the failure is retryable (or reload is suggested). */
  onRetry?: () => void;
  /** Text before the message, e.g. "Could not load records:" (kept short). */
  prefix?: string;
  /** Extra content under the message (a hint the panel already had). */
  children?: ReactNode;
  className?: string;
  /** Without the box (inside a toast). */
  bare?: boolean;
}

export function ErrorNotice({ error, message, context, onRetry, prefix, children, className = '', bare }: ErrorNoticeProps) {
  const f = friendlyFrom(error, message, context);
  const canRetry = !!onRetry && (f.retryable || f.reload);
  return (
    <div className={`${bare ? 'uos-notice-bare' : 'uos-notice'} ${className}`} role="status" aria-live="polite" data-testid="error-notice" data-error-key={f.key}>
      {!bare && <Info size={14} aria-hidden className="shrink-0 mt-0.5 uos-notice-icon" />}
      <div className="flex flex-col gap-1 min-w-0">
        <span>{prefix ? `${prefix} ` : ''}{f.message}{f.action ? ` ${f.action}` : ''}</span>
        {children}
        {(f.reference || canRetry) && (
          <span className="flex flex-wrap items-center gap-2">
            {f.reference && <ReferenceCopy reference={f.reference} requestId={f.requestId} />}
            {canRetry && (
              <button type="button" className="uos-notice-btn" onClick={onRetry} data-testid="error-retry">
                <RefreshCw size={12} aria-hidden />{f.reload ? 'Reload' : 'Try again'}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
