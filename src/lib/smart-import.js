import questions from '../data/questions.json' with {type:'json'}
import matrix from '../data/profile-matrix.json' with {type:'json'}
import {normalizeText} from './profile.js'

const aliases={
 1:['nome','produtor','nome produtor','cliente','razao social'],
 2:['municipio','localidade','cidade','localizacao'],
 3:['area','area total','area cultivada','hectares','ha'],
 4:['culturas','principais culturas','cultura'],
 5:['tempo relacionamento','relacionamento empresa','tempo de relacionamento'],
 6:['decisores','participantes decisao','quem decide']
}

function parseDelimited(text,delimiter){
 const rows=[];let row=[];let cell='';let quoted=false
 for(let index=0;index<text.length;index++){
  const char=text[index]
  if(char==='"'&&quoted&&text[index+1]==='"'){cell+='"';index++;continue}
  if(char==='"'){quoted=!quoted;continue}
  if(char===delimiter&&!quoted){row.push(cell.trim());cell='';continue}
  if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
  cell+=char
 }
 row.push(cell.trim());if(row.some(Boolean))rows.push(row)
 return rows
}

export function normalizeImportRows(value){
 const sheets=Array.isArray(value)?value.filter(item=>item&&typeof item==='object'&&Array.isArray(item.data)):[]
 const selectedSheet=sheets.find(item=>/\b(form\s*responses?|respostas?)\b/i.test(String(item.sheet||item.name||'')))
  ||sheets.find(item=>item.data.length>1&&Array.isArray(item.data[0])&&item.data[0].length>=10)
  ||sheets[0]
 const candidate=selectedSheet?.data
  ||(Array.isArray(value?.data)?value.data:null)
  ||(Array.isArray(value?.rows)?value.rows:null)
  ||(Array.isArray(value)?value:[])
 return candidate.map(row=>Array.isArray(row)?row:row&&typeof row==='object'?Object.values(row):[row]).filter(row=>row.some(cell=>String(cell??'').trim()))
}

export async function parseImportFile(file){
 const extension=file.name.split('.').pop().toLowerCase()
 if(extension==='xlsx'){
  const {default:readXlsxFile}=await import('read-excel-file/browser')
  const rows=normalizeImportRows(await readXlsxFile(file))
  if(!rows.length)throw new Error('Nenhuma aba da planilha contém linhas reconhecíveis.')
  return {rows,format:'Excel'}
 }
 if(extension==='pdf'){
  const [pdfjs,worker]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default
  const document=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise
  const lines=[]
  for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
   const page=await document.getPage(pageNumber);const content=await page.getTextContent()
   lines.push(content.items.map(item=>item.str).join(' '))
  }
  return {text:lines.join('\n'),format:'PDF'}
 }
 const text=await file.text()
 if(extension==='json'){
  const parsed=JSON.parse(text);const list=Array.isArray(parsed)?parsed:[parsed]
  if(list.length&&typeof list[0]==='object')return {rows:[Object.keys(list[0]),...list.map(item=>Object.keys(list[0]).map(key=>item[key]))],format:'JSON'}
 }
 if(extension==='csv'||extension==='tsv')return {rows:parseDelimited(text,extension==='tsv'?'\t':guessDelimiter(text)),format:extension.toUpperCase()}
 return {text,format:'Texto'}
}

function guessDelimiter(text){
 const sample=text.split(/\r?\n/).slice(0,4).join('\n')
 return (sample.match(/;/g)||[]).length>(sample.match(/,/g)||[]).length?';':','
}

function similarity(a,b){
 const left=new Set(normalizeText(a).split(' ').filter(word=>word.length>2));const right=new Set(normalizeText(b).split(' ').filter(word=>word.length>2))
 const common=[...left].filter(word=>right.has(word)).length
 return common/Math.max(left.size,right.size,1)
}

function questionFor(label){
 const normalized=normalizeText(label).replace(/^\d+\s*/,'')
 const numeric=Number(String(label).match(/^\s*(\d{1,2})/)?.[1])
 if(numeric>=1&&numeric<=45)return questions.find(question=>question.id===numeric)
 for(const [id,list] of Object.entries(aliases))if(list.some(alias=>normalized===alias||normalized.includes(alias)))return questions.find(question=>question.id===Number(id))
 return [...questions].map(question=>({question,score:similarity(normalized,question.text)})).sort((a,b)=>b.score-a.score)[0]?.score>=.36?[...questions].map(question=>({question,score:similarity(normalized,question.text)})).sort((a,b)=>b.score-a.score)[0].question:null
}

function normalizeAnswer(question,value){
 if(value===undefined||value===null)return ''
 const raw=String(value).trim();if(!raw)return ''
 if(question.id>=19&&question.id<=24){const number=Number(raw.replace(',','.'));return Number.isFinite(number)&&number>=0&&number<=10?number:''}
 const options=[...new Set(matrix.filter(item=>item.Pergunta===question.id).map(item=>item.Alternativa))]
 if(!options.length)return raw
 const ranked=options.map(option=>({option,score:similarity(raw,option)+(normalizeText(raw)===normalizeText(option)?1:0)})).sort((a,b)=>b.score-a.score)
 return ranked[0]?.score>=.28?ranked[0].option:''
}

export function recognizeQuestionnaire(source){
 const recognizePairs=candidates=>{
  const answers={};const recognized=[]
  candidates.forEach(([label,value])=>{
   const question=questionFor(label);if(!question||answers[question.id]!==undefined||String(value??'').trim()==='')return
   const normalized=normalizeAnswer(question,value);if(normalized==='')return
   answers[question.id]=normalized;recognized.push({id:question.id,question:question.text.replace(/^\d+\.\s*/,''),value:normalized})
  })
  const missing=questions.filter(question=>answers[question.id]===undefined)
  return {answers,recognized,missing,requiredMissing:missing.filter(question=>question.id<=26),confidence:Math.round(recognized.length/questions.length*100),producerName:String(answers[1]||'Produtor sem nome')}
 }
 const rows=normalizeImportRows(source.rows).map(row=>row.map(value=>value??''))
 let records=[]
 if(rows[0]?.length>2&&rows.length>1){
  const headers=rows[0]
  records=rows.slice(1).filter(row=>row.some(value=>String(value??'').trim())).map(row=>recognizePairs(headers.map((header,index)=>[header,row[index]]))).filter(record=>record.recognized.length)
 }else if(rows.length){
  records=[recognizePairs(rows.filter(row=>row.length>=2).map(row=>[row[0],row.slice(1).filter(value=>String(value??'').trim()).join(' ')]))]
 }
 if(!records.length&&source.text){
  const pairs=[]
  source.text.split(/\r?\n/).forEach(line=>{const match=line.match(/^\s*(.{2,180}?)[\s]*[:;=\-–][\s]*(.+)$/);if(match)pairs.push([match[1],match[2]])})
  records=[recognizePairs(pairs)]
 }
 records=records.filter(record=>record.recognized.length)
 const first=records[0]||recognizePairs([])
 return {...first,records,recordCount:records.length,format:source.format}
}

export function tableToObjects(rows){
 if(!rows?.length)return []
 const headers=rows[0].map((value,index)=>String(value||`coluna_${index+1}`).trim())
 return rows.slice(1).filter(row=>row.some(value=>String(value??'').trim())).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??''])))
}
