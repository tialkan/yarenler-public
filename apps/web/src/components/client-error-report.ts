import {createReporter} from '@/server/error-tracking';
/** Browser errors go to the same GlitchTip/Sentry DSN; off when the page carries no DSN meta tag. */
let report:ReturnType<typeof createReporter>|null=null;
function reporter(){if(!report){const meta=(name:string)=>document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')||undefined;report=createReporter({dsn:meta('yarenler-error-dsn'),release:meta('application-version'),fetch:(url,init)=>fetch(url,init as RequestInit),platform:'javascript',perMinute:5});}return report;}
export function reportClientError(error:unknown){try{if(typeof document!=='undefined')void reporter()(error,{kind:'client',path:location.pathname});}catch{/* reporting never breaks the page */}}
