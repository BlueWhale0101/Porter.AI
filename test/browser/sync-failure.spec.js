import { test, expect } from '@playwright/test';

async function diagnostics(page){
  const panel=page.locator('#porter-diagnostics');
  await panel.locator('[data-refresh]').evaluate(button=>button.click());
  await expect(panel).toHaveAttribute('data-state','ready');
  return JSON.parse(await panel.locator('pre').textContent());
}

test('failed sync keeps the Trip, ticket and queued edit after sign-in and recovers on retry',async({page,context,request})=>{
  const {tripId,eventId}=await(await request.post('/__test/reset')).json();
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true}]);
  await page.goto(`/?porter-diagnostics=1#${tripId}`);
  const status=page.locator('#status');
  await expect(status).toHaveText('Sync complete');
  const initial=await diagnostics(page);
  expect(initial.lastSuccessfulSync).toBeTruthy();

  const requestId='11111111-1111-4111-8111-111111111112';
  const artifactRoute='**/client/artifacts/**';
  await page.route(artifactRoute,route=>route.fulfill({
    status:404,json:{code:'not_found',message:'private artifact path'},
    headers:{'X-Request-ID':requestId},
  }));
  await page.route('**/auth/login',route=>route.fulfill({status:200,json:{ok:true}}));
  await page.locator('#account').tap();
  await page.locator('#sign-in-dialog [name=email]').fill('test@example.invalid');
  await page.locator('#sign-in-dialog [name=password]').fill('synthetic');
  await page.locator('#sign-in-dialog button[type=submit]').tap();
  await expect(status).toContainText('required offline artifact');
  const failed=await diagnostics(page);
  expect(failed.authentication).toMatchObject({operation:'login',state:'succeeded'});
  expect(failed.syncAttempt).toMatchObject({state:'failed',failure:{phase:'artifact_retrieval',category:'artifact',status:404,requestId}});
  expect(failed.lastSuccessfulSync).toBe(initial.lastSuccessfulSync);
  expect(JSON.stringify(failed)).not.toContain('private artifact path');

  await page.locator(`[data-tickets="${eventId}"]`).tap();
  await expect(page.locator('#door canvas')).toBeVisible();
  await page.locator('#door #close').tap();
  await page.evaluate(async id=>{
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('porter-v0');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('mutations','readwrite');
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.objectStore('mutations').put({
        id:'retry-draft',operation:'createKnowledge',sequence:1,
        arguments:{tripId:id,knowledge:{title:'Draft retained across failure'}},
      });
    });
    db.close();
  },tripId);
  await page.locator('#refresh').tap();
  await expect(status).toContainText('required offline artifact');
  expect((await diagnostics(page)).pendingMutations).toBe(1);
  await page.unroute(artifactRoute);
  await page.locator('#refresh').tap();
  await expect(status).toHaveText('Sync complete');
  const recovered=await diagnostics(page);
  expect(recovered.syncAttempt.state).toBe('succeeded');
  expect(recovered.syncAttempt.id).not.toBe(failed.syncAttempt.id);
  expect(recovered.lastSuccessfulSync).not.toBe(initial.lastSuccessfulSync);
  expect(recovered.pendingMutations).toBe(0);
});
