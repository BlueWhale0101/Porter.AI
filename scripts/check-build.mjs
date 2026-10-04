import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const build=JSON.parse(readFileSync('dist/build.json','utf8'));
assert.match(build.revision,/^[0-9a-f]{40}$/);
if(process.argv[2])assert.equal(build.revision,process.argv[2]);
const worker=readFileSync('dist/sw.js','utf8');assert.ok(!worker.includes('__BUILD_ID__'));assert.ok(!worker.includes('__SHELL_FILES__'));assert.ok(worker.includes(build.buildId));
const manifest=JSON.parse(readFileSync('dist/manifest.webmanifest','utf8'));assert.equal(manifest.start_url,'/');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons)assert.ok(readFileSync('dist'+icon.src).length);
for(const path of readdirSync('dist/assets').filter(x=>x.endsWith('.js'))){const js=readFileSync('dist/assets/'+path,'utf8');assert.ok(!js.includes('DEVELOPMENT FIXTURE'));assert.ok(!js.includes('fixture-only'));}
console.log(JSON.stringify({productionBuild:true,...build,icons:manifest.icons.length,fixtureCodeExcluded:true}));
