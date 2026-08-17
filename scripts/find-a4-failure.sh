#!/usr/bin/env bash
set -euo pipefail
echo '=== REFERÊNCIAS À PORTA LEGADA ==='
grep -RFn "Dados do dossiê e lacunas revisados." test server src docs || true
echo '=== REFERÊNCIAS A working_stage_gate ==='
grep -RFn "working_stage_gate" test | head -100 || true
