import { test,expect } from '@playwright/test';

let tripId,eventId;
test.beforeEach(async({page,context,request})=>{
  ({tripId,eventId}=await (await request.post('/__test/reset')).json());
  // Only the auth credential is supplied by the test. HTTP responses, projection,
  // IndexedDB transactions, rendered production bundle and worker are real.
  // Cookies survive worker-controlled reloads, where WebKit request routing does
  // not reliably intercept page requests. Only the test server recognizes this cookie.
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
  await page.goto(`/?porter-diagnostics=1#${tripId}`);
  await expect(page.locator('#status')).toHaveText('Sync complete');
  await expect(page.locator('#app h1')).toHaveText('Browser regression Trip');
  await page.evaluate(()=>navigator.serviceWorker.ready);
});
async function hold(request){await request.post('/__test/hold');}
async function waitForPacketRequest(request){await expect.poll(async()=> (await (await request.get('/__test/state')).json()).waiting).toBeGreaterThan(0);}
async function diagnostics(page){
  const panel=page.locator('#porter-diagnostics');
  if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();
  await panel.locator('[data-refresh]').click();
  await expect(panel.locator('pre')).toContainText('localPacketUsable');
  return JSON.parse(await panel.locator('pre').innerText());
}
async function navigateSurfaces(page){
  for(const surface of ['itinerary','calendar','journey']){
    await page.locator(`.tabs button[data-surface="${surface}"]`).tap();
    await expect(page.locator('#app')).toHaveAttribute('data-surface',surface);
    await expect(page.locator(`.tabs button[data-surface="${surface}"]`)).toHaveAttribute('aria-pressed','true');
    if(surface==='itinerary')await expect(page.locator('.itinerary-day')).toBeVisible();
    if(surface==='calendar')await expect(page.locator('.calendar')).toBeVisible();
  }
}
test('Journey → Itinerary → Calendar after local-first startup',async({page})=>{
  await navigateSurfaces(page);
  // Layout metadata on main must not turn the entire app into a navigation control.
  expect(await page.locator('#app').evaluate(el=>el.onclick)).toBeNull();
});
test('Quick Actions survives activation and deferred background synchronization',async({page,request})=>{
  await hold(request);await page.locator('#refresh').tap();await waitForPacketRequest(request);
  await page.locator('#quick').tap();
  await request.post('/__test/release');
  await expect(page.locator('#status')).toHaveText('Update ready when you finish');
  await expect(page.locator('#quick-dialog')).toBeVisible();
  await expect(page.locator('#quick-dialog')).toHaveAttribute('open','');
  await page.locator('#quick-dialog #close').tap();
  await expect(page.locator('#app h1')).toHaveText('Updated regression Trip');
  await page.locator('#quick').tap();await expect(page.locator('#quick-dialog')).toBeVisible();
  await page.locator('#quick-dialog #close').tap();await navigateSurfaces(page);
});
test('current rendered controls work after background packet adoption',async({page,request})=>{
  await hold(request);await page.locator('#refresh').tap();await waitForPacketRequest(request);
  await request.post('/__test/release');
  await expect(page.locator('#app h1')).toHaveText('Updated regression Trip');
  await expect(page.locator('#status')).toHaveText('Sync complete');
  await navigateSurfaces(page);
  await page.locator(`[data-event="${eventId}"]`).first().tap();
  await expect(page.locator('#details')).toBeVisible();await page.locator('#details #close').tap();
  await page.locator('#library').tap();await expect(page.locator('#app h1')).toHaveText('Trips');
});
test('worker-controlled reload renders usable IndexedDB packet and keeps controls live',async({page,request})=>{
  await hold(request);await page.reload();await waitForPacketRequest(request);
  await expect(page.locator('#app h1')).toHaveText('Browser regression Trip');
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  const data=await diagnostics(page);
  expect(data.localPacketUsable).toBe(true);expect(data.usefulLocalDataAtLaunch).toBe(true);
  expect(data.requiredArtifacts).toHaveLength(1);expect(data.requiredArtifacts[0].present).toBe(true);
  await navigateSurfaces(page);
  await request.post('/__test/release');await expect(page.locator('#app h1')).toHaveText('Updated regression Trip');
  await navigateSurfaces(page);
  await page.locator('#quick').tap();await expect(page.locator('#quick-dialog')).toBeVisible();
  await page.locator('#quick-dialog #close').tap();
});
test('Details → Door retains ownership through a deferred packet',async({page,request})=>{
  await hold(request);await page.locator('#refresh').tap();await waitForPacketRequest(request);
  await page.locator(`[data-event="${eventId}"]`).first().tap();await page.locator('#details #passes').tap();
  await request.post('/__test/release');await expect(page.locator('#status')).toHaveText('Update ready when you finish');
  await expect(page.locator('#door')).toBeVisible();await expect(page.locator('#door canvas')).toBeVisible();
  await page.locator('#door #close').tap();
  // The closed dialog retains its own h1 until async packet adoption replaces it.
  await expect(page.locator('.trip-overview h1')).toHaveText('Updated regression Trip');
  await navigateSurfaces(page);
});

test('V0 Quick Actions omits Add note; an unscheduled Calendar explains its empty state',async({page,request})=>{
  await page.locator('#quick').tap();
  await expect(page.getByRole('button',{name:'Add note',exact:true})).toHaveCount(0);
  await page.locator('#quick-dialog #close').tap();
  const {tripId:empty}=await (await request.post('/__test/empty')).json();
  await page.goto(`/#${empty}`);await expect(page.locator('#status')).toHaveText('Sync complete');
  await page.locator('[data-surface="calendar"]').tap();
  await expect(page.locator('.calendar-empty')).toHaveText('No scheduled events yet');
  await expect(page.locator('.calendar')).toHaveCount(0);
  await page.locator('#add-event').tap();await expect(page.locator('#quick-dialog #event-form')).toBeVisible();
});

