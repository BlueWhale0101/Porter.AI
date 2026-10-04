// Operator-only semantic seeder. Never imported by the production client.
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionConfig } from '../server/config.mjs';
import { createAuthenticatedPorterRuntime } from '../src/runtime.js';
import { acceptanceData, seedAcceptance, seedDay } from './acceptance-data.mjs';

const today=process.argv.find(x=>x.startsWith('--date='))?.slice(7)??seedDay();
const plan=acceptanceData(today);
if(process.argv.includes('--plan')){
  console.log(JSON.stringify({today,dateRange:[plan.start,plan.end],events:plan.events.length,artifacts:plan.tickets.length,eventTitles:plan.events.map(e=>e.title)},null,2));
}else{
  const config=productionConfig();
  // Refuse concurrent seeders on this VPS; never break or delete somebody else's lock.
  const lock=join(tmpdir(),`porter-acceptance-${config.ownerId}.lock`);
  await mkdir(lock,{mode:0o700}).catch(()=>{throw new Error(`Seed lock unavailable: ${lock}. Check for another running seeder before removing a stale lock.`);});
  try{
    let token=process.env.PORTER_SEED_TOKEN;
    if(!token){
      if(!process.stdin.isTTY)throw new Error('Use an interactive terminal for normal Porter sign-in, or supply PORTER_SEED_TOKEN securely in the environment');
      let muted=false;
      const output=new Writable({write(chunk,_encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
      const terminal=createInterface({input:process.stdin,output,terminal:true});
      let email,password;
      try{
        email=(await terminal.question('Porter account email: ')).trim();
        process.stdout.write('Porter password (hidden): ');muted=true;
        password=await terminal.question('');
      }finally{terminal.close();muted=false;process.stdout.write('\n');}
      const client=createClient(config.runtime.PORTER_SUPABASE_URL,config.runtime.PORTER_SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await client.auth.signInWithPassword({email,password});password=null;
      if(error||data.user?.id!==config.ownerId)throw new Error('Porter owner sign-in failed');
      token=data.session.access_token;
    }
    const {service,storage}=await createAuthenticatedPorterRuntime(token,config.runtime);
    if(service.ownerId!==config.ownerId)throw new Error('Seed account must match the configured Porter owner');
    const result=await seedAcceptance(service,storage,{today});
    // Same authenticated client boundary used by Safari; no TLS verification bypass.
    // Verify via the host's private loopback listener (public HTTPS may use a
    // device-installed certificate). This does not claim public/iPhone acceptance.
    const response=await fetch(`http://127.0.0.1:${config.port}/client/trips/${result.tripId}/packet`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Seed saved, but client packet verification failed: HTTP ${response.status}. Rerun safely.`);
    const packet=await response.json();
    if(packet.trip.id!==result.tripId||Object.keys(packet.events).length<result.events)throw new Error('Seed saved, but client packet is incomplete');
    console.log(JSON.stringify({...result,url:`${config.origin}/#${result.tripId}`,semanticSeed:true,clientHttpVerified:true,browserOfflineReadinessVerified:false},null,2));
  }finally{await rmdir(lock);}
}
