import { createClient } from '@supabase/supabase-js';
import { SupabasePorterRepository } from './repository.js';
import { PersistentPorterService } from './persistent-service.js';
import { SupabaseArtifactStorage } from './supabase-storage.js';

export async function createAuthenticatedPorterRuntime(accessToken, config = process.env) {
  const url=requireValue(config,'PORTER_SUPABASE_URL');
  const key=requireValue(config,'PORTER_SUPABASE_KEY');
  if(!accessToken) throw new AuthenticationError('Bearer token is required');
  const bucket=config.PORTER_ARTIFACT_BUCKET ?? 'porter-artifacts';
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${accessToken}`}}});
  const {data,error}=await client.auth.getUser(accessToken);
  if(error || !data.user) throw new AuthenticationError('Porter authentication failed');
  const storage=new SupabaseArtifactStorage(client,bucket);
  return { service:new PersistentPorterService(new SupabasePorterRepository(client),data.user.id,storage), storage, client };
}

/**
 * Private single-owner MCP runtime.
 *
 * ChatGPT/tunnel authentication is deliberately separate from Supabase. The MCP
 * process uses a server-only Supabase service credential and then hard-scopes
 * every semantic Porter operation to the provisioned owner ID. The credential
 * never reaches the browser or tunnel and the normal web runtime continues to
 * use only the publishable/anon key plus the signed-in user's JWT.
 */
export function createOwnerPorterRuntime(ownerId, config = process.env) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId??'')) throw new AuthenticationError('Provisioned Porter owner is invalid');
  const url=requireValue(config,'PORTER_SUPABASE_URL');
  const key=requireValue(config,'PORTER_MCP_SUPABASE_KEY');
  assertServiceCredential(key);
  const bucket=config.PORTER_ARTIFACT_BUCKET ?? 'porter-artifacts';
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const storage=new SupabaseArtifactStorage(client,bucket);
  return { service:new PersistentPorterService(new SupabasePorterRepository(client),ownerId,storage), storage, client };
}

export function assertServiceCredential(key) {
  if(key?.startsWith('sb_secret_')) return key;
  let role;
  try { role=JSON.parse(Buffer.from(String(key).split('.')[1]??'','base64url').toString()).role; } catch {}
  if(role!=='service_role') throw new AuthenticationError('PORTER_MCP_SUPABASE_KEY must be a server-only Supabase secret/service-role key');
  return key;
}

export class AuthenticationError extends Error { constructor(message) { super(message); this.name='AuthenticationError'; } }
function requireValue(config,key) { if(!config[key]) throw new Error(`${key} is required`); return config[key]; }
