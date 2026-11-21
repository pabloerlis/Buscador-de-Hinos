#!/usr/bin/env bash
# Agente Android independente: GGUF LFM3 oficial REAL via JNI, não um mock.
set -euo pipefail
apk="apk-candidate/app-debug.apk"
test_apk="apk-instrumentation/app-debug-androidTest.apk"
model="/tmp/LFM3-1.7B-QAD-Q4_0.gguf"
pkg="br.com.buscadordehinos.app"
test -s "$apk"
test -s "$test_apk"
test -s "$model"
adb install -r "$apk"
adb install -r "$test_apk"
adb shell svc wifi disable
adb shell svc data disable
adb push "$model" /data/local/tmp/hinos-lfm3.gguf
adb shell chmod 644 /data/local/tmp/hinos-lfm3.gguf
adb shell run-as "$pkg" mkdir -p files
adb shell run-as "$pkg" cp /data/local/tmp/hinos-lfm3.gguf files/qa-lfm3.gguf
adb shell run-as "$pkg" ls -l files/qa-lfm3.gguf
log="$(mktemp)"
cleanup() {
  adb shell run-as "$pkg" rm -f files/qa-lfm3.gguf || :
  adb shell rm -f /data/local/tmp/hinos-lfm3.gguf || :
  rm -f "$log"
}
trap cleanup EXIT
timeout 750s adb shell am instrument -w -r -e class \
  br.com.buscadordehinos.app.Lfm3DeviceSmokeTest \
  br.com.buscadordehinos.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$log"
if grep -Eq 'FAILURES!!!|INSTRUMENTATION_STATUS_CODE: -2|Error in officialLfm3' "$log"; then
  echo "REPROVADO: inferência LFM3 no Android."
  exit 1
fi
if ! grep -Eq 'OK \(1 tests?\)' "$log" || ! grep -q 'INSTRUMENTATION_STATUS_CODE: 0' "$log"; then
  echo "REPROVADO: sem aprovação explícita do teste LFM3."
  exit 1
fi
mkdir -p qa-report
cp "$log" qa-report/lfm3-device-evidence.log
echo "AGENTE LFM3 — APROVADO: GGUF oficial, JNI, carregamento e saída GBNF reais."
