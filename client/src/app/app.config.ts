import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // No interceptor, no auth header, no base-URL token: requests to /api are
    // same-origin, so the browser attaches whatever session it already has.
    provideHttpClient(withFetch()),
  ],
};
