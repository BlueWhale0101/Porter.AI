import { createClient } from '@supabase/supabase-js';
import { AuthenticationError } from '../src/runtime.js';

const ACCESS='__Host-porter-access',REFRESH='__Host-porter-refresh';
export function cookies(request) {
  return Object.fromEntries((request.headers.cookie??'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x[0]));
}
export function accessCookie(request){return cookies(request)[ACCESS];}
function sessionCookies(response,session) {
  const common='; Path=/; HttpOnly; Secure; SameSite=Strict';
  response.setHeader('Set-Cookie',[
    `${ACCESS}=${session?.access_token??''}${common}; Max-Age=${session?Math.max(1,session.expires_in??3600):0}`,
    `${REFRESH}=${session?.refresh_token??''}${common}; Max-Age=${session?30*24*3600:0}`
  ]);
}
export function installAuth(app,config,{newClient=()=>createClient(config.runtime.PORTER_SUPABASE_URL,config.runtime.PORTER_SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}={}){
  let windowStart=Date.now(),attempts=0;
  app.use('/auth',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.post(['/auth/login','/auth/refresh'],async(req,res)=>{
    if(Date.now()-windowStart>300000){windowStart=Date.now();attempts=0;}
    if(++attempts>30)return res.status(429).json({code:'auth_rate_limited',message:'Wait a few minutes before trying again.'});
    try{
      const client=newClient();let result;
      if(req.path==='/auth/login'){
        const {email,password}=req.body??{};
        if(typeof email!=='string'||typeof password!=='string'||email.length>320||password.length>4096)throw new AuthenticationError('Invalid sign-in');
        result=await client.auth.signInWithPassword({email,password});
      }else{
        const refresh_token=cookies(req)[REFRESH];
        if(!refresh_token)throw new AuthenticationError('Sign in required');
        result=await client.auth.refreshSession({refresh_token});
      }
      if(result.error||!result.data?.session||result.data.user?.id!==config.ownerId)throw new AuthenticationError('Sign in required');
      sessionCookies(res,result.data.session);
      res.json({ok:true});
    }catch{res.status(401).json({code:'authentication_failed',message:'Sign in failed. Check the configured Porter account and password.'});}
  });
  app.post('/auth/logout',async(req,res)=>{
    // Clear this browser's session only. Cached travel data is intentionally retained.
    // Supabase tokens expire normally; no administrative session revocation is implied.
    sessionCookies(res,null);res.json({ok:true});
  });
}
