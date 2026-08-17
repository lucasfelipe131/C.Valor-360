#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
path=Path('scripts/apply-b2.mjs')
source=path.read_text()
source=source.replace("  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`", "  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)")
source=source.replace("for(const stage of ['context','products','language','persist','complete'])assert.match(bootstrap,new RegExp(`emitProgress\\\\(input,'${stage}'\\\\)`))", "for(const stage of ['context','products','language','persist','complete'])assert.match(bootstrap,new RegExp(\"emitProgress\\\\\\\\(input,'\"+stage+\"'\\\\\\\\)\"))")
path.write_text(source)
PY
node --check scripts/apply-b2.mjs
node scripts/apply-b2.mjs
rm -f scripts/run-b2-fixed.sh .github/workflows/run-b2-fixed.yml
