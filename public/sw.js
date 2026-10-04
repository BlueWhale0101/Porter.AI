const SHELL=/*__SHELL_FILES__*/['/','/index.html'];
const SHELL_CACHE='porter-shell-__BUILD_ID__',ART_CACHE='porter-art-__BUILD_ID__';
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('porter-shell-')&&key!==SHELL_CACHE)||(key.startsWith('porter-art-')&&key!==ART_CACHE)).map(key=>caches.delete(key))))));
self.addEventListener('message',event=>{if(event.data?.type==='porter-build')event.ports?.[0]?.postMessage({buildId:'__BUILD_ID__',shellCache:SHELL_CACHE,artCache:ART_CACHE});});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/client/')||url.pathname.startsWith('/auth/')||url.pathname==='/health'||url.pathname==='/build.json'||request.headers.has('Authorization'))return;
  if(SHELL.includes(url.pathname)){event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(url.pathname))??fetch(request)));return;}
  if(url.pathname.startsWith('/artwork/')){
    event.respondWith(caches.open(ART_CACHE).then(async cache=>{
      const cached=await cache.match(request);if(cached)return cached;
      try{const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());const keys=await cache.keys();await Promise.all(keys.slice(0,Math.max(0,keys.length-24)).map(key=>cache.delete(key)));}return response;}
      catch{return new Response('',{status:503});}
    }));return;
  }
  if(request.mode==='navigate'||SHELL.includes(url.pathname))event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(request.mode==='navigate'?'/index.html':url.pathname))??fetch(request)));
});
