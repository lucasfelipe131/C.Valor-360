#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
path=Path('scripts/apply-c1.py')
source=path.read_text()
source=source.replace("onNotice?.('Login criado com carteira zerada.')","onNotify?.('Login criado com carteira zerada.')")
source=source.replace("(\"'referências observadas em até 24h'\",\"'referências observadas nas últimas 24 h'\",'espaço e clareza de horas')","('detail=\"referências observadas em até 24h\"','detail=\"referências observadas nas últimas 24 h\"','espaço e clareza de horas')")
path.write_text(source)
PY
python3 scripts/apply-c1.py
rm -f scripts/run-c1-fixed.sh .github/workflows/run-c1-fixed.yml scripts/run-c1-fixed2.sh .github/workflows/run-c1-fixed2.yml
