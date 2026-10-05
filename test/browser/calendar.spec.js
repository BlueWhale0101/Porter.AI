import {test,expect} from '@playwright/test';

test.beforeEach(async({context,request})=>{
  await request.post('/__test/reset');
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
});
async function rich(page,request){const data=await(await request.post('/__test/rich')).json();await page.goto(`/#${data.tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');return data;}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>document.body.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}

test('Current State empty message belongs only to an empty strip, including narrow layout',async({page,request})=>{
  await page.setViewportSize({width:320,height:740});await rich(page,request);
  await expect(page.locator('.current-card')).toHaveCount(2);await expect(page.locator('.current-empty')).toHaveCount(0);await noOverflow(page);
  await page.locator('.current-strip').evaluate(el=>{el.scrollLeft=200;});expect(await page.locator('.current-strip').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  // A hash-only goto is same-document navigation, not a new local-first launch.
  const {tripId}=await(await request.post('/__test/empty')).json();await page.goto(`/?empty-case=1#${tripId}`);await expect(page.locator('.trip-overview h1')).toHaveText('Unscheduled Journey');await expect(page.locator('#status')).toHaveText('Sync complete');
  await expect(page.locator('.current-empty')).toHaveText('No current state');await expect(page.locator('.current-card')).toHaveCount(0);await noOverflow(page);
});

test('local phone week, paging, Details and sticky Schedule do not request data or overflow',async({page,request})=>{
  await page.setViewportSize({width:320,height:740});await rich(page,request);
  await page.reload();await expect(page.locator('#status')).toHaveText('Sync complete');await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  const requests=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/client'))requests.push(r.url());});
  await page.locator('[data-surface=itinerary]').tap();await expect(page.locator('.itinerary-day h2').first()).toHaveText(/\w+ · \w+ \d+/);await noOverflow(page);
  const started=Date.now();await page.locator('[data-surface=calendar]').tap();await expect(page.locator('.week-overview')).toBeVisible();expect(Date.now()-started).toBeLessThan(1500);
  await expect(page.locator('.week-head h3')).toHaveCount(7);await noOverflow(page);
  const bounds=await page.locator('.week-head h3').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
  expect(bounds[0].left).toBeGreaterThanOrEqual(0);expect(bounds.at(-1).right).toBeLessThanOrEqual(320);
  const heading=await page.locator('.week-pager h3').innerText();await page.getByRole('button',{name:'Next week',exact:true}).tap();await expect(page.locator('.week-pager h3')).not.toHaveText(heading);
  await page.getByRole('button',{name:'Previous week',exact:true}).tap();await expect(page.locator('.week-pager h3')).toHaveText(heading);
  const block=page.locator('.week-day .calendar-block').first(),title=await block.getAttribute('aria-label');await block.tap();await expect(page.locator('#details')).toBeVisible();await expect(page.locator('#details h2')).toHaveText(title.replace(' · Optional (tentative)',''));await page.locator('#details #close').tap();
  await page.getByRole('button',{name:'Schedule',exact:true}).tap();await noOverflow(page);
  const tentative=page.locator('.schedule .tentative').first();
  await expect(tentative).toHaveAttribute('aria-label',/Optional \(tentative\)/);
  expect(await tentative.evaluate(el=>getComputedStyle(el).borderTopStyle)).toBe('dashed');
  expect(await tentative.evaluate(el=>getComputedStyle(el).backgroundImage)).not.toBe('none');
  await page.locator('.calendar-scroll').evaluate(el=>{el.scrollTop=300;el.scrollLeft=250;});
  const positions=await page.locator('.calendar-scroll').evaluate(el=>{const r=el.getBoundingClientRect(),h=el.querySelector('.calendar-date').getBoundingClientRect(),t=el.querySelector('.schedule-hours').getBoundingClientRect(),c=el.querySelector('.schedule-corner').getBoundingClientRect();return {top:r.top,left:r.left,header:h.top,time:t.left,cornerTop:c.top,cornerLeft:c.left,scrollX:window.scrollX};});
  expect(Math.abs(positions.header-positions.top)).toBeLessThan(2);expect(Math.abs(positions.time-positions.left)).toBeLessThan(2);expect(Math.abs(positions.cornerTop-positions.top)).toBeLessThan(2);expect(Math.abs(positions.cornerLeft-positions.left)).toBeLessThan(2);expect(positions.scrollX).toBe(0);
  await noOverflow(page);expect(requests).toEqual([]);
});

test('manual color edits remain local through reload and appear in both calendars',async({page,request})=>{
  const {tripId,eventId}=await(await request.post('/__test/reset')).json();await page.goto(`/#${tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');
  await page.evaluate(()=>navigator.serviceWorker.ready);await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  await page.locator('[data-surface=calendar]').tap();await page.locator(`.week-day [data-event="${eventId}"]`).tap();await page.locator('#details #edit').tap();
  await page.locator('[name=calendarColor]').selectOption('terracotta');await page.locator('#event-form button[type=submit]').tap();await expect(page.locator('#details')).not.toBeVisible();
  await expect(page.locator('.week-day .color-terracotta')).toBeVisible();
  await page.reload();await expect(page.locator('.trip-overview h1')).toHaveText('Browser regression Trip');await page.locator('[data-surface=calendar]').tap();await expect(page.locator('.week-day .color-terracotta')).toBeVisible();
  await page.getByRole('button',{name:'Schedule',exact:true}).tap();await expect(page.locator('.schedule .color-terracotta')).toHaveCount(1);
  await page.locator('.schedule .color-terracotta').tap();await page.locator('#details #edit').tap();await expect(page.locator('[name=calendarColor]')).toHaveValue('terracotta');
  await page.locator('[name=calendarColor]').selectOption('');await page.locator('#event-form button[type=submit]').tap();await expect(page.locator('.color-terracotta')).toHaveCount(0);
});
