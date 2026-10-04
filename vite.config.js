import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({build:{target:'es2022'},plugins:[{
  name:'porter-offline-shell',
  writeBundle(options,bundle){
    const shell=['/','/index.html','/manifest.webmanifest',...Object.keys(bundle).filter(path=>/\.(js|css)$/.test(path)).map(path=>'/'+path)];
    const id=createHash('sha256').update(JSON.stringify(shell)).digest('hex').slice(0,12);
    const source=readFileSync('public/sw.js','utf8').replace("/*__SHELL_FILES__*/['/','/index.html']",JSON.stringify(shell)).replaceAll('__BUILD_ID__',id);
    writeFileSync(`${options.dir}/sw.js`,source);
  }
}]});
