import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { productionConfig } from '../server/config.mjs';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createOwnerPorterRuntime } from '../src/runtime.js';
import { ConflictError } from '../src/domain.js';
import { HierarchyError } from '../src/persistent-service.js';
import { NotFoundError, OwnershipError } from '../src/repository.js';
import { AuthenticationError } from '../src/runtime.js';
import { EVENT_VISUAL_ROLES } from '../src/event-visual.js';
import { ingestArtifact,MAX_ARTIFACT_BYTES } from '../src/artifact-ingestion.js';

const json = value => ({content:[{type:'text',text:JSON.stringify(value,null,2)}]});
export const mcpError = error => ({isError:true,content:[{type:'text',text:JSON.stringify({error:{code:errorCode(error),message:error.message}})}]});
const invoke = operation => async input => { try { return json(await operation(input)); } catch(error) { return mcpError(error); } };
const record=z.record(z.unknown()); const revision=z.number().int().positive();
// Retain extensible Event aspects while exposing the deliberate visual choice to Assistant.
const eventFields=z.object({visual:z.object({visual_role:z.enum(EVENT_VISUAL_ROLES).nullable().optional().describe('Optional presentation artwork only; omitted/null/none means no small icon. Choose deliberately; never an Event type.')}).passthrough().nullable().optional()}).passthrough();

/** Semantic MCP surface: no table or SQL operations are exposed. */
export function createPorterMcpServer(service) {
  const server=new McpServer({name:'Porter.AI',version:'0.1.0'});
  server.registerTool('store_artifact',{description:'Copy an authoritative STATIC PNG/JPEG/PDF into Porter-owned storage (5 MiB maximum). Supply a public HTTPS URL or exact original base64 bytes. Never use for rotating credentials. Same ID can materialize existing external metadata, not overwrite owned bytes. Success means server storage only; phone must sync and verify before offline-ready.',inputSchema:{eventId:z.string().uuid(),expectedRevision:revision,staticArtifact:z.literal(true),artifact:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),role:z.string().optional(),participantIds:z.array(z.string()).optional(),satisfiesAdmissionIds:z.array(z.string()).optional(),offlineRequired:z.boolean().optional(),version:z.string().optional()}).strict(),source:z.object({url:z.string().max(8192).optional(),base64:z.string().max(Math.ceil(MAX_ARTIFACT_BYTES/3)*4).optional(),mediaType:z.enum(['image/png','image/jpeg','application/pdf']).optional(),filename:z.string().max(200).optional()}).strict()}},invoke(x=>ingestArtifact(service,x)));
  server.registerTool('list_trips',{description:'List Trips owned by the authenticated Porter account.',inputSchema:{}},invoke(()=>service.listTrips()));
  server.registerTool('get_trip',{description:'Get one owned Trip source object.',inputSchema:{tripId:z.string().uuid()}},invoke(({tripId})=>service.getTrip(tripId)));
  server.registerTool('get_trip_context',{description:'Get deterministic TripPacket context. Device-local artifact readiness is not claimed.',inputSchema:{tripId:z.string().uuid(),perspectiveParticipantId:z.string().optional(),now:z.string().datetime().optional()}},invoke(({tripId,...options})=>service.tripContext(tripId,options)));
  server.registerTool('create_trip',{description:'Create an owned Trip from semantic Trip fields.',inputSchema:{trip:record}},invoke(({trip})=>service.createTrip(trip)));
  server.registerTool('update_trip',{description:'Patch an owned Trip with optimistic revision.',inputSchema:{tripId:z.string().uuid(),patch:record,expectedRevision:revision}},invoke(x=>service.updateTrip(x.tripId,x.patch,x.expectedRevision)));
  server.registerTool('create_event',{description:'Create a sparse or detailed generic Event within an owned Trip. Optional visual.visual_role selects a Porter illustration; it has no domain semantics.',inputSchema:{tripId:z.string().uuid(),event:eventFields}},invoke(x=>service.createEvent(x.tripId,x.event)));
  server.registerTool('update_event',{description:'Patch an Event with optimistic revision and hierarchy validation. visual replaces the visual aspect: preserve its other fields when changing visual_role; none clears the small icon.',inputSchema:{eventId:z.string().uuid(),patch:eventFields,expectedRevision:revision}},invoke(x=>service.updateEvent(x.eventId,x.patch,x.expectedRevision)));
  server.registerTool('create_knowledge',{description:'Create sparse Trip Knowledge.',inputSchema:{tripId:z.string().uuid(),knowledge:record}},invoke(x=>service.createKnowledge(x.tripId,x.knowledge)));
  server.registerTool('update_knowledge',{description:'Patch Knowledge with optimistic revision.',inputSchema:{knowledgeId:z.string().uuid(),patch:record,expectedRevision:revision}},invoke(x=>service.updateKnowledge(x.knowledgeId,x.patch,x.expectedRevision)));
  server.registerTool('attach_artifact_metadata',{description:'Metadata only: does not ingest bytes or make external tickets offline-capable. Use store_artifact for static ticket originals.',inputSchema:{eventId:z.string().uuid(),artifact:record,expectedRevision:revision}},invoke(x=>service.attachArtifactMetadata(x.eventId,x.artifact,x.expectedRevision)));
  for(const [name,method,id] of [['export_trip','exportTrip','tripId'],['export_event','exportEvent','eventId'],['export_knowledge','exportKnowledge','knowledgeId']]) server.registerTool(name,{description:`Export ${name.slice(7)} source truth as text or JSON.`,inputSchema:{[id]:z.string().uuid(),format:z.enum(['text','json']).default('text')}},invoke(x=>service[method](x[id],x.format)));
  return server;
}
export function errorCode(error) { if(error instanceof AuthenticationError) return 'authentication_failed'; if(error instanceof ConflictError) return 'revision_conflict'; if(error instanceof HierarchyError) return 'invalid_hierarchy'; if(error instanceof NotFoundError) return 'not_found'; if(error instanceof OwnershipError) return 'ownership_denied'; if(error?.name==='StorageError') return 'storage_error'; if(error?.name==='BackendError' || error?.code || error?.status>=500) return 'backend_error'; return 'invalid_semantic_input'; }
export function bearerToken(header) { const match=/^Bearer\s+(.+)$/i.exec(header??''); if(!match) throw new AuthenticationError('Bearer token is required'); return match[1].trim(); }
export function matchesMcpToken(actual,expected) {
  const a=Buffer.from(actual??''),b=Buffer.from(expected??'');
  return a.length===b.length && a.length>0 && timingSafeEqual(a,b);
}
export function assertMcpRequest(req,expectedToken) {
  if(req.headers.origin) throw new AuthenticationError('Browser-originated MCP requests are not allowed');
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host??'')) throw new AuthenticationError('MCP endpoint is loopback-only');
  if(!expectedToken || !matchesMcpToken(bearerToken(req.headers.authorization),expectedToken)) throw new AuthenticationError('Invalid MCP bearer token');
}
export function createPorterHttpApp(mcpToken){
  const app=express();
  app.use('/mcp',(req,res,next)=>{try{assertMcpRequest(req,mcpToken);next();}catch{res.status(401).json({error:'Authentication failed'});}},express.json({limit:'8mb'}));
  app.use(createMcpExpressApp());
  return app;
}

