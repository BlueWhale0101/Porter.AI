import {test,expect} from '@playwright/test';
let tripId;
test.beforeEach(async({page,context,request})=>{
  ({tripId}=await(await request.post('/__test/reset')).json());
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
  await page.goto(`/#${tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');
});
const source=async request=>(await(await request.get('/__test/events',{params:{tripId}})).json());
const queued=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('porter-v0',3);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,r=db.transaction('mutations').objectStore('mutations').getAll();r.onsuccess=()=>{resolve(r.result.filter(x=>['createEvent','updateEvent'].includes(x.operation)&&x.state!=='acknowledged'));db.close();};};}));
async function add(page){await page.locator('#quick').tap();await page.locator('#quick-dialog #add-event').tap();await expect(page.locator('#event-form')).toBeVisible();}
async function editorTrip(page,request){({tripId}=await(await request.post('/__test/editor')).json());await page.goto(`/?editor=1#${tripId}`);await expect(page.locator('#status')).toHaveText('Sync complete');}

test('partial draft: implicit submit, background/resume, sync and dismissal never create an Event',async({page,request})=>{
  const before=(await source(request)).length;await add(page);await page.locator('[name=title]').fill('Unsaved Test event');
  await page.locator('[name=title]').press('Enter');
  await page.locator('#event-form').evaluate(form=>form.requestSubmit());
  expect((await source(request)).length).toBe(before);expect(await queued(page)).toEqual([]);
  await page.locator('[name=start]').fill('2407-05-02T00:28');
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new Event('blur'));
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('focus'));dispatchEvent(new Event('online'));
  });
  await page.locator('.tabs [data-surface=itinerary]').evaluate(button=>button.click());
  await page.locator('#refresh').evaluate(button=>button.click());
  await expect(page.locator('#quick-dialog')).toBeVisible();await expect(page.locator('[name=title]')).toHaveValue('Unsaved Test event');
  expect((await source(request)).length).toBe(before);expect(await queued(page)).toEqual([]);
  await page.locator('#quick-dialog #close').tap();await page.locator('[data-surface=itinerary]').tap();
  expect((await source(request)).length).toBe(before);expect(await queued(page)).toEqual([]);
});

