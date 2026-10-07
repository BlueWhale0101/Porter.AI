import { createHash } from 'node:crypto';
import { ArtifactStorage } from './storage.js';

export class SupabaseArtifactStorage extends ArtifactStorage {
  constructor(client,bucket) { super(); this.client=client; this.bucket=bucket; }
  async put({tripId,eventId,artifactId,filename,data,contentType,upsert=false}) { if(!tripId||!eventId||!artifactId||!filename) throw new TypeError('Trip, Event, artifact, and filename are required for storage'); const key=`${tripId}/${eventId}/${artifactId}/original`; const {error}=await this.client.storage.from(this.bucket).upload(key,data,{contentType,upsert}); if(error) throw error; return {provider:'supabase-storage',bucket:this.bucket,key,filename}; }
  async get(ref) { if(ref?.provider!=='supabase-storage'||ref.bucket!==this.bucket||typeof ref.key!=='string'||ref.key.split('/').length!==4||ref.key.split('/').some(x=>!x||x==='.'||x==='..')||!ref.key.endsWith('/original'))throw new TypeError('Artifact must be ingested into configured Porter storage first');return blob(this.client.storage.from(ref.bucket).download(ref.key)); }
  async delete(ref) { const {data,error}=await this.client.storage.from(ref.bucket).remove([ref.key]); if(error) throw error; if(!data?.some(x=>x.name===ref.key))throw new Error('Artifact removal not confirmed'); }
  async exists(ref) { const {data,error}=await this.client.storage.from(ref.bucket).list(dirname(ref.key),{search:basename(ref.key)}); if(error) throw error; return data.some(item=>item.name===basename(ref.key)); }
  async downloadReference(ref,{expiresIn=300}={}) { const {data,error}=await this.client.storage.from(ref.bucket).createSignedUrl(ref.key,expiresIn); if(error) throw error; return {provider:'supabase-storage',bucket:ref.bucket,key:ref.key,url:data.signedUrl,expiresIn}; }
  async checksum(ref) { return createHash('sha256').update(Buffer.from(await (await this.get(ref)).arrayBuffer())).digest('hex'); }
}
async function blob(promise) { const {data,error}=await promise; if(error) throw error; return data; }
function dirname(key) { const index=key.lastIndexOf('/'); return index<0?'':key.slice(0,index); }
function basename(key) { const index=key.lastIndexOf('/'); return index<0?key:key.slice(index+1); }
