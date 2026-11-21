#!/usr/bin/env python3
"""Record actual ARM64 Android evidence for the already approved v2.6.10 APK.
Never uninstalls the application or clears its private data. No synthetic device
run is accepted as physical evidence. The independent agent audits the logs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

APP_SHA = "329a6195d3582a945a47894cc5e4e432e589bb41ba8bf4bfe785bdd49baa7fed"
PACKAGE = "br.com.buscadordehinos.app"
TEST_RUNNER = PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = PACKAGE + ".E5DeviceSmokeTest"


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fd:
        for block in iter(lambda: fd.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def execute(args, timeout=240):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("Command failed (" + str(result.returncode) + "): "
                           + " ".join(args[:3]) + "\n" + result.stdout[-1200:])
    return result.stdout


def choose_serial(requested):
    lines = execute(["adb", "devices", "-l"]).splitlines()[1:]
    ready = [row.split()[0] for row in lines if "\tdevice " in row or row.endswith("\tdevice")]
    if requested:
        if requested not in ready:
            raise RuntimeError("Requested ADB device is not connected and authorized")
        return requested
    if len(ready) != 1:
        raise RuntimeError("Connect exactly one authorized physical device or supply --serial")
    return ready[0]


def device_command(serial, *args, timeout=240):
    return execute(["adb", "-s", serial, *args], timeout=timeout)


def property_of(serial, key):
    return device_command(serial, "shell", "getprop", key).strip()


def setting(serial, key):
    return device_command(serial, "shell", "settings", "get", "global", key).strip()


def save(directory, name, data):
    (directory / name).write_text(data, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Physical ARM64 v2.6.10 E5 test recorder")
    parser.add_argument("--app", required=True, type=Path, help="Approved app-debug.apk")
    parser.add_argument("--tests", required=True, type=Path, help="Matching app-debug-androidTest.apk from the same CI")
    parser.add_argument("--out", default="arm64-local-evidence", type=Path)
    parser.add_argument("--serial", help="ADB serial (never written to output)")
    args = parser.parse_args()
    if not args.app.is_file() or not args.tests.is_file():
        raise RuntimeError("Both APK files must exist")
    app_sha = sha(args.app)
    if app_sha != APP_SHA:
        raise RuntimeError("APK SHA-256 mismatch: expected exactly the approved v2.6.10 artifact")
    serial = choose_serial(args.serial)
    abi = property_of(serial, "ro.product.cpu.abilist")
    hw = property_of(serial, "ro.hardware")
    kernel_qemu = property_of(serial, "ro.kernel.qemu")
    boot_qemu = property_of(serial, "ro.boot.qemu")
    fingerprint = property_of(serial, "ro.build.fingerprint")
    flags = (hw + " " + fingerprint + " " + property_of(serial, "ro.build.characteristics")).lower()
    if ("arm64-v8a" not in abi.split(",") or kernel_qemu == "1" or boot_qemu == "1"
            or re.search(r"goldfish|ranchu|cuttlefish|sdk_gphone|generic|emulator|vbox|qemu", flags)):
        raise RuntimeError("Not a verifiable physical ARM64 target (ADB properties)")
    args.out.mkdir(parents=True, exist_ok=True)
    wifi_before = setting(serial, "wifi_on")
    mobile_before = setting(serial, "mobile_data")
    record = {
        "schema_version": 1, "source": "live_adb_capture",
        "app_sha256": app_sha, "test_apk_sha256": sha(args.tests),
        "device": {"abi": abi, "hardware": hw, "kernel_qemu": kernel_qemu,
                   "boot_qemu": boot_qemu, "android_release": property_of(serial, "ro.build.version.release"),
                   "model": property_of(serial, "ro.product.model")},
        "offline": {}, "runs": {}, "measurements": {},
        "limitations": ["No full top20 on phone without local catalog",
                        "First run is not a clean-data-install test",
                        "ADB properties are not cryptographic hardware attestation"]
    }
    try:
        # Do not clear data: installation with an incompatible signature must fail safely.
        device_command(serial, "install", "-r", str(args.app), timeout=180)
        device_command(serial, "install", "-r", str(args.tests), timeout=180)
        device_command(serial, "shell", "svc", "wifi", "disable")
        device_command(serial, "shell", "svc", "data", "disable")
        time.sleep(2)
        wifi_off = setting(serial, "wifi_on")
        mobile_off = setting(serial, "mobile_data")
        record["offline"] = {"wifi_on": wifi_off, "mobile_data": mobile_off}
        if wifi_off != "0" or mobile_off not in ("0", "null"):
            raise RuntimeError("Could not verify Wi-Fi/mobile data disabled")
        for label in ("first", "second"):
            device_command(serial, "logcat", "-c")
            start = time.monotonic()
            command_output = device_command(
                serial, "shell", "am", "instrument", "-w", "-r",
                "-e", "class", TEST_CLASS, TEST_RUNNER, timeout=300)
            elapsed = round((time.monotonic() - start) * 1000)
            logcat = device_command(serial, "logcat", "-d", "-s", "E5_CANARY_QA:I", "*:S")
            save(args.out, "instrumentation-" + label + ".log", command_output)
            save(args.out, "canary-" + label + ".log", logcat)
            record["runs"][label] = {"instrumentation_elapsed_ms": elapsed}
            if ("OK (1 test)" not in command_output
                    or "INSTRUMENTATION_STATUS_CODE: 0" not in command_output
                    or "FAILURES!!!" in command_output):
                raise RuntimeError("Physical Android instrumentation failed on " + label)
            if "cosine=" not in logcat:
                raise RuntimeError("Missing actual ONNX canary evidence on " + label)
        device_command(serial, "shell", "am", "force-stop", PACKAGE)
        cold = device_command(serial, "shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        save(args.out, "startup-cold.log", cold)
        memory = device_command(serial, "shell", "dumpsys", "meminfo", PACKAGE)
        save(args.out, "memory.log", memory)
        device_command(serial, "shell", "input", "keyevent", "KEYCODE_HOME")
        warm = device_command(serial, "shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        save(args.out, "startup-warm.log", warm)
        record["measurements"]["network_restored_after_run"] = True
        save(args.out, "evidence.json", json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    finally:
        if wifi_before == "1":
            device_command(serial, "shell", "svc", "wifi", "enable")
        if mobile_before == "1":
            device_command(serial, "shell", "svc", "data", "enable")
    # Run the independent reviewer in a separate interpreter/process.
    result = subprocess.run([sys.executable, str(Path(__file__).with_name("qa_arm64_evidence_agent.py")),
                             "--evidence", str(args.out / "evidence.json"),
                             "--app", str(args.app), "--tests", str(args.tests)],
                            check=False)
    if result.returncode:
        raise RuntimeError("Independent physical evidence agent rejected the capture")
    print("Physical ARM64 evidence APPROVED by independent agent. No lyrics/serial saved.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ARM64 physical QA NOT APPROVED: " + str(exc), file=sys.stderr)
        sys.exit(1)
