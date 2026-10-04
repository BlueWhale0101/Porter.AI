export function productionConfig(env=process.env) {
  for (const name of ['PORTER_SUPABASE_URL','PORTER_SUPABASE_KEY','PORTER_PUBLIC_ORIGIN','PORTER_OWNER_ID']) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  const origin=new URL(env.PORTER_PUBLIC_ORIGIN),supabase=new URL(env.PORTER_SUPABASE_URL);
  if(origin.protocol!=='https:'||origin.origin!==env.PORTER_PUBLIC_ORIGIN||origin.username||origin.password)throw new Error('PORTER_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  if(supabase.protocol!=='https:'||supabase.username||supabase.password)throw new Error('PORTER_SUPABASE_URL must use HTTPS');
  const key=env.PORTER_SUPABASE_KEY;
  let role;try{role=JSON.parse(Buffer.from(key.split('.')[1]??'','base64url').toString()).role;}catch{}
  if(!key.startsWith('sb_publishable_')&&role!=='anon')throw new Error('PORTER_SUPABASE_KEY must be a publishable/anon key, never a secret or service-role key');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.PORTER_OWNER_ID))throw new Error('PORTER_OWNER_ID must be the provisioned Supabase Auth user UUID');
  const port=Number(env.PORTER_WEB_PORT??8790);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORTER_WEB_PORT must be between 1024 and 65535');
  const bucket=env.PORTER_ARTIFACT_BUCKET??'porter-artifacts';
  if(bucket!=='porter-artifacts')throw new Error('PORTER_ARTIFACT_BUCKET must match the checked-in porter-artifacts policies');
  return {origin:origin.origin,hostname:origin.hostname,port,ownerId:env.PORTER_OWNER_ID,
    runtime:{PORTER_SUPABASE_URL:supabase.origin,PORTER_SUPABASE_KEY:key,PORTER_ARTIFACT_BUCKET:bucket}};
}
