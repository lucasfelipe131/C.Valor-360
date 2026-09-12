import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import postcss from 'postcss'

const css=name=>readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8')

test('legacy next-visit grid cannot assign narrow columns to daily route cards',()=>{
 const root=postcss.parse(css('val-workspace-shell.css'))
 root.walkRules(rule=>{
  if(!rule.selector.includes('home-next-visits'))return
  rule.walkDecls(decl=>{
   if(['display','grid-template-columns','white-space','overflow'].includes(decl.prop)){
    assert.ok(rule.selector.split(',').every(selector=>!selector.includes('home-next-visits')||selector.includes('>ul>li')),rule.selector)
   }
  })
 })
 const route=postcss.parse(css('val-daily-route.css'))
 assert.ok(route.nodes.some(rule=>rule.selector==='.daily-route-item'&&rule.nodes.some(decl=>decl.prop==='display'&&decl.value==='block')))
 const mobile=route.nodes.find(rule=>rule.type==='atrule'&&rule.params==='(max-width:820px)')
 assert.ok(mobile.nodes.some(rule=>rule.selector==='.daily-route-heading'&&rule.nodes.some(decl=>decl.prop==='flex-direction'&&decl.value==='column')))
})

test('mobile actions and producer statistics are not discarded by position',()=>{
 const root=postcss.parse(css('mobile-browser.css'))
 root.walkRules(rule=>{
  if(/top-actions|home-quick-grid>button|client-stats>span|producer-portfolio-summary dl>div|conversion-radar-card/.test(rule.selector)){
   assert.ok(!rule.nodes.some(decl=>decl.prop==='display'&&decl.value==='none'),rule.selector)
  }
 })
 const nav=css('val-mobile-navigation.css')
 assert.match(nav,/padding-bottom:calc\(var\(--val-mobile-nav-space\) \+ 24px\)!important/)
 assert.match(nav,/\.app-shell \.topbar\{flex-wrap:wrap/)
})