test('parking create → offline cold documents → clear → reconnect persists in IndexedDB and source truth',async({page,context,request})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:51.505,longitude:-0.116});
  await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('#status')).toHaveText('Sync complete');
  await context.setOffline(true);
  await page.locator('#quick').tap();await page.locator('#parking').tap();
  await expect(page.locator('[data-clear-parking]')).toBeVisible();await expect(page.locator('#quick-dialog')).not.toBeVisible();
  const url=page.url();await page.close();let restored=await context.newPage();await restored.goto(url);
  await expect(restored.locator('[data-clear-parking]')).toBeVisible();
  await restored.locator('[data-clear-parking]').tap();await expect(restored.locator('[data-clear-parking]')).toHaveCount(0);
  await restored.close();restored=await context.newPage();await restored.goto(url);
  await expect(restored.locator('#app h1')).toHaveText('Browser regression Trip');
  await expect(restored.locator('[data-clear-parking]')).toHaveCount(0);
  expect((await diagnostics(restored)).pendingMutations).toBe(2);
  await context.setOffline(false);
  await expect.poll(async()=>{const state=await (await request.get('/__test/parking')).json();return state.knowledge.filter(k=>k.tags.includes('parking')).length;}).toBe(1);
  await expect.poll(async()=>(await diagnostics(restored)).pendingMutations).toBe(0);
  expect((await (await request.get('/__test/parking')).json()).current).toEqual([]);
  await restored.reload();await expect(restored.locator('[data-clear-parking]')).toHaveCount(0);
});

for(const interaction of ['quick','details','door','edit','quick-edit'])test(`waiting worker preserves ${interaction} until explicit update and release`,async({page,request})=>{
  await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  const before=await diagnostics(page);const oldBuild=before.serviceWorker.buildId;
  // Keep an unsent mutation to prove activation does not clear device data.
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('porter-v0',3);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('mutations','readwrite');tx.objectStore('mutations').put({id:'update-retains-queue',sequence:100,operation:'updateEvent',arguments:{tripId:location.hash.slice(1),eventId:'deliberate-conflict',expectedRevision:0,patch:{title:'Retained'}}});tx.oncomplete=resolve;tx.onerror=reject;});db.close();
  });
  let dialog;
  if(interaction==='quick'){await page.locator('#quick').tap();dialog='#quick-dialog';}
  else if(interaction==='quick-edit'){await page.locator('#quick').tap();await page.locator('#quick-dialog #add-event').tap();dialog='#quick-dialog';await page.locator('#event-form input[name=title]').fill('Unsaved acceptance edit');}
  else if(interaction==='edit'){await page.locator('.tabs [data-surface="calendar"]').tap();await page.locator('#add-event').tap();dialog='#quick-dialog';await page.locator('#event-form input[name=title]').fill('Unsaved acceptance edit');}
  else {await page.locator(`[data-event="${eventId}"]`).first().tap();dialog='#details';if(interaction==='door'){await page.locator('#details #passes').tap();dialog='#door';await expect(page.locator('#door canvas')).toBeVisible();}}
  await request.post('/__test/update');
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
  await expect(page.locator('#porter-update')).toContainText('Porter update ready');
  // The modal makes the outside Update button inert to real taps. Programmatic
  // activation exercises the additional ownership guard, not a UI timing delay.
  await page.locator('#porter-update button').evaluate(button=>button.click());
  await expect(page.locator('#porter-update')).toContainText('finish the current action');
  await expect(page.locator(dialog)).toBeVisible();
  if(interaction.endsWith('edit'))await expect(page.locator('#event-form input[name=title]')).toHaveValue('Unsaved acceptance edit');
  const identity=await page.evaluate(()=>new Promise(resolve=>{const ch=new MessageChannel();ch.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({type:'porter-build'},[ch.port2]);}));
  expect(identity.buildId).toBe(oldBuild);
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.locator(`${dialog} #close`).tap();
  await expect.poll(()=>navigations).toBe(1);
  await expect(page.locator('.trip-overview h1')).toHaveText('Browser regression Trip');
  const after=await diagnostics(page);
  expect(after.serviceWorker.buildId).toBe(oldBuild+'-test-1');
  expect(after.localPacketUsable).toBe(true);expect(after.usefulLocalDataAtLaunch).toBe(true);
  expect(after.requiredArtifacts[0].present).toBe(true);expect(after.pendingMutations).toBe(1);
  expect(navigations).toBe(1);
});

test('waiting worker requires consent and refuses activation while another Porter window exists',async({page,context,request})=>{
  await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');
  const second=await context.newPage();await second.goto(page.url());await expect(second.locator('#status')).toHaveText('Sync complete');
  await second.locator('#quick').tap();
  await request.post('/__test/update');await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
  await expect(page.locator('#porter-update')).toContainText('Porter update ready');
  expect(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
  await page.locator('#porter-update button').tap();await expect(page.locator('#porter-update')).toContainText('Close other Porter windows');
  await expect(second.locator('#quick-dialog')).toBeVisible();await second.close();
  await page.locator('#porter-update button').tap();
  await expect(page.locator('#porter-update')).toBeHidden();
  await expect(page.locator('#status')).toHaveText('Sync complete');
});
