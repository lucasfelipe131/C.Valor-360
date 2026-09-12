import test from 'node:test'
import assert from 'node:assert/strict'
import {pinPhotoUrls,visiblePinLabels} from '../src/lib/map-pin-presentation.js'

test('map photos prefer the specific property, then the producer, excluding external and executable URLs',()=>{
 const propertyPhotoUrl='/api/clients/owner/properties/farm/profile-photo?content=1&v=1'
 const producerPhotoUrl='/api/clients/owner/profile-photo?content=1&v=2'
 assert.deepEqual(pinPhotoUrls({propertyPhotoUrl,producerPhotoUrl}),[propertyPhotoUrl,producerPhotoUrl])
 assert.deepEqual(pinPhotoUrls({producerPhotoUrl}),[producerPhotoUrl])
 for(const url of ['javascript:alert(1)','https://other.test/photo','//other.test/photo','data:image/png;base64,test','/api/auth/profile'])assert.deepEqual(pinPhotoUrls({producerPhotoUrl:url}),[])
 assert.deepEqual(pinPhotoUrls({}),[])
})

const rect=(x,y,w=100,h=18)=>({left:x,top:y,right:x+w,bottom:y+h,width:w,height:h})
test('nearby labels never overlap, selected label wins and more labels return after zooming in',()=>{
 const bounds=rect(0,0,390,844)
 const entries=[{id:'a',rect:rect(30,50)},{id:'b',rect:rect(70,50),selected:true},{id:'c',rect:rect(200,50)}]
 assert.deepEqual([...visiblePinLabels(entries,[],bounds)],['b','c'])
 assert.deepEqual([...visiblePinLabels([{...entries[0],active:true},...entries.slice(1)],[],bounds)],['a','c'])
 assert.equal(visiblePinLabels([entries[0],{...entries[1],rect:rect(140,50)}, {...entries[2],rect:rect(250,50)}],[],bounds).size,3)
 assert.equal(visiblePinLabels([{id:'offscreen',rect:rect(380,50)}],[],bounds).size,0)
 assert.equal(visiblePinLabels(entries,[{id:'other-pin',rect:rect(90,45,34,40)}],bounds).has('b'),false)
})
