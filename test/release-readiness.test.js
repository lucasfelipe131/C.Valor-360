import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {readReleaseMetadata,RELEASE_SCHEMA_VERSION} from '../server/release-metadata.js'
import {createReadinessReport} from '../server/readiness.js'

test('release reportado corresponde ao commit produzido e ao runtime',()=>{
 const root=mkdtempSync(join(tmpdir(),'val-release-'))
 try{
  mkdirSync(join(root,'dist'),{recursive:true})
  const commitSha='a'.repeat(40)
  writeFileSync(join(root,'dist','release.json'),JSON.stringify({schemaVersion:RELEASE_SCHEMA_VERSION,release:{id:commitSha.slice(0,16),sourceHash:'source-hash'},source:{commitSha,origin:'env:RAILWAY_GIT_COMMIT_SHA'}}))
  const metadata=readReleaseMetadata({root,env:{RAILWAY_GIT_COMMIT_SHA:commitSha}})
  assert.equal(metadata.source.commitSha,commitSha)
  assert.equal(metadata.source.buildCommitSha,commitSha)
  assert.equal(metadata.source.runtimeCommitSha,commitSha)
  assert.equal(metadata.source.match,true)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('divergência entre build e runtime bloqueia readiness',()=>{
 const root=mkdtempSync(join(tmpdir(),'val-release-mismatch-'))
 try{
  mkdirSync(join(root,'dist'),{recursive:true})
  writeFileSync(join(root,'dist','release.json'),JSON.stringify({schemaVersion:RELEASE_SCHEMA_VERSION,release:{id:'a'.repeat(16),sourceHash:'source-hash'},source:{commitSha:'a'.repeat(40),origin:'build'}}))
  const metadata=readReleaseMetadata({root,env:{RAILWAY_GIT_COMMIT_SHA:'b'.repeat(40)}})
  const readiness=createReadinessReport({databaseHealth:{configured:true,ready:true},authConfigured:true,openaiConfigured:true,releaseMetadata:metadata})
  assert.equal(metadata.source.match,false)
  assert.equal(readiness.ready,false)
  assert.equal(readiness.status,'not_ready')
  assert.equal(readiness.dependencies.release.ready,false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('readiness separa dependência obrigatória de IA opcional',()=>{
 const report=createReadinessReport({databaseHealth:{configured:true,ready:true},authConfigured:true,openaiConfigured:false,releaseMetadata:{source:{match:null}}})
 assert.equal(report.ready,true)
 assert.equal(report.dependencies.storage.mode,'postgresql')
 assert.equal(report.dependencies.security.mode,'protected')
 assert.equal(report.dependencies.ai.required,false)
 assert.equal(report.dependencies.ai.mode,'deterministic-fallback')
})

test('banco ou segurança indisponível retorna not_ready',()=>{
 const databaseDown=createReadinessReport({databaseHealth:{configured:true,ready:false},authConfigured:true,releaseMetadata:{source:{match:true}}})
 const securityDown=createReadinessReport({databaseHealth:{configured:true,ready:true},authConfigured:false,demoMode:false,releaseMetadata:{source:{match:true}}})
 assert.equal(databaseDown.ready,false)
 assert.equal(securityDown.ready,false)
})
