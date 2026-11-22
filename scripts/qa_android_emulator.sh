#!/usr/bin/env bash
# Teste efetivo do APK instalado no emulador.
# O shell 'am instrument' pode devolver status 0 mesmo após FAILURES!!!
set -euo pipefail
apk="apk-candidate/app-debug.apk"
test_apk="apk-instrumentation/app-debug-androidTest.apk"
test -s "$apk"
test -s "$test_apk"
package_id="${QA_ANDROID_PACKAGE:-br.com.buscadordehinos.app}"
if [ "$package_id" != br.com.buscadordehinos.app ]; then
  adb install -r qa-previous/Buscador-de-Hinos-2.6.15.apk
fi
adb install -r "$apk"
if [ "$package_id" != br.com.buscadordehinos.app ]; then
  adb shell pm path br.com.buscadordehinos.app | grep '^package:'
  adb shell pm path "$package_id" | grep '^package:'
  echo 'APK anterior e edição de teste instalados lado a lado.'
fi
adb install -r "$test_apk"
adb shell svc wifi disable
adb shell svc data disable
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
adb shell am instrument -w -r -e class \
  br.com.buscadordehinos.app.E5DeviceSmokeTest \
  "$package_id.test/androidx.test.runner.AndroidJUnitRunner" | tee "$log"
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
