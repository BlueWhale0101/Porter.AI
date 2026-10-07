import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ConflictError } from './domain.js';

export const MAX_ARTIFACT_BYTES=5*1024*1024;
export function publicIPv4(address){
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function sourceURL(value){
  let url;try{url=new URL(value);}catch{throw new TypeError('Invalid artifact source URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hash||url.hostname.endsWith('.')||url.hostname==='localhost'||/\.(localhost|local|internal|test|invalid)$/.test(url.hostname)||isIP(url.hostname)&&!publicIPv4(url.hostname)||url.hostname.startsWith('['))throw new TypeError('Artifact source must be public HTTPS on port 443');
  return url;
}
// Resolve IPv4 once per hop and pin it into a fresh HTTPS connection. TLS still
// authenticates the original hostname. No proxy, cookie or credential forwarding.
export async function downloadArtifact(value,{resolve=host=>lookup(host,{family:4,all:true}),request=https.request,timeout=15000}={}){
  const controller=new AbortController(),signal=controller.signal,timer=setTimeout(()=>controller.abort(),timeout);
  try{
  for(let redirects=0;redirects<=3;redirects++){
    signal.throwIfAborted();
    const url=sourceURL(value);
    const addresses=await Promise.race([resolve(url.hostname),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new TypeError('Artifact download timed out')),{once:true}))]);
    signal.throwIfAborted();
    if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw new TypeError('Artifact source resolves to a prohibited network');
    const result=await new Promise((resolveResult,reject)=>{
      const req=request(url,{family:4,agent:false,signal,headers:{Accept:'image/png, image/jpeg, application/pdf','Accept-Encoding':'identity'},lookup:(_host,_options,cb)=>cb(null,addresses[0].address,4)},res=>{
        if([301,302,303,307,308].includes(res.statusCode)){res.destroy();if(!res.headers.location)reject(new TypeError('Artifact redirect has no location'));else resolveResult({redirect:res.headers.location});return;}
        if(res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();reject(new TypeError('Artifact source did not return an uncompressed successful document'));return;}
        if(Number(res.headers['content-length'])>MAX_ARTIFACT_BYTES){res.destroy();reject(new TypeError('Artifact exceeds 5 MiB'));return;}
        const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>MAX_ARTIFACT_BYTES){res.destroy();reject(new TypeError('Artifact exceeds 5 MiB'));}else chunks.push(chunk);});
        res.on('error',reject);res.on('end',()=>resolveResult({data:Buffer.concat(chunks),mediaType:res.headers['content-type']}));
      });req.on('error',()=>reject(new TypeError('Artifact download failed or timed out')));req.end();
    });
    if(!result.redirect)return result;
    if(redirects===3)throw new TypeError('Too many artifact redirects');
    value=new URL(result.redirect,url).href;
  }
  }finally{clearTimeout(timer);}
}
export function artifactMedia(data,declared){
  if(!data.length||data.length>MAX_ARTIFACT_BYTES)throw new TypeError('Artifact must contain at most 5 MiB');
  const type=String(declared??'').split(';')[0].trim().toLowerCase();
  const actual=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.length>=45&&data.toString('ascii',12,16)==='IHDR'&&data.readUInt32BE(16)>0&&data.readUInt32BE(20)>0&&data.toString('ascii',data.length-8,data.length-4)==='IEND'?'image/png':data[0]===255&&data[1]===216&&data[2]===255&&data[data.length-2]===255&&data[data.length-1]===217?'image/jpeg':/^%PDF-1\.[0-9]/.test(data.toString('ascii',0,8))&&data.subarray(-1024).includes(Buffer.from('%%EOF'))?'application/pdf':null;
  if(!actual||type!==actual)throw new TypeError('Unsupported or incorrect artifact media type; supply original PNG, JPEG or PDF bytes, not HTML');
  return actual;
}
export async function ingestArtifact(service,{eventId,artifact,source,expectedRevision,staticArtifact},dependencies){
  const event=await service.getEvent(eventId);
  if(event.revision!==expectedRevision)throw new ConflictError(eventId,expectedRevision,event.revision);
  if(staticArtifact!==true)throw new TypeError('Only confirmed static artifacts may be ingested');
  const old=event.artifacts.find(a=>a.id===artifact.id),metadata={...old,...artifact};
  if((event.booking.expectedAdmissions??[]).some(a=>a.status==='external_dynamic'&&(metadata.satisfiesAdmissionIds??[]).includes(a.id)))throw new TypeError('Dynamic admissions must stay in their specialist app');
  if(old?.storageRef.provider==='supabase-storage')throw new TypeError('An owned artifact already exists; do not overwrite it');
  if(Boolean(source?.url)===Boolean(source?.base64))throw new TypeError('Supply exactly one source URL or original base64 payload');
  let bytes,mediaType;
  if(source.url){const result=await downloadArtifact(source.url,dependencies);bytes=result.data;mediaType=artifactMedia(bytes,result.mediaType);if(source.mediaType&&source.mediaType!==mediaType)throw new TypeError('Source media type mismatch');}
  else {if(typeof source.base64!=='string'||source.base64.length>Math.ceil(MAX_ARTIFACT_BYTES/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.base64))throw new TypeError('Invalid or oversized base64 payload');bytes=Buffer.from(source.base64,'base64');mediaType=artifactMedia(bytes,source.mediaType);}
  return service.storeArtifact(eventId,{...metadata,filename:source.filename??`${artifact.id}.${mediaType==='application/pdf'?'pdf':mediaType==='image/png'?'png':'jpg'}`,data:bytes,contentType:mediaType,sourceUrl:source.url??metadata.sourceUrl??old?.storageRef.url,materializeExisting:Boolean(old)},expectedRevision);
}
