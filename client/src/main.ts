import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { initOnklave } from './onklave';

// Fire-and-forget: error tracking starts when the platform serves a config,
// and silently stays off everywhere else (see src/onklave.ts).
void initOnklave();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
