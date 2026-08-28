export function createReadinessReport({databaseHealth={},authConfigured=false,demoMode=false,openaiConfigured=false,releaseMetadata={}}={}){
  const securityReady=Boolean(authConfigured||demoMode)
  const storageReady=Boolean(databaseHealth.ready||(demoMode&&!databaseHealth.configured&&!openaiConfigured))
  const releaseMatch=releaseMetadata?.source?.match
  const releaseReady=releaseMatch!==false
  const ready=securityReady&&storageReady&&releaseReady
  return {
    ready,
    status:ready?'ready':'not_ready',
    service:'valor360',
    dependencies:{
      storage:{ready:storageReady,mode:databaseHealth.ready?'postgresql':databaseHealth.configured?'postgresql-unavailable':demoMode?'demo-fallback':'unavailable'},
      security:{ready:securityReady,mode:authConfigured?'protected':demoMode?'demo':'misconfigured'},
      ai:{ready:Boolean(openaiConfigured),required:false,mode:openaiConfigured?'configured':'deterministic-fallback'},
      release:{ready:releaseReady,verified:releaseMatch===true,match:releaseMatch??null}
    },
    source:releaseMetadata?.source||{commitSha:null,buildCommitSha:null,runtimeCommitSha:null,match:null}
  }
}
