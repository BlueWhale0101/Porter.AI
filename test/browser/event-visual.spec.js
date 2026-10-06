import { test,expect } from '@playwright/test';
import { EVENT_VISUAL_ROLES,eventIconPath } from '../../src/event-visual.js';
let tripId,ids;
test.beforeEach(async({page,context,request})=>{
  await request.post('/__test/reset');({tripId,ids}=await(await request.post('/__test/visuals')).json());
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
  await page.goto(`/#${tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
});
const row=(page,id)=>page.locator(`[data-event="${id}"]`);
const source=async request=>(await(await request.get('/__test/events',{params:{tripId}})).json());
async function edit(page,id){await row(page,id).tap();await page.locator('#details #edit').tap();}

test('shell-cached icons render (Chromium offline; WebKit origin unavailable); Next stays large',async({page,context,request,browserName})=>{
  await expect(page.locator('.next .event-icon')).toHaveCount(0);await expect(page.locator('.next .event-art')).toHaveCount(1);
  await expect(page.locator('.event-icon')).toHaveCount(EVENT_VISUAL_ROLES.length-2);await expect(row(page,ids.none).locator('.event-icon')).toHaveCount(0);
  await expect(page.locator('.next .event-art img')).toHaveAttribute('src','/artwork/event-illustrations/porter-event-flight.webp');
  const paths=EVENT_VISUAL_ROLES.map(eventIconPath).filter(Boolean);
  const cached=await page.evaluate(async paths=>{const keys=await caches.keys();const shell=await caches.open(keys.find(k=>k.startsWith('porter-shell-')));for(const k of keys.filter(k=>k.startsWith('porter-art-')))await caches.delete(k);return Promise.all(paths.map(async p=>Boolean(await shell.match(p))));},paths);
  expect(cached).toEqual(paths.map(()=>true));
  await request.post('/__test/connectivity',{data:{apiAvailable:false,iconsAvailable:false}});
  expect((await request.get(paths[0])).status()).toBe(503);
  // Linux WebKit offline emulation rejects controlled fetches before the SW.
  // Refuse origin delivery there; Chromium also disables the whole network.
  if(browserName==='chromium')await context.setOffline(true);
  const dataRequests=[];page.on('request',r=>{if(r.url().includes('/client/'))dataRequests.push(r.url());});
  // Fetch every derivative after deleting the optional art cache: actual SW response, no network.
  const delivered=await page.evaluate(async paths=>Promise.all(paths.map(async p=>{const r=await fetch(p);return r.ok&&(await r.blob()).size>0;})),paths);expect(delivered).toEqual(paths.map(()=>true));
  await page.locator('.tabs [data-surface=itinerary]').tap();await expect(page.locator('#app')).toHaveAttribute('data-surface','itinerary');await expect(row(page,ids.none).locator('.event-icon')).toHaveCount(0);
  for(const role of EVENT_VISUAL_ROLES.slice(1)){
    const img=row(page,ids[role]).locator('.event-icon img');await img.scrollIntoViewIfNeeded();await expect(img).toHaveAttribute('src',eventIconPath(role));
    await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0&&el.naturalWidth<=144)).toBe(true);
    expect(await img.locator('..').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}))).toEqual({width:68,height:68});
  }
  await row(page,ids.museum).tap();await expect(page.locator('#details h2')).toContainText('Illustration museum');await page.locator('#details #close').tap();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(dataRequests).toEqual([]);
});

test('Add/Edit visual choice survives pending IndexedDB reload, sync, perspective and clearing',async({page,request})=>{
  await page.locator('.tabs [data-surface=itinerary]').tap();await page.locator('#add-event').tap();
  await expect(page.locator('[name=visualRole]')).toHaveValue('none');await expect(page.locator('[name=visualRole] option')).toHaveCount(EVENT_VISUAL_ROLES.length);
  await page.locator('[name=title]').fill('Manual food');await page.locator('[name=visualRole]').selectOption({label:'Food'});await page.locator('[data-save-event]').tap();await expect(page.locator('#quick-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await source(request)).some(e=>e.title==='Manual food')).toBe(true);const added=(await source(request)).find(e=>e.title==='Manual food');expect(added.visual.visual_role).toBe('food');await expect(row(page,added.id).locator('.event-icon')).toHaveCount(1);
  await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  await edit(page,ids.museum);await expect(page.locator('[name=visualRole]')).toHaveValue('museum');await page.locator('[name=visualRole]').selectOption('food');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();
  await expect(row(page,ids.museum).locator('img')).toHaveAttribute('src',eventIconPath('food'));expect((await source(request)).find(e=>e.id===ids.museum).visual.visual_role).toBe('museum');
  await page.reload();await expect(row(page,ids.museum).locator('img')).toHaveAttribute('src',eventIconPath('food'));await expect(row(page,ids.museum)).toContainText('Pending sync');
  await request.post('/__test/connectivity',{data:{apiAvailable:true}});await page.locator('#refresh').tap();await expect(page.locator('#status')).toHaveText('Sync complete');
  // Packet refresh precedes queue replay; wait for semantic acknowledgement,
  // then for the authoritative packet to replace the pending overlay.
  await expect.poll(async()=>(await source(request)).find(e=>e.id===ids.museum).visual).toEqual({visual_role:'food',color:'sky'});
  await expect(row(page,ids.museum)).not.toContainText('Pending sync');
  await Promise.all([page.waitForResponse(r=>r.url().includes('/packet?perspective=wes')&&r.ok()),page.locator('#perspective').selectOption('wes')]);await expect(page.locator('#status')).toHaveText('Sync complete');await expect(row(page,ids.museum).locator('img')).toHaveAttribute('src',eventIconPath('food'));
  await edit(page,ids.museum);await page.locator('[name=visualRole]').selectOption('none');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();await expect(row(page,ids.museum).locator('.event-icon')).toHaveCount(0);
  await expect.poll(async()=>(await source(request)).find(e=>e.id===ids.museum).visual).toEqual({visual_role:'none',color:'sky'});
});
