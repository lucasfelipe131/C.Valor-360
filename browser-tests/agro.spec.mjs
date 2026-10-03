import {test,expect} from '@playwright/test'
const viewports=[{name:'iPhone pequeno',width:375,height:667},{name:'iPhone Pro Max',width:430,height:932},{name:'Android médio',width:393,height:851}]
for(const viewport of viewports){
 test(`${viewport.name}: card, modal, provenance, polygons, focus, zoom, pan and no horizontal overflow`,async({browser})=>{
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,deviceScaleFactor:1}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.stack))
  await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=','base64')}))
  await page.goto('/browser-tests/fixtures/agro.html')
  const card=page.getByRole('article',{name:'Talhão Talhão SINTÉTICO',exact:true})
  await expect(card.getByRole('heading')).toContainText('Observação de campo')
  await card.locator('summary').tap();await expect(card).toContainText('synthetic-hub-event');await expect(card).toContainText('synthetic:step09:viewport')
  const button=card.getByRole('button',{name:'Ver no mapa'}),box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44)
  await button.tap();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible()
  await expect(dialog.locator('path.is-property')).toHaveCount(1);await expect(dialog.locator('path.is-field')).toHaveCount(1);await expect(dialog.locator('path.is-field')).toHaveAttribute('aria-pressed','true')
  await expect(dialog).toContainText('Geometria fv1');await expect(dialog).toContainText('Âmbar')
  const map=dialog.getByRole('region',{name:'Mapa territorial governado',exact:true})
  const field=dialog.locator('path.is-field'),initial=await field.getAttribute('d')
  const polygonBox=await field.boundingBox(),mapBox=await map.boundingBox();expect(polygonBox.width).toBeGreaterThan(25);expect(polygonBox.width).toBeLessThanOrEqual(mapBox.width)
  await dialog.getByRole('button',{name:'Zoom in',exact:true}).tap();await expect.poll(()=>field.getAttribute('d')).not.toBe(initial)
  const canvas=dialog.locator('.leaflet-container');await canvas.scrollIntoViewIfNeeded()
  const pane=dialog.locator('.leaflet-map-pane'),beforePan=await pane.getAttribute('style'),rect=await canvas.boundingBox()
  const cdp=await context.newCDPSession(page),x=rect.x+rect.width*.7,y=rect.y+rect.height*.6
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*5,y:y+i*3}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect.poll(()=>pane.getAttribute('style')).not.toBe(beforePan)

  await dialog.getByRole('button',{name:'Enquadrar',exact:true}).tap()
  await expect.poll(async()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  await canvas.evaluate(el=>el.scrollIntoView({block:'center'}));await expect(field).toBeInViewport()
  const propertyBox=await dialog.locator('path.is-property').boundingBox(),canvasBox=await canvas.boundingBox();expect(propertyBox.width).toBeLessThanOrEqual(canvasBox.width)
  await page.screenshot({path:`test-results/agro-map-${viewport.width}.png`})
  const close=dialog.getByRole('button',{name:'Fechar mapa e voltar ao card'});await close.scrollIntoViewIfNeeded();await close.tap();await expect(dialog).toHaveCount(0);await expect(button).toBeFocused()
  await page.screenshot({path:`test-results/agro-${viewport.width}.png`,fullPage:true})
  expect(errors).toEqual([]);await context.close()
 })
 test(`${viewport.name}: direct map selection, layers, focus from card and progressive details`,async({page})=>{
  await page.setViewportSize(viewport);await page.route('https://**/*',r=>r.abort());await page.goto('/browser-tests/fixtures/agro.html?map=1')
  const field=page.locator('path.is-field');await expect(field).toHaveCount(1);await field.focus();await page.keyboard.press('Enter');await expect(field).toHaveAttribute('aria-pressed','true')
  await page.getByRole('checkbox',{name:'Contorno da propriedade',exact:true}).uncheck();await expect(page.locator('path.is-property')).toHaveCount(0)
  await page.getByRole('button',{name:'Ver no mapa',exact:true}).click();await expect(page.locator('path.is-property')).toHaveCount(1);await expect(field).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('combobox',{name:'Safra',exact:true})).toHaveValue('2026/27')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 })
}
