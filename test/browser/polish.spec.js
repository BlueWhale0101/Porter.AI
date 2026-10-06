import { test,expect } from '@playwright/test';
let tripId,eventId;
test.beforeEach(async({page,context,request})=>{
  ({tripId,eventId}=await(await request.post('/__test/reset')).json());
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
  await page.goto(`/?porter-diagnostics=1#${tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
});
const events=async request=>(await(await request.get('/__test/events',{params:{tripId}})).json());
const queued=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('porter-v0',3);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,r=db.transaction('mutations').objectStore('mutations').getAll();r.onsuccess=()=>{resolve(r.result.filter(x=>x.state!=='acknowledged'));db.close();};};}));
async function add(page){await page.locator('#quick').tap();await page.locator('#quick-dialog #add-event').tap();}
async function edit(page){await page.locator(`[data-event="${eventId}"]`).first().tap();await page.locator('#details #edit').tap();}
async function waiting(request){await expect.poll(async()=>(await(await request.get('/__test/mutation-state')).json()).waiting).toBe(1);}

test('Save closes after durable local commit with mutation network held; in-flight Undo compensates',async({page,request})=>{
  await request.post('/__test/mutation-hold');await add(page);await page.locator('[name=title]').fill('Instant local create');
  await page.locator('[name=start]').fill('2030-12-09T10:00');await page.locator('[data-save-event]').tap();
  await expect(page.locator('#quick-dialog')).not.toBeVisible();await expect(page.locator('#event-confirmation')).toContainText('Saved');
  await expect(page.locator('.next strong')).toHaveText('Instant local create');expect((await queued(page)).length).toBe(1);await waiting(request);
  expect((await events(request)).some(e=>e.title==='Instant local create')).toBe(false);
  await page.locator('#event-confirmation button').tap();await expect(page.locator('#event-confirmation')).toContainText('Undone');
  expect((await queued(page)).length).toBe(2);await request.post('/__test/mutation-release');
  await expect.poll(async()=>(await events(request)).find(e=>e.title==='Instant local create')?.commitment).toBe('cancelled');
  expect((await events(request)).filter(e=>e.title==='Instant local create')).toHaveLength(1);await expect.poll(async()=>(await queued(page)).length).toBe(0);
});
test('newer local edit survives delayed acknowledgement; synced Undo restores its own prior value',async({page,request})=>{
  await request.post('/__test/mutation-hold');await edit(page);await page.locator('[name=title]').fill('First local edit');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();await waiting(request);
  await edit(page);await expect(page.locator('[name=title]')).toHaveValue('First local edit');await page.locator('[name=title]').fill('Newer local edit');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();
  await expect(page.locator(`[data-event="${eventId}"] strong`)).toHaveText('Newer local edit');await request.post('/__test/mutation-release');
  await expect.poll(async()=>(await events(request)).find(e=>e.id===eventId).title).toBe('Newer local edit');await expect.poll(async()=>(await queued(page)).length).toBe(0);
  await page.locator('#event-confirmation button').tap();await expect(page.locator(`[data-event="${eventId}"] strong`)).toHaveText('First local edit');
  await expect.poll(async()=>(await events(request)).find(e=>e.id===eventId).title).toBe('First local edit');
});
test('offline unsent create Undo collapses durably; local edit survives reload and later sync',async({page,request})=>{
  await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  // Report offline to the app without WebKit's broken offline navigation emulation.
  await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await add(page);await page.locator('[name=title]').fill('Never sent');await page.locator('[data-save-event]').tap();await expect(page.locator('#quick-dialog')).not.toBeVisible();
  await page.locator('#event-confirmation button').tap();await expect.poll(async()=>(await queued(page)).length).toBe(0);
  await edit(page);await page.locator('[name=title]').fill('Durable offline edit');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();
  await page.reload();await expect(page.locator(`[data-event="${eventId}"] strong`)).toHaveText('Durable offline edit');expect((await queued(page)).length).toBe(1);
  await request.post('/__test/connectivity',{data:{apiAvailable:true}});await page.evaluate(()=>{delete navigator.onLine;dispatchEvent(new Event('online'));});
  await expect.poll(async()=>(await events(request)).find(e=>e.id===eventId).title).toBe('Durable offline edit');expect((await events(request)).some(e=>e.title==='Never sent')).toBe(false);
});
test('failed durable transaction keeps editor open and never displays Saved',async({page})=>{
  await add(page);await page.locator('[name=title]').fill('Aborted local save');
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='mutations'&&value.localEvent)throw new DOMException('Simulated quota failure','QuotaExceededError');return original.call(this,value,...args);};});
  await page.locator('[data-save-event]').tap();await expect(page.locator('#edit-message')).toContainText('quota');await expect(page.locator('#quick-dialog')).toBeVisible();await expect(page.locator('#event-confirmation')).toBeHidden();expect(await queued(page)).toEqual([]);
});
test('uncached Trip selection explains hydration and failure; cached selection has no loader',async({page,request})=>{
  const fresh=await(await request.post('/__test/empty')).json();await page.locator('#library').tap();await expect(page.locator(`[data-trip="${fresh.tripId}"]`)).toBeVisible();await request.post('/__test/hold');await page.locator(`[data-trip="${fresh.tripId}"]`).tap();
  await expect(page.locator('.preparing-trip h1')).toHaveText('Preparing trip…');await expect(page.locator('.preparing-trip')).toContainText('Loading trip');
  await request.post('/__test/release');await expect(page.locator('.trip-overview h1')).toHaveText('Unscheduled Journey');
  await page.locator('#porter-diagnostics summary').tap();await page.locator('#porter-diagnostics [data-refresh]').tap();await expect(page.locator('#porter-diagnostics pre')).toContainText('first_remote_hydration');
  await page.locator('#library').tap();await request.post('/__test/hold');await page.locator(`[data-trip="${fresh.tripId}"]`).tap();await expect(page.locator('.trip-overview h1')).toHaveText('Unscheduled Journey');await expect(page.locator('.preparing-trip')).toHaveCount(0);await request.post('/__test/release');
  const another=await(await request.post('/__test/empty')).json();await page.locator('#library').tap();await expect(page.locator(`[data-trip="${another.tripId}"]`)).toBeVisible();await request.post('/__test/connectivity',{data:{apiAvailable:false}});await page.locator(`[data-trip="${another.tripId}"]`).tap();await expect(page.locator('#retry-trip')).toBeVisible();await expect(page.locator('.preparing-trip')).toContainText('could not be prepared');
  await request.post('/__test/connectivity',{data:{apiAvailable:true}});await page.locator('#retry-trip').tap();await expect(page.locator('.trip-overview h1')).toHaveText('Unscheduled Journey');
});
test('Update handles worker already active before tap and defers reload during owned interaction',async({page,request})=>{
  await request.post('/__test/update');await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});await expect(page.locator('#porter-update')).toContainText('Porter update ready');
  // Reproduce lifecycle transition after detection, before the Update button.
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>resolve();reg.waiting.postMessage({type:'porter-activate'},[channel.port2]);});});
  await expect.poll(()=>page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r.waiting&&r.active?.state==='activated';})).toBe(true);
  let navigations=0;page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++;});await page.locator('#quick').tap();await page.locator('#porter-update button').evaluate(b=>b.click());await expect(page.locator('#porter-update')).toContainText('finish the current action');expect(navigations).toBe(0);
  await page.locator('#quick-dialog #close').tap();await expect.poll(()=>navigations).toBe(1);await expect(page.locator('.trip-overview h1')).toHaveText('Browser regression Trip');await expect(page.locator('#porter-update')).not.toContainText('unavailable');
});
test('iPhone controls avoid focus zoom; 64–72px framed art retains narrow-page bounds and Next',async({page,request})=>{
  await add(page);const fonts=await page.locator('#event-form input,#event-form select,#event-form textarea').evaluateAll(els=>els.map(el=>parseFloat(getComputedStyle(el).fontSize)));expect(fonts.every(size=>size>=16)).toBe(true);
  expect(await page.locator('[data-save-event]').evaluate(el=>getComputedStyle(el).touchAction)).toBe('manipulation');expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  await page.locator('#quick-dialog #close').tap();const rich=await(await request.post('/__test/visuals')).json();await page.goto(`/#${rich.tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');await page.setViewportSize({width:320,height:700});
  await page.locator('.tabs [data-surface=itinerary]').tap();await expect(page.locator('#app')).toHaveAttribute('data-surface','itinerary');const icon=page.locator('.event-icon').first();expect(await icon.evaluate(el=>el.getBoundingClientRect().width)).toBe(64);expect(await icon.evaluate(el=>getComputedStyle(el).borderTopStyle)).toBe('solid');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
