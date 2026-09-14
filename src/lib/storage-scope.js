// O escopo de armazenamento do usuário logado, gravado no login (App.jsx) e apagado na saída.
// Fica isolado num módulo próprio porque agora dois lugares precisam dele — o cache da carteira e
// o rascunho do questionário — e importar o App.jsx a partir de um componente criaria um ciclo.
export const activeStorageScopeKey='valor360-active-storage-scope'
export function activeStorageScope(){
 try{return typeof sessionStorage==='undefined'?'':String(sessionStorage.getItem(activeStorageScopeKey)||'')}
 catch{return ''}
}
