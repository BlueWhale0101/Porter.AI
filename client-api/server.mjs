import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createAuthenticatedPorterRuntime, AuthenticationError } from '../src/runtime.js';
import { ConflictError } from '../src/domain.js';
import { bearerToken } from '../mcp/server.mjs';
import { deleteAppTrip,tripDeletionPreview,deleteAppEvent,eventDeletionPreview } from '../src/trip-deletion.js';
import { NotFoundError } from '../src/repository.js';

/** The browser boundary deliberately accepts only offline-safe semantic operations. */
export const clientMutations={
  createTrip:(service,args)=>service.createTrip(args.trip),
  updateTrip:(service,args)=>service.updateTrip(args.tripId,args.patch,args.expectedRevision),
  createKnowledge:(service,args)=>service.createKnowledge(args.tripId,args.knowledge),
  clearCurrentParking:(service,args)=>service.clearCurrentParking(args.tripId,args),
  setCurrentParking:(service,args)=>service.setCurrentParking(args.tripId,args.knowledge),
  createEvent:(service,args,mutation)=>service.createEvent(args.tripId,args.event,mutation?.id),
  updateEvent:(service,args)=>service.updateEvent(args.eventId,args.patch,args.expectedRevision),
  updateKnowledge:(service,args)=>service.updateKnowledge(args.knowledgeId,args.patch,args.expectedRevision)
};
export async function dispatchClientMutation(service,mutation){
  const operation=clientMutations[mutation?.operation];
  if(!operation){const error=new TypeError('Unsupported client semantic mutation');error.code='invalid_semantic_input';throw error;}
  return operation(service,mutation.arguments??{},mutation);
}
export async function handleClientMutation(request,runtimeForRequest=token=>createAuthenticatedPorterRuntime(token)){
  const runtime=await runtimeForRequest(bearerToken(request.authorization));
  return dispatchClientMutation(runtime.service,request.body);
}

function publicError(error,response){
  if(error instanceof NotFoundError)return response.status(404).json({code:'not_found',message:'Trip is no longer available'});
  const authentication=error instanceof AuthenticationError,conflict=error instanceof ConflictError,invalid=error instanceof TypeError;
  response.status(authentication?401:conflict?409:invalid?400:503).json({code:authentication?'authentication_failed':conflict?'revision_conflict':invalid?'invalid_semantic_input':'backend_error',message:authentication?'Sign in to synchronize':conflict?'Revision conflict':invalid?error.message:'Porter service is temporarily unavailable'});
}

export function createClientApi(runtimeForRequest=token=>createAuthenticatedPorterRuntime(token),options={}){
  const app=createMcpExpressApp(options);
  app.use((_request,response,next)=>{response.set('Cache-Control','no-store');next();});
  const runtime=async request=>runtimeForRequest(bearerToken(request.headers.authorization));
  app.get('/client/events/:id/deletion',async(request,response)=>{try{response.json(await eventDeletionPreview((await runtime(request)).service,request.params.id));}catch(error){publicError(error,response);}});
  app.delete('/client/events/:id',async(request,response)=>{try{response.json(await deleteAppEvent((await runtime(request)).service,request.params.id,request.body?.expected));}catch(error){publicError(error,response);}});
  app.get('/client/trips/:id/deletion',async(request,response)=>{try{response.json(await tripDeletionPreview((await runtime(request)).service,request.params.id));}catch(error){publicError(error,response);}});
  app.delete('/client/trips/:id',async(request,response)=>{try{response.json(await deleteAppTrip((await runtime(request)).service,request.params.id,request.body?.expected));}catch(error){publicError(error,response);}});
  app.get('/client/trips',async(request,response)=>{try{response.json(await (await runtime(request)).service.listTrips());}catch(error){publicError(error,response);}});
  app.get('/client/trips/:id/packet',async(request,response)=>{try{response.json(await (await runtime(request)).service.tripContext(request.params.id,{perspectiveParticipantId:request.query.perspective,now:request.query.now}));}catch(error){publicError(error,response);}});
  app.get('/client/artifacts/:eventId/:artifactId',async(request,response)=>{try{const caller=await runtime(request);const event=await caller.service.getEvent(request.params.eventId);const artifact=event.artifacts.find(item=>item.id===request.params.artifactId);if(!artifact)return response.status(404).json({code:'not_found'});const blob=await caller.storage.get(artifact.storageRef);response.set('X-Porter-Artifact-Version',artifact.version??'');response.set('X-Porter-Artifact-Checksum',artifact.checksum??'');response.type(artifact.mediaType).send(Buffer.from(await blob.arrayBuffer()));}catch(error){publicError(error,response);}});
  app.post('/client/mutate',async(request,response)=>{try{const result=await handleClientMutation({authorization:request.headers.authorization,body:request.body},runtimeForRequest);response.json(result);}catch(error){publicError(error,response);}});
  return app;
}

if(import.meta.url===`file://${process.argv[1]}`){const app=createClientApi();app.listen(Number(process.env.PORTER_CLIENT_PORT??8789),process.env.PORTER_CLIENT_HOST??'127.0.0.1');}
