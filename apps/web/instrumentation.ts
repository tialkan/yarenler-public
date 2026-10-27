import type {Instrumentation} from 'next';
/**
 * Uncaught server errors (render, route handlers, server actions, proxy) are logged as one
 * redacted JSON line and, when SENTRY_DSN is set, reported to GlitchTip/Sentry.
 * Only the path (no query), method and route are sent; never headers, cookies or tokens.
 */
export const onRequestError:Instrumentation.onRequestError=async(error,request,context)=>{
 if(process.env.NEXT_RUNTIME!=='nodejs')return;
 const [{logServerError},{reportError}]=await Promise.all([import('./src/server/action-errors'),import('./src/server/error-report')]);
 const path=request.path.split('?')[0];
 logServerError('request_failed',error,{path,method:request.method,route:context.routePath,routeType:context.routeType});
 await reportError(error,{kind:context.routeType==='action'?'action':context.routeType==='route'?'route':'request',path,method:request.method,route:context.routePath,routeType:context.routeType});
};
