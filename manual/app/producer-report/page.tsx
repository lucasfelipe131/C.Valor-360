import ProducerReport from './ProducerReport';
export default async function Page({searchParams}:{searchParams:Promise<{clientId?:string;season?:string}>}){
 const query=await searchParams;
 return <ProducerReport clientId={String(query.clientId||'').slice(0,180)} season={String(query.season||'').slice(0,30)}/>;
}
