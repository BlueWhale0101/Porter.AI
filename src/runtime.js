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
export class AuthenticationError extends Error { constructor(message) { super(message); this.name='AuthenticationError'; } }
function requireValue(config,key) { if(!config[key]) throw new Error(`${key} is required`); return config[key]; }
