// Onklave browser error tracking.
//
// On-platform, the API serves the browser-safe config (the error-tracking
// ingest key) at /api/onklave/config. When it's there, the SDK starts and
// window.onerror + unhandledrejection are captured into the project's error
// triage. Anywhere else (local dev without platform identity) the endpoint
// 404s and this whole module is a silent no-op.
import { OnklaveErrors } from '@onklave/errors';
import { installGlobalHandlers } from '@onklave/errors/browser';

export async function initOnklave(): Promise<void> {
  try {
    const res = await fetch('/api/onklave/config');
    if (!res.ok) return;
    const cfg = (await res.json()) as {
      errorsIngestKey?: string;
      environment?: string | null;
      release?: string | null;
    };
    if (!cfg.errorsIngestKey) return;
    OnklaveErrors.init({
      key: cfg.errorsIngestKey,
      serviceName: 'web',
      release: cfg.release || 'dev',
      environment: cfg.environment || 'development',
    });
    installGlobalHandlers();
  } catch {
    // Never let telemetry break the page.
  }
}
