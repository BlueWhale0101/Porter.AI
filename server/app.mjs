import express from 'express';
import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createClientApi } from '../client-api/server.mjs';
import { createAuthenticatedPorterRuntime, AuthenticationError } from '../src/runtime.js';
import { accessCookie,installAuth } from './auth.mjs';

export function createProductionApp({config,dist,build,runtimeForToken=token=>createAuthenticatedPorterRuntime(token,config.runtime),authOptions,logger=entry=>console.log(JSON.stringify(entry))}) {
  const hosts={allowedHosts:[config.hostname,'127.0.0.1','localhost']};
  const app=createMcpExpressApp(hosts);app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const requestId=randomUUID();res.set('X-Request-ID',requestId);
    res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');
    res.set('X-Frame-Options','DENY');
    // Existing Calendar geometry uses inline styles; scripts remain local and external.
    res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.on('finish',()=>logger({requestId,method:req.method,route:req.path.startsWith('/client/')?'/client':req.path.startsWith('/auth/')?'/auth':'/static',status:res.statusCode,revision:build.revision}));
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==config.origin&&!(req.headers.authorization&&!req.headers.origin))return res.status(403).json({code:'origin_denied'});
    next();
  });
  app.get('/health',(_req,res)=>res.set('Cache-Control','no-store').json({ok:true,service:'Porter.AI',revision:build.revision,buildId:build.buildId}));
  installAuth(app,config,authOptions);
  const ownedRuntime=async token=>{const runtime=await runtimeForToken(token);if(runtime.service.ownerId!==config.ownerId)throw new AuthenticationError('Account is not authorized for this Porter deployment');return runtime;};
  app.use('/client',(req,_res,next)=>{if(!req.headers.authorization){const token=accessCookie(req);if(token)req.headers.authorization=`Bearer ${token}`;}next();});
  app.use(createClientApi(ownedRuntime,hosts));
  app.use(['/client','/auth','/mcp'],(_req,res)=>res.status(404).set('Cache-Control','no-store').json({code:'not_found'}));
  app.use(express.static(dist,{dotfiles:'deny',index:'index.html',setHeaders(res,path){res.setHeader('Cache-Control',/\/assets\//.test(path)?'public, max-age=31536000, immutable':'no-cache');if(path.endsWith('/sw.js'))res.setHeader('Service-Worker-Allowed','/');}}));
  app.use((_req,res)=>res.status(404).set('Cache-Control','no-store').json({code:'not_found'}));
  app.use((error,_req,res,_next)=>{res.status(error.status===413?413:500).set('Cache-Control','no-store').json({code:error.status===413?'request_too_large':'server_error'});});
  return app;
}
