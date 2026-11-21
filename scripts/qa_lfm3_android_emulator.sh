#!/usr/bin/env bash
# Agente Android independente: GGUF LFM3 oficial REAL via JNI, não um mock.
set -euo pipefail
apk="apk-candidate/app-debug.apk"
baseline="apk-baseline/app-debug.apk"
test -s "$baseline"
test_apk="apk-instrumentation/app-debug-androidTest.apk"
model="/tmp/LFM3-1.7B-QAD-Q4_0.gguf"
pkg="br.com.buscadordehinos.app"
test -s "$apk"
test -s "$test_apk"
test -s "$model"
adb shell svc wifi disable
adb shell svc data disable
mkdir -p qa-report
: > qa-report/lfm3-device-evidence.log
for mode in baseline optimized; do
  if [ "$mode" = baseline ]; then selected="$baseline"; else selected="$apk"; fi
  echo "=== TESTE LFM3 $mode ===" | tee -a qa-report/lfm3-device-evidence.log
  adb install -r "$selected"
  adb install -r "$test_apk"
  adb push "$model" /data/local/tmp/hinos-lfm3.gguf
  adb shell chmod 644 /data/local/tmp/hinos-lfm3.gguf
  adb shell run-as "$pkg" mkdir -p files
  adb shell run-as "$pkg" cp /data/local/tmp/hinos-lfm3.gguf files/qa-lfm3.gguf
  adb logcat -c
  log="$(mktemp)"
  # A variante historica pode expirar; nao bloquear a execucao da variante otimizada.
  # Somente o timeout da comparacao baseline, apos OK real, pode ser observado como controle negativo.
  set +e
  timeout 750s adb shell am instrument -w -r -e class \
    br.com.buscadordehinos.app.Lfm3DeviceSmokeTest \
    br.com.buscadordehinos.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$log"
  instrument_rc=${PIPESTATUS[0]}
  set -e
  adb logcat -d -v brief -s 'LFM3_BENCH:I' '*:S' | tee -a "$log"
  if ! grep -q 'BENCHMARK_RESULT case=simple ' "$log"; then
    echo "REPROVADO: baseline/otimizada sem inferencia simples mensuravel ($mode)."
    exit 1
  fi
  if [ "$mode" = baseline ] \
      && grep -q 'Caused by: java.lang.IllegalStateException: Tempo limite de geração atingido.' "$log" \
      && grep -q 'INSTRUMENTATION_STATUS_CODE: -2' "$log" \
      && ! grep -q 'BENCHMARK_RESULT case=compare-five ' "$log" \
      && [ "$instrument_rc" -eq 0 ]; then
    echo 'EXPECTED_BASELINE_TIMEOUT case=compare-five budget_ms=180000' | tee -a "$log"
  else
    if [ "$instrument_rc" -ne 0 ] \
        || grep -Eq 'FAILURES!!!|INSTRUMENTATION_STATUS_CODE: -2|Error in officialLfm3' "$log" \
        || ! grep -Eq 'OK \(1 tests?\)' "$log" \
        || ! grep -q 'INSTRUMENTATION_STATUS_CODE: 0' "$log" \
        || ! grep -q 'BENCHMARK_RESULT case=compare-five ' "$log"; then
      echo "REPROVADO: execução LFM3 não aprovada ($mode)."
      exit 1
    fi
  fi
  cat "$log" >> qa-report/lfm3-device-evidence.log
  rm -f "$log"
  adb shell run-as "$pkg" rm -f files/qa-lfm3.gguf
  adb shell rm -f /data/local/tmp/hinos-lfm3.gguf
done
python3 scripts/qa_native_performance_gate.py --generate-only
echo "AGENTE LFM3 — APROVADO: GGUF oficial, JNI, carregamento e saída GBNF reais."
