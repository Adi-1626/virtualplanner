/**
 * Show a failed request in the app's toast, the neutral way (components/ui/ErrorNotice.tsx inside the toast):
 * catalogue message + action, the reference with Copy, and Try again when `retry` is given and can help.
 * AppShell listens for the event; nothing happens when no shell is mounted (tests, workers).
 */
import type { ErrorContext } from './errorCatalogue';

export const ERROR_TOAST_EVENT = 'uos:error-toast';

export interface ErrorToastDetail { error: unknown; context?: ErrorContext; retry?: () => void }

export function showErrorToast(error: unknown, opts: { context?: ErrorContext; retry?: () => void } = {}): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ErrorToastDetail>(ERROR_TOAST_EVENT, { detail: { error, ...opts } }));
}
