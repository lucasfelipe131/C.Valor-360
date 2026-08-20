const repository=String(process.env.GITHUB_REPOSITORY||'').trim()
const token=String(process.env.GITHUB_TOKEN||'').trim()
if(!/^[^/]+\/[^/]+$/.test(repository)||!token)throw new Error('Defina GITHUB_REPOSITORY=owner/repo e GITHUB_TOKEN com leitura de administração do repositório.')

const response=await fetch(`https://api.github.com/repos/${repository}/branches/main/protection`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'}})
if(!response.ok)throw new Error(`Não foi possível verificar a proteção de main (HTTP ${response.status}).`)
const protection=await response.json()
const contexts=new Set(protection.required_status_checks?.contexts||[])
const required=['npm test','npm run build','manual npm run build']
const result={
  repository,
  branch:'main',
  pullRequestRequired:Boolean(protection.required_pull_request_reviews),
  codeOwnerReviewRequired:Boolean(protection.required_pull_request_reviews?.require_code_owner_reviews),
  approvals:Number(protection.required_pull_request_reviews?.required_approving_review_count||0),
  conversationResolutionRequired:Boolean(protection.required_conversation_resolution?.enabled),
  forcePushBlocked:protection.allow_force_pushes?.enabled===false,
  deletionBlocked:protection.allow_deletions?.enabled===false,
  requiredChecks:required.map(name=>({name,present:contexts.has(name)}))
}
result.gatePassed=result.pullRequestRequired&&result.codeOwnerReviewRequired&&result.approvals>=1&&result.conversationResolutionRequired&&result.forcePushBlocked&&result.deletionBlocked&&result.requiredChecks.every(item=>item.present)
console.log(JSON.stringify(result,null,2))
if(!result.gatePassed)process.exitCode=1
