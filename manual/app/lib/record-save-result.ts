type SaveResult = {record?: {id?: string}; integration?: {demoIsolated?: boolean; configured?: boolean; failed?: number; skipped?: number; delivered?: number; blockedCode?: string | null}};

export function recordSaveOutcome(value: unknown) {
 const result=(value || {}) as SaveResult;
 if (!result.record?.id) throw new Error('O servidor não confirmou o salvamento. Mantenha a tela aberta e tente novamente.');
 const integration=result.integration;
 if (integration?.demoIsolated) return {pending:false,message:'Fechamento demonstrativo salvo no histórico do produtor.'};
 const pending=!integration || integration.configured===false || (integration.failed||0)>0 || (integration.skipped||0)>0 || !(integration.delivered && integration.delivered>0);
 if (pending) return {pending:true,message:integration?.blockedCode
  ?'Fechamento salvo no histórico. Entre novamente na sua conta para sincronizar com a VAL.'
  :'Fechamento salvo no histórico. A sincronização com a VAL está pendente; use Salvar e sincronizar para tentar novamente.'};
 return {pending:false,message:'Fechamento salvo no histórico e sincronizado com a VAL.'};
}
