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
