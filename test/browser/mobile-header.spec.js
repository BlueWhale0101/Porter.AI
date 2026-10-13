import {test,expect} from '@playwright/test';

test('phone masthead keeps Sync beside status and Trip tabs together',async({page,context,request})=>{
  await request.post('/__test/reset');
  await context.addCookies([{name:'browser-regression-access',value:'browser-regression',url:'http://localhost:4178',httpOnly:true,sameSite:'Strict'}]);
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Sync complete');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    const layout=await page.evaluate(()=>{
      const rect=selector=>{const {x,y,width,height}=document.querySelector(selector).getBoundingClientRect();return {x,y,width,height};};
      return {viewport:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,logo:rect('.wordmark'),account:rect('#account'),status:rect('#status'),sync:rect('#refresh'),tabs:[...document.querySelectorAll('.tabs [data-surface],.tabs #library')].map(el=>{const {x,y,width,height}=el.getBoundingClientRect();return {x,y,width,height};}),perspective:rect('#perspective')};
    });
    expect(layout.documentWidth,JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
    expect(layout.logo.y,JSON.stringify(layout)).toBeLessThan(layout.status.y);
    expect(layout.account.y,JSON.stringify(layout)).toBeLessThan(layout.sync.y);
    expect(layout.sync.x,JSON.stringify(layout)).toBeGreaterThan(layout.status.x+layout.status.width-1);
    expect(layout.sync.y,JSON.stringify(layout)).toBeLessThan(layout.status.y+layout.status.height+2);
    expect(layout.tabs).toHaveLength(5);
    expect(Math.max(...layout.tabs.map(t=>t.y))-Math.min(...layout.tabs.map(t=>t.y))).toBeLessThan(2);
    expect(layout.perspective.y,JSON.stringify(layout)).toBeGreaterThanOrEqual(Math.max(...layout.tabs.map(t=>t.y+t.height))-2);
    expect(layout.perspective.x+layout.perspective.width,JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  }
});
