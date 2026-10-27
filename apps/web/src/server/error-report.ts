import {createReporter,type ErrorContext} from './error-tracking';
/**
 * Server side error reporting, on only when SENTRY_DSN is set (self-hosted GlitchTip or Sentry).
 * Release comes from Coolify's SOURCE_COMMIT. Callers never await longer than the 3 s timeout.
 */
const state=globalThis as unknown as {yarenlerReporter?:ReturnType<typeof createReporter>};
function reporter(){return state.yarenlerReporter??=createReporter({dsn:process.env.SENTRY_DSN,fetch:(url,init)=>fetch(url,{...init,cache:'no-store'} as RequestInit),environment:process.env.SENTRY_ENVIRONMENT||(process.env.NODE_ENV==='production'?'production':'development'),release:process.env.SOURCE_COMMIT||undefined,platform:'node'});}
export function errorTrackingEnabled(){return Boolean(process.env.SENTRY_DSN);}
export async function reportError(error:unknown,context:ErrorContext){try{await reporter()(error,context);}catch{/* never let reporting fail a request */}}
