#!/usr/bin/env bash
# Teste efetivo do APK instalado no emulador.
# O shell 'am instrument' pode devolver status 0 mesmo após FAILURES!!!
set -euo pipefail
apk="apk-candidate/app-debug.apk"
test_apk="apk-instrumentation/app-debug-androidTest.apk"
pkg="${HINOS_PACKAGE:-br.com.buscadordehinos.app}"
runner="${pkg}.test/androidx.test.runner.AndroidJUnitRunner"
test -s "$apk"
test -s "$test_apk"
adb install -r "$apk"
adb install -r "$test_apk"
adb shell svc wifi disable
adb shell svc data disable
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
adb shell am instrument -w -r -e class \
  br.com.buscadordehinos.app.E5DeviceSmokeTest \
  $runner | tee "$log"
if grep -Eq 'FAILURES!!!|INSTRUMENTATION_STATUS_CODE: -2|Error in webViewLoads' "$log"; then
  echo "REPROVADO: Android instrumentation declarou falha."
  exit 1
fi
if ! grep -Eq 'OK \([0-9]+ tests?\)' "$log" ||
   ! grep -Eq 'INSTRUMENTATION_STATUS_CODE: 0' "$log"; then
  echo "REPROVADO: teste nativo Android não apresentou aprovação explícita."
  exit 1
fi
mkdir -p qa-report
cp "$log" qa-report/android-device-evidence.log
echo "AGENTE ANDROID — APROVADO: WebView, tela Sobre e inferência E5 ONNX real."
