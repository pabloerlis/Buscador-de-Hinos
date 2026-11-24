#!/usr/bin/env bash
# Único processo Bash: android-emulator-runner executa scripts multilinha como
# comandos independentes; `adb shell am instrument -e class` precisa ser um só.
set -Eeuo pipefail
mkdir -p qa-report
LOG="qa-report/telepatia-android-device.log"
: > "$LOG"
trap 'echo "ANDROID_TELEPATIA_TEST_FAILED; consultar logcat e instrumentação" >&2; adb logcat -d -t 350 2>/dev/null | grep -E "TELEPATIA_NLI_QA|AndroidRuntime|FATAL EXCEPTION|onnxruntime|Instrumentation" | tail -120 >&2 || true' ERR
adb wait-for-device
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am start -n br.com.buscadordehinos.app/.MainActivity
sleep 3
adb shell mkdir -p /sdcard/Android/data/br.com.buscadordehinos.app/files
adb push .tmp/device-transfer/telepatia.zip /sdcard/Android/data/br.com.buscadordehinos.app/files/telepatia.zip
adb push .tmp/device-transfer/telepatia-golden.json /sdcard/Android/data/br.com.buscadordehinos.app/files/telepatia-golden.json
adb shell ls -lh /sdcard/Android/data/br.com.buscadordehinos.app/files/
adb shell svc wifi disable
adb shell svc data disable
adb shell am force-stop br.com.buscadordehinos.app
# Capturar também stderr e código de retorno; pipefail é obrigatório.
timeout 900 adb shell am instrument -w -r -e class br.com.buscadordehinos.app.TelepatiaDeviceSmokeTest br.com.buscadordehinos.app.test/androidx.test.runner.AndroidJUnitRunner 2>&1 | tee "$LOG"
grep -Eq 'OK \(2 tests?\)' "$LOG"
grep -Eq 'INSTRUMENTATION_STATUS_CODE: 0' "$LOG"
! grep -Eq 'FAILURES!!!|INSTRUMENTATION_STATUS_CODE: -2' "$LOG"
echo "TELEPATIA_DEVICE_QA_PASS"
