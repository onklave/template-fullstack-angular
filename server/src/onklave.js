// Onklave platform runtime wiring. On-platform, per-environment secrets
// (DATABASE_URL, ONKLAVE_*_KEY, anything set in the project's app-secrets)
// are injected into process.env and error tracking starts. Off-platform
// (local dev, CI) every step is a silent no-op — the app runs unchanged.
import { injectOnklaveSecrets } from '@onklave/app-runtime';
import { OnklaveErrors } from '@onklave/errors';

export { OnklaveErrors };

/**
 * Initialise the Onklave runtime. Call once at process start, before anything
 * reads configuration from the environment.
 * @param {string} serviceName Reported with every captured error.
 */
export async function initOnklave(serviceName) {
  try {
    await injectOnklaveSecrets();
  } catch {
    // Not running on Onklave — keep whatever environment is already set.
  }
  if (process.env.ONKLAVE_ERRORS_INGEST_KEY) {
    OnklaveErrors.init({
      key: process.env.ONKLAVE_ERRORS_INGEST_KEY,
      serviceName,
      release: process.env.ONKLAVE_COMMIT_SHA || 'dev',
      environment: process.env.ONKLAVE_ENV || 'development',
    });
  }
}
