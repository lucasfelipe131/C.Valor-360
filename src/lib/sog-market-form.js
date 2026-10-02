// datetime-local carries wall-clock time in the browser's timezone. Serialize
// the instant before crossing the API boundary; the server cannot infer it.
export function marketFormPayload(form){
 const observed=new Date(form.observedAt)
 if(!form.observedAt||Number.isNaN(observed.getTime()))throw new Error('Informe quando a cotação foi observada.')
 return {...form,observedAt:observed.toISOString()}
}
