import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createAuthenticatedPorterRuntime } from '../src/runtime.js';
import { ConflictError } from '../src/domain.js';
import { HierarchyError } from '../src/persistent-service.js';
import { NotFoundError, OwnershipError } from '../src/repository.js';

const json = value => ({content:[{type:'text',text:JSON.stringify(value,null,2)}]});
export const mcpError = error => ({isError:true,content:[{type:'text',text:JSON.stringify({error:{code:errorCode(error),message:error.message}})}]});
const invoke = operation => async input => { try { return json(await operation(input)); } catch(error) { return mcpError(error); } };
const record=z.record(z.unknown()); const revision=z.number().int().positive();

/** Semantic MCP surface: no table or SQL operations are exposed. */
export function createPorterMcpServer(service) {
  const server=new McpServer({name:'Porter.AI',version:'0.1.0'});
  server.registerTool('list_trips',{description:'List Trips owned by the authenticated caller.',inputSchema:{}},invoke(()=>service.listTrips()));
  server.registerTool('get_trip',{description:'Get one owned Trip source object.',inputSchema:{tripId:z.string().uuid()}},invoke(({tripId})=>service.getTrip(tripId)));
  server.registerTool('get_trip_context',{description:'Get deterministic TripPacket context. Device-local artifact readiness is not claimed.',inputSchema:{tripId:z.string().uuid(),perspectiveParticipantId:z.string().optional(),now:z.string().datetime().optional()}},invoke(({tripId,...options})=>service.tripContext(tripId,options)));
  server.registerTool('create_trip',{description:'Create an owned Trip from semantic Trip fields.',inputSchema:{trip:record}},invoke(({trip})=>service.createTrip(trip)));
  server.registerTool('update_trip',{description:'Patch an owned Trip with optimistic revision.',inputSchema:{tripId:z.string().uuid(),patch:record,expectedRevision:revision}},invoke(x=>service.updateTrip(x.tripId,x.patch,x.expectedRevision)));
  server.registerTool('create_event',{description:'Create a sparse or detailed generic Event within an owned Trip.',inputSchema:{tripId:z.string().uuid(),event:record}},invoke(x=>service.createEvent(x.tripId,x.event)));
  server.registerTool('update_event',{description:'Patch an Event with optimistic revision and hierarchy validation.',inputSchema:{eventId:z.string().uuid(),patch:record,expectedRevision:revision}},invoke(x=>service.updateEvent(x.eventId,x.patch,x.expectedRevision)));
  server.registerTool('create_knowledge',{description:'Create sparse Trip Knowledge.',inputSchema:{tripId:z.string().uuid(),knowledge:record}},invoke(x=>service.createKnowledge(x.tripId,x.knowledge)));
  server.registerTool('update_knowledge',{description:'Patch Knowledge with optimistic revision.',inputSchema:{knowledgeId:z.string().uuid(),patch:record,expectedRevision:revision}},invoke(x=>service.updateKnowledge(x.knowledgeId,x.patch,x.expectedRevision)));
  server.registerTool('attach_artifact_metadata',{description:'Attach Event-owned artifact metadata; storage references remain opaque.',inputSchema:{eventId:z.string().uuid(),artifact:record,expectedRevision:revision}},invoke(x=>service.attachArtifactMetadata(x.eventId,x.artifact,x.expectedRevision)));
  for(const [name,method,id] of [['export_trip','exportTrip','tripId'],['export_event','exportEvent','eventId'],['export_knowledge','exportKnowledge','knowledgeId']]) server.registerTool(name,{description:`Export ${name.slice(7)} source truth as text or JSON.`,inputSchema:{[id]:z.string().uuid(),format:z.enum(['text','json']).default('text')}},invoke(x=>service[method](x[id],x.format)));
  return server;
}
export function errorCode(error) { if(error instanceof ConflictError) return 'revision_conflict'; if(error instanceof HierarchyError) return 'invalid_hierarchy'; if(error instanceof NotFoundError) return 'not_found'; if(error instanceof OwnershipError) return 'ownership_denied'; return 'invalid_semantic_input'; }

if(import.meta.url===`file://${process.argv[1]}`) {
  const port=Number(process.env.PORTER_MCP_PORT ?? 8788); const host=process.env.PORTER_MCP_HOST ?? '127.0.0.1';
  const app=createMcpExpressApp();
  app.get('/health',(_req,res)=>res.json({ok:true,service:'Porter.AI'}));
  app.post('/mcp',async(req,res)=>{ const {service}=await createAuthenticatedPorterRuntime(); const server=createPorterMcpServer(service); const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); try { await server.connect(transport); await transport.handleRequest(req,res,req.body); } catch(error) { if(!res.headersSent) res.status(500).json({jsonrpc:'2.0',error:{code:-32603,message:'Porter MCP server error'},id:null}); } finally { res.on('close',()=>{ transport.close(); server.close(); }); } });
  app.listen(port,host,()=>console.log(`Porter MCP listening on http://${host}:${port}/mcp`));
}
