import {test,expect} from '@playwright/test';

for (const legacy of [false,true]) {
  test('offline first paint, boundary timer and restored Door with '+(legacy?'a legacy packet':'versioned inputs'),async({page,context,request,browserName})=>{
    const {tripId,eventId} = await (await request.post('/__test/reset')).json();
    await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true}]);
    await page.goto('/?porter-diagnostics=1#'+tripId);
    await expect(page.locator('#status')).toHaveText('Sync complete');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Sync complete');
    const facts = () => page.evaluate(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('porter-v0');r.onsuccess=()=>resolve(r.result);});
      try {
        return await new Promise(resolve=>{
          const r=db.transaction('packets').objectStore('packets').getAll();
          r.onsuccess=()=>resolve(r.result.map(x=>[x.packet.revision,x.packet.generatedAt,x.meta.lastVerifiedSync]));
        });
      } finally {db.close();}
    });
    const stored=await facts();
    if (legacy) await page.evaluate(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('porter-v0');r.onsuccess=()=>resolve(r.result);});
      await new Promise(resolve=>{
        const tx=db.transaction('packets','readwrite'), store=tx.objectStore('packets'),r=store.getAll();
        r.onsuccess=()=>{for(const row of r.result){delete row.packet.projectionInput;delete row.packet.projectedAt;delete row.packet.nextBoundary;store.put(row);}};
        tx.oncomplete=resolve;
      });
      db.close();
    });
    if(browserName==='chromium') await context.setOffline(true);
    else await request.post('/__test/connectivity',{data:{apiAvailable:false}});
    await page.clock.install({time:new Date('2030-12-10T19:05:00Z')});
    await page.reload();
    const section = name => page.locator('#journey-sections section').filter({has:page.getByRole('heading',{name,exact:true})});
    await expect(section('Now')).toContainText('Regression performance');
    await expect(page.locator('#status')).toContainText(/offline|failed|local|unavailable/i);
    const tripRequests=[];
    page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/client/'))tripRequests.push(r.url());});
    await page.locator('[data-tickets="'+eventId+'"]').tap();
    await expect(page.locator('#door canvas')).toBeVisible();
    await page.clock.setSystemTime(new Date('2030-12-14T20:00:00Z'));
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await expect(page.locator('#door canvas')).toBeVisible();
    await page.locator('#door #close').tap();
    await expect(page.locator('#past-toggle')).toContainText('1 events');
    await page.clock.setSystemTime(new Date('2030-12-10T18:59:55Z'));
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(section('Next')).toContainText('Regression performance');
    await page.clock.fastForward(5100);
    await expect(section('Now')).toContainText('Regression performance');
    expect(await facts()).toEqual(stored);
    expect(tripRequests).toEqual([]);
  });
}