if(import.meta.url===`file://${process.argv[1]}`) {
  const config=productionConfig();
  const mcpToken=process.env.PORTER_MCP_BEARER_TOKEN;
  if(!mcpToken) throw new Error('PORTER_MCP_BEARER_TOKEN is required');
  const {service}=createOwnerPorterRuntime(config.ownerId,{...config.runtime,PORTER_MCP_SUPABASE_KEY:process.env.PORTER_MCP_SUPABASE_KEY});
  const port=Number(process.env.PORTER_MCP_PORT ?? 8791); const host=process.env.PORTER_MCP_HOST ?? '127.0.0.1';
  const app=createPorterHttpApp(mcpToken);
  app.get('/health',(_req,res)=>res.json({ok:true,service:'Porter.AI'}));
  app.post('/mcp',async(req,res)=>{ let transport; let server; try { assertMcpRequest(req,mcpToken); server=createPorterMcpServer(service); transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); await server.connect(transport); await transport.handleRequest(req,res,req.body); } catch(error) { if(!res.headersSent) res.status(error instanceof AuthenticationError?401:500).json({jsonrpc:'2.0',error:{code:-32603,message:error instanceof AuthenticationError?'Authentication failed':'Porter MCP server error'},id:null}); } finally { if(transport&&server) res.on('close',()=>{ transport.close(); server.close(); }); } });
  app.listen(port,host,()=>console.log(`Porter MCP listening on http://${host}:${port}/mcp`));
}
