import {reportClientError} from './src/components/client-error-report';
// Uncaught browser errors from our own scripts; extension and third party noise is ignored.
try{
 window.addEventListener('error',event=>{if(!(event.error instanceof Error))return;if(event.filename&&!event.filename.startsWith(location.origin))return;if(/ResizeObserver loop/.test(event.message))return;reportClientError(event.error);});
 window.addEventListener('unhandledrejection',event=>{if(event.reason instanceof Error)reportClientError(event.reason);});
}catch{/* monitoring must never block the app */}
