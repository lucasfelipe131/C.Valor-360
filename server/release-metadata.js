import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'

export const RELEASE_SCHEMA_VERSION='val.release.v1'

const COMMIT_ENV_KEYS=[
  'RAILWAY_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'SOURCE_VERSION',
  'VERCEL_GIT_COMMIT_SHA'
]

export function normalizeCommitSha(value){
  const candidate=String(value??'').trim().toLowerCase()
  return /^[0-9a-f]{7,64}$/.test(candidate)?candidate:''
}

export function resolveSourceCommit({root=process.cwd(),env=process.env,allowGit=true}={}){
  for(const key of COMMIT_ENV_KEYS){
    const commitSha=normalizeCommitSha(env[key])
    if(commitSha)return {commitSha,origin:`env:${key}`}
  }
  if(allowGit){
    try{
      const commitSha=normalizeCommitSha(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}))
      if(commitSha)return {commitSha,origin:'git:HEAD'}
    }catch{}
  }
  return {commitSha:null,origin:'unavailable'}
}

export function readReleaseManifest({root=process.cwd(),path='dist/release.json'}={}){
  const target=resolve(root,path)
  if(!existsSync(target))return null
  try{
    const manifest=JSON.parse(readFileSync(target,'utf8'))
    if(manifest?.schemaVersion!==RELEASE_SCHEMA_VERSION)return null
    return manifest
  }catch{return null}
}

export function readReleaseMetadata({root=process.cwd(),env=process.env}={}){
  const manifest=readReleaseManifest({root})
  const runtime=resolveSourceCommit({root,env})
  const buildCommitSha=normalizeCommitSha(manifest?.source?.commitSha)||null
  const runtimeCommitSha=runtime.commitSha
  const commitSha=buildCommitSha||runtimeCommitSha
  const match=buildCommitSha&&runtimeCommitSha?buildCommitSha===runtimeCommitSha:null
  return {
    schemaVersion:RELEASE_SCHEMA_VERSION,
    release:{
      id:String(manifest?.release?.id||'').trim()||null,
      sourceHash:String(manifest?.release?.sourceHash||'').trim()||null
    },
    source:{
      commitSha,
      buildCommitSha,
      runtimeCommitSha,
      buildOrigin:String(manifest?.source?.origin||'').trim()||null,
      runtimeOrigin:runtime.origin,
      match
    }
  }
}
