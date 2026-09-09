import {parseCadastralFile} from './cadastral-import.js'
self.onmessage=({data})=>{
 try{self.postMessage({geojson:parseCadastralFile(data.source,data.filename)})}
 catch(error){self.postMessage({error:error instanceof SyntaxError?'Arquivo inválido. Use KML ou GeoJSON WGS84.':error.message})}
}
