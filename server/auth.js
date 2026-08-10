import {createHmac,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto'
import {promisify} from 'node:util'

const scrypt=promisify(scryptCallback)
const roles=new Set(['admin','manager','consultant','technical_reviewer'])
const safeEqual=(left,right)=>{
  const a=Buffer.from(String(left||''));const b=Buffer.from(String(right||''))
  return a.length===b.length&&timingSafeEqual(a,b)
}
const cookies=request=>Object.fromEntries(String(request.headers.cookie||'').split(';').map(item=>item.trim().split(/=(.*)/s)).filter(parts=>parts[0]).map(([key,value])=>[key,value||'']))

export const normalizeEmail=value=>String(value||'').trim().toLocaleLowerCase('pt-BR').slice(0,180)
export const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmail(value))
export const validPassword=value=>/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,72}$/.test(String(value||''))

export async function hashPassword(password,{enforcePolicy=true}={}){
  if((enforcePolicy&&!validPassword(password))||String(password||'').length<8||String(password||'').length>200)throw Object.assign(new Error('A senha precisa ter de 8 a 72 caracteres, com maiúscula, minúscula e número.'),{statusCode:400})
  const salt=randomBytes(16).toString('hex');const derived=await scrypt(String(password),salt,64)
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`
}

export async function verifyPassword(password,encoded){
  const [scheme,salt,expectedHex]=String(encoded||'').split('$')
  if(scheme!=='scrypt'||!salt||!/^[0-9a-f]+$/i.test(expectedHex||''))return false
  const expected=Buffer.from(expectedHex,'hex');const actual=Buffer.from(await scrypt(String(password||''),salt,expected.length))
  return expected.length===actual.length&&timingSafeEqual(expected,actual)
}

export function generateTemporaryPassword(){
  const uppercase='ABCDEFGHJKLMNPQRSTUVWXYZ';const lowercase='abcdefghijkmnopqrstuvwxyz';const digits='23456789';const alphabet=`${uppercase}${lowercase}${digits}`
  const pick=source=>source[randomBytes(1)[0]%source.length];const characters=[pick(uppercase),pick(lowercase),pick(digits)]
  while(characters.length<12)characters.push(pick(alphabet))
  const shuffle=randomBytes(characters.length)
  for(let index=characters.length-1;index>0;index--){const target=shuffle[index]%(index+1);[characters[index],characters[target]]=[characters[target],characters[index]]}
  return characters.join('')
}

export function createAuth(runtimeConfig){
  const configured=Boolean(runtimeConfig.adminEmail&&runtimeConfig.adminPassword.length>=12&&runtimeConfig.sessionSecret.length>=32)
  const sign=value=>createHmac('sha256',runtimeConfig.sessionSecret).update(value).digest('base64url')

  function issue(identity){
    const source=typeof identity==='string'?{email:identity,role:'admin',tenantId:runtimeConfig.defaultTenantId}:identity||{}
    const payload=Buffer.from(JSON.stringify({
      sub:String(source.id||source.sub||''),
      email:normalizeEmail(source.email),
      tenantId:String(source.tenantId||runtimeConfig.defaultTenantId),
      role:roles.has(source.role)?source.role:'consultant',
      name:String(source.name||source.displayName||'').slice(0,120),
      mustChangePassword:Boolean(source.mustChangePassword),
      sessionVersion:Number(source.sessionVersion||0),
      exp:Math.floor(Date.now()/1000)+runtimeConfig.sessionTtlSeconds
    })).toString('base64url')
    return `${payload}.${sign(payload)}`
  }

  function verifyToken(token){
    if(!configured||!token)return null
    const [payload,signature]=String(token).split('.')
    if(!payload||!signature||!safeEqual(signature,sign(payload)))return null
    try{
      const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))
      if(parsed.exp<=Math.floor(Date.now()/1000)||!validEmail(parsed.email)||!safeEqual(parsed.tenantId,runtimeConfig.defaultTenantId)||!roles.has(parsed.role))return null
      return parsed
    }catch{return null}
  }

  function verifyBootstrapCredentials(email,password){return configured&&safeEqual(normalizeEmail(email),normalizeEmail(runtimeConfig.adminEmail))&&safeEqual(password,runtimeConfig.adminPassword)}
  function storageScope(identity){
    const tenantId=String(identity?.tenantId||runtimeConfig.defaultTenantId||'default').trim().toLowerCase()
    const subject=String(identity?.sub||identity?.id||identity?.email||'demo').trim().toLowerCase()
    return createHmac('sha256',runtimeConfig.sessionSecret).update(`valor360:browser-storage:v2:${tenantId}:${subject}`).digest('base64url').slice(0,24)
  }
  function session(request){return verifyToken(cookies(request).valor360_session)}
  function cookie(request,token){
    const secure=process.env.NODE_ENV==='production'||String(request.headers['x-forwarded-proto']||'').includes('https')
    return `valor360_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${runtimeConfig.sessionTtlSeconds}${secure?'; Secure':''}`
  }
  function clearCookie(request){const secure=process.env.NODE_ENV==='production'||String(request.headers['x-forwarded-proto']||'').includes('https');return `valor360_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`}

  return {configured,issue,verifyBootstrapCredentials,storageScope,session,cookie,clearCookie}
}
