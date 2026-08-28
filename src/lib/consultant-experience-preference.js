export const CONSULTANT_EXPERIENCE_PREFERENCE_VERSION='val.consultant_experience_preference.v1'
export const CONSULTANT_EXPERIENCE_PREFERENCES=['SIMPLE','BALANCED','ANALYTICAL']

export const normalizeConsultantExperiencePreference=value=>CONSULTANT_EXPERIENCE_PREFERENCES.includes(String(value||'').toUpperCase())?String(value).toUpperCase():'SIMPLE'

const keyFor=storageScope=>`${CONSULTANT_EXPERIENCE_PREFERENCE_VERSION}:${String(storageScope||'session')}`

export const readConsultantExperiencePreference=storageScope=>{
 try{return normalizeConsultantExperiencePreference(globalThis.localStorage?.getItem(keyFor(storageScope)))}catch{return 'SIMPLE'}
}

export const writeConsultantExperiencePreference=(storageScope,value)=>{
 const normalized=normalizeConsultantExperiencePreference(value)
 try{globalThis.localStorage?.setItem(keyFor(storageScope),normalized)}catch{}
 return normalized
}

