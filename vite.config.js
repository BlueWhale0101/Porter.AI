import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
export default defineConfig({define:{__PORTER_REVISION__:JSON.stringify(revision)},build:{target:'es2022'},plugins:[{
  name:'porter-offline-shell',
  writeBundle(options,bundle){
    const shell=['/','/index.html','/manifest.webmanifest','/artwork/brand/porter-app-icon-192.png','/artwork/brand/porter-app-icon-512.png','/artwork/brand/porter-app-icon-180.png',...Object.keys(bundle).filter(path=>/\.(js|css)$/.test(path)).map(path=>'/'+path)];
    const hash=createHash('sha256').update(JSON.stringify(shell)).update(readFileSync('public/manifest.webmanifest')).update(readFileSync('public/sw.js')).update(readFileSync(`${options.dir}/index.html`)).update(revision);
    for(const path of readdirSync('public/artwork',{recursive:true}).sort())if(/\.(webp|png)$/.test(path))hash.update(path).update(readFileSync('public/artwork/'+path));
    const id=hash.digest('hex').slice(0,12);
    const source=readFileSync('public/sw.js','utf8').replace("/*__SHELL_FILES__*/['/','/index.html']",JSON.stringify(shell)).replaceAll('__BUILD_ID__',id).replaceAll('__REVISION__',revision);
    writeFileSync(`${options.dir}/sw.js`,source);
    writeFileSync(`${options.dir}/build.json`,JSON.stringify({revision,buildId:id})+'\n');
  }
}]});