test('explicit Save creates exactly once; invalid input and synthetic activation cannot commit',async({page,request})=>{
  const before=(await source(request)).length;await add(page);await page.locator('[name=title]').fill('Explicit Event');
  await page.locator('[name=start]').fill('2407-05-02T00:28');await page.locator('[data-save-event]').tap();await expect(page.locator('#edit-message')).not.toBeEmpty();await expect(page.locator('#quick-dialog')).toBeVisible();
  expect((await source(request)).length).toBe(before);expect(await queued(page)).toEqual([]);
  await page.locator('[name=start]').fill('2026-10-05T12:30');await page.locator('[name=startTimezone]').selectOption('Europe/London');
  await page.locator('[data-save-event]').evaluate(button=>button.click());expect((await source(request)).length).toBe(before);
  await page.locator('[data-save-event]').focus();await page.locator('[data-save-event]').press('Enter');await expect(page.locator('#quick-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await source(request)).length).toBe(before+1);await expect.poll(async()=>(await queued(page)).length).toBe(0);const events=await source(request);expect(events.length).toBe(before+1);expect(events.filter(e=>e.title==='Explicit Event')).toHaveLength(1);expect(await queued(page)).toEqual([]);
  const event=events.find(e=>e.title==='Explicit Event');expect(event.temporal.start).toBe('2026-10-05T11:30:00.000Z');
  await page.locator('[data-surface=itinerary]').tap();await page.locator(`[data-event="${event.id}"]`).tap();await page.locator('#details #edit').tap();await page.locator('[name=description]').fill('Normal online edit');await page.locator('[data-save-event]').tap();await expect(page.locator('#details')).not.toBeVisible();
  await expect.poll(async()=>(await source(request)).find(e=>e.id===event.id).description).toBe('Normal online edit');await expect.poll(async()=>(await queued(page)).length).toBe(0);
});

test('local timezone inference, friendly search, explicit override and ordinary/movement zones',async({page,request})=>{
  await editorTrip(page,request);await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  const reads=[];page.on('request',r=>{if(r.url().includes('/client'))reads.push(r.url());});
  await add(page);
  await page.locator('[name=title]').fill('Local travel');await page.locator('[name=start]').fill('2026-10-03T10:00');
  await expect(page.locator('[name=startTimezone]')).toHaveValue('Europe/London');await expect(page.locator('[name=startTimezone] option:checked')).toHaveText('London');await expect(page.locator('[data-end-zone]')).toBeHidden();
  await page.locator('[name=start]').fill('2026-10-08T10:00');await expect(page.locator('[name=startTimezone]')).toHaveValue('Europe/Rome');
  await page.locator('[data-zone-search=startTimezone]').fill('London');await page.locator('[name=startTimezone]').selectOption('Europe/London');await page.locator('[name=start]').fill('2026-10-09T10:00');await expect(page.locator('[name=startTimezone]')).toHaveValue('Europe/London');await expect(page.locator('[name=startTimezone]')).toHaveAttribute('data-automatic','false');
  await page.locator('[name=end]').fill('2026-10-09T11:00');await expect(page.locator('[name=endTimezone]')).toHaveValue('Europe/London');
  expect(reads).toEqual([]);await page.locator('[data-save-event]').tap();await expect(page.locator('#quick-dialog')).not.toBeVisible();
  const ordinary=(await queued(page))[0].arguments.event;expect(ordinary.temporal.startTimezone).toBe('Europe/London');expect(ordinary.temporal.endTimezone).toBe('Europe/London');
  await add(page);await page.locator('[name=title]').fill('Local flight');await page.locator('[name=movement]').check();await expect(page.locator('[data-end-zone]')).toBeVisible();
  await page.locator('[name=start]').fill('2026-10-06T10:00');await page.locator('[name=startTimezone]').selectOption('Europe/London');await page.locator('[name=end]').fill('2026-10-06T14:00');await page.locator('[name=endTimezone]').selectOption('Europe/Rome');
  await page.locator('[name=end]').fill('2026-10-06T15:00');await expect(page.locator('[name=endTimezone]')).toHaveValue('Europe/Rome');await page.locator('[data-save-event]').tap();await expect(page.locator('#quick-dialog')).not.toBeVisible();
  const flight=(await queued(page)).find(x=>x.arguments.event.title==='Local flight').arguments.event;expect(flight.temporal.startTimezone).toBe('Europe/London');expect(flight.temporal.endTimezone).toBe('Europe/Rome');
});

test('repeated Save activation while packet refresh is pending creates one Event',async({page,request})=>{
  await add(page);await page.locator('[name=title]').fill('One explicit save');await request.post('/__test/hold');
  await page.locator('[data-save-event]').dblclick();
  await expect(page.locator('#quick-dialog')).not.toBeVisible();await expect(page.locator('#event-confirmation')).toContainText('Saved');
  await expect.poll(async()=>(await source(request)).filter(e=>e.title==='One explicit save').length).toBe(1);await expect.poll(async()=>(await queued(page)).length).toBe(0);
  await request.post('/__test/release');await expect(page.locator('#quick-dialog')).not.toBeVisible();
  expect((await source(request)).filter(e=>e.title==='One explicit save')).toHaveLength(1);
});

test('partial native datetime and server validation failure remain drafts',async({page,request})=>{
  await add(page);await page.locator('[name=title]').fill('Rejected draft');
  // Native incomplete segments are exposed as badInput by browsers; assert the
  // save boundary explicitly even when automation cannot drive iOS's date wheel.
  await page.locator('[name=start]').evaluate(input=>{Object.defineProperty(input,'validity',{configurable:true,value:{badInput:true}});});
  await page.locator('[data-save-event]').tap();await expect(page.locator('#edit-message')).toContainText('Complete or clear');expect(await queued(page)).toEqual([]);expect((await source(request)).filter(e=>e.title==='Rejected draft')).toEqual([]);
  await page.locator('[name=start]').evaluate(input=>{delete input.validity;});
  // A source validation rejection must not be treated as an offline write.
  await page.locator('[name=commitment]').evaluate(select=>select.add(new Option('Invalid','invalid',true,true)));
  await page.locator('[data-save-event]').tap();await expect(page.locator('#edit-message')).toContainText('Invalid event commitment');await expect(page.locator('#quick-dialog')).toBeVisible();expect(await queued(page)).toEqual([]);
  await page.locator('[name=commitment]').selectOption('planned');await request.post('/__test/connectivity',{data:{apiAvailable:false}});
  await page.locator('[name=title]').fill('   ');await page.locator('[data-save-event]').tap();await expect(page.locator('#edit-message')).toContainText('title is required');expect(await queued(page)).toEqual([]);
});
