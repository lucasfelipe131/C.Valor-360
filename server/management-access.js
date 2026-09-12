export const managementRoles=new Set(['admin','manager','bi_viewer'])

// Applied before dispatching APIs AND the independent Manual proxy.
export function managementOnlyAllowed(identity,path,method='GET'){
 if(identity?.role!=='bi_viewer')return true
 return (path==='/api/management/overview'&&method==='GET')||
  (path==='/api/auth/session'&&method==='GET')||
  (path==='/api/auth/logout'&&method==='POST')||
  (path==='/api/auth/password'&&method==='PUT')
}
