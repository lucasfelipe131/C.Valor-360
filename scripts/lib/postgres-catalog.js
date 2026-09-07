// pg_dump/restore can distribute a varchar[] -> text[] cast over each
// varchar literal. Canonicalize only that lossless, literal-only shape;
// quoted SQL, other casts, expressions and every index attribute stay intact.
const varcharLiteral=String.raw`'(?:''|[^'])*'::character varying`
const quotedSql=String.raw`(?:[eE]'(?:\\.|''|[^'])*'|'(?:''|[^'])*'|"(?:""|[^"])*")`
const arrayCast=new RegExp(`(${quotedSql})|\\(ARRAY\\[(${varcharLiteral}(?:, ${varcharLiteral})*)\\]\\)::text\\[\\]`,'g')
const literals=new RegExp(varcharLiteral,'g')

export const semanticIndexDefinition=value=>String(value).replace(arrayCast,(match,quoted,items)=>quoted||`ARRAY[${items.match(literals).map(item=>`(${item})::text`).join(', ')}]`)
