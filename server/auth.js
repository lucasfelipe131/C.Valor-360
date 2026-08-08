import {createHmac,timingSafeEqual} from 'node:crypto'

const safeEqual=(left,right)=>{
  const a=Buffer.from(String(left||''));const b=Buffer.from(String(right||''))
  return a.length===b.length&&timingSafeEqual(a,b)
}
const cookies=request=>Object.fromEntries(String(request.headers.cookie||'').split(';').map(item=>item.trim().split(/=(.*)/s)).filter(parts=>parts[0]).map(([key,value])=>[key,value||'']))

export function createAuth(runtimeConfig){
  const configured=Boolean(runtimeConfig.adminEmail&&runtimeConfig.adminPassword.length>=12&&runtimeConfig.sessionSecret.length>=32)
  const sign=value=>createHmac('sha256',runtimeConfig.sessionSecret).update(value).digest('base64url')

  function issue(email){
    const payload=Buffer.from(JSON.stringify({email,tenantId:runtimeConfig.defaultTenantId,role:'admin',exp:Math.floor(Date.now()/1000)+runtimeConfig.sessionTtlSeconds})).toString('base64url')
    return `${payload}.${sign(payload)}`
  }

  function verifyToken(token){
    if(!configured||!token)return null
    const [payload,signature]=String(token).split('.')
    if(!payload||!signature||!safeEqual(signature,sign(payload)))return null
    try{const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return parsed.exp>Math.floor(Date.now()/1000)&&safeEqual(parsed.email,runtimeConfig.adminEmail.trim().toLowerCase())&&safeEqual(parsed.tenantId,runtimeConfig.defaultTenantId)?parsed:null}catch{return null}
  }

  function verifyCredentials(email,password){return configured&&safeEqual(String(email).trim().toLowerCase(),runtimeConfig.adminEmail.trim().toLowerCase())&&safeEqual(password,runtimeConfig.adminPassword)}
  function session(request){return verifyToken(cookies(request).valor360_session)}
  function cookie(request,token){
    const secure=process.env.NODE_ENV==='production'||String(request.headers['x-forwarded-proto']||'').includes('https')
    return `valor360_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${runtimeConfig.sessionTtlSeconds}${secure?'; Secure':''}`
  }
  function clearCookie(request){const secure=process.env.NODE_ENV==='production'||String(request.headers['x-forwarded-proto']||'').includes('https');return `valor360_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`}

  return {configured,issue,verifyCredentials,session,cookie,clearCookie}
}
