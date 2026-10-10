import {test,expect} from '@playwright/test';
let data;
test.beforeEach(async({page,context,request})=>{
 await request.post('/__test/reset');data=await(await request.post('/__test/knowledge-foundation')).json();
 await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
 await page.goto(`/#${data.tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
});
test('normalized global references remain available in local Details and parking after controlled offline reload',async({page,context,request,browserName})=>{
 await expect(page.locator('.current-card')).toContainText(['Bay B12']);
 await page.locator(`[data-event="${data.eventId}"]`).first().tap();await expect(page.locator('#details')).toContainText('Bring photo ID');await page.locator('#details #close').tap();
 if(browserName==='chromium')await context.setOffline(true);else await request.post('/__test/connectivity',{data:{apiAvailable:false}});
 await page.reload();await expect(page.locator('.trip-overview h1')).toHaveText('Browser regression Trip');await expect(page.locator('.current-card')).toContainText(['Bay B12']);
 await page.locator(`[data-event="${data.eventId}"]`).first().tap();await expect(page.locator('#details')).toContainText('Bring photo ID');await page.locator('#details #passes').tap();await expect(page.locator('#door canvas').first()).toBeVisible();
});
test('phone Trip deletion retains shared global Knowledge and links on the copied Trip',async({page,request})=>{
 const before=await(await request.get('/__test/aggregate')).json();await page.locator('#library').tap();await page.locator(`[data-trip-edit="${data.tripId}"]`).tap();await page.locator('#delete-trip').tap();
 await expect(page.locator('#delete-confirmation')).toContainText('Global Knowledge is retained');await page.locator('#confirm-delete').tap();
 await expect(page.locator('#app h1')).toHaveText('Trips');await expect(page.locator(`[data-trip="${data.tripId}"]`)).toHaveCount(0);
 const after=await(await request.get('/__test/aggregate')).json();expect(after.knowledge.map(k=>k.id).sort()).toEqual(before.knowledge.map(k=>k.id).sort());
 const copied=after.events.find(e=>e.tripId===data.copyId&&e.knowledgeIds.includes(data.knowledgeId));expect(copied).toBeTruthy();
 await page.locator(`[data-trip="${data.copyId}"]`).tap();await expect(page.locator('#status')).toHaveText('Sync complete');await page.locator(`[data-event="${copied.id}"]`).first().tap();await expect(page.locator('#details')).toContainText('Bring photo ID');
});
