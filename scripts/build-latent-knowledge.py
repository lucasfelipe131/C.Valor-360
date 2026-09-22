# Offline release tooling; Python/numpy required only to rebuild the index.
import numpy as np,json,re,unicodedata
from collections import Counter
from pathlib import Path
corpus=Path(__file__).resolve().parents[1]/'knowledge/library/v1/knowledge_items.jsonl'
items=[json.loads(x) for x in corpus.read_text().splitlines() if x]
stop=set('a ao aos as com como da das de do dos e ele ela em entre essa esse esta este eu foi ha isso ja mais mas na nas no nos o os ou para pela pelo por que se sem ser sua suas seu seus tem um uma voce qual quais quem quando onde quanto porque sobre deve pode antes depois'.split())
def tok(s):
 s=''.join(c for c in unicodedata.normalize('NFD',s.lower()) if not unicodedata.combining(c));return [w for w in re.findall('[a-z0-9]+',s) if len(w)>2 and w not in stop]
docs=[Counter(tok(' '.join([i['title'],i['principle'],i['val_application'],*i['triggers'],*i['recommended_actions']]))) for i in items]
vocab=sorted(set().union(*docs)); ids={w:n for n,w in enumerate(vocab)};df=np.array([sum(w in d for d in docs) for w in vocab]);idf=np.log((1+len(docs))/(1+df))+1
X=np.zeros((len(docs),len(vocab)))
for n,d in enumerate(docs):
 for w,c in d.items():X[n,ids[w]]=(1+np.log(c))*idf[ids[w]]
X/=np.linalg.norm(X,axis=1,keepdims=True)
u,s,vt=np.linalg.svd(X,full_matrices=False);basis=vt[:48].T;dv=X@basis;dv/=np.linalg.norm(dv,axis=1,keepdims=True)

import hashlib
output={'method':'TFIDF_TRUNCATED_SVD_COSINE_V1','dimensions':48,'corpus_sha256':hashlib.sha256(corpus.read_bytes()).hexdigest(),'terms':{w:{'idf':round(float(idf[i]),8),'vector':[round(float(v),8) for v in basis[i]]} for w,i in ids.items()},'documents':[{'id':item['item_id'],'vector':[round(float(v),8) for v in dv[i]]} for i,item in enumerate(items)]}
(corpus.parent/'latent-index.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
print('Built fixed public corpus LSA index:',len(items),'documents;',len(vocab),'terms')
