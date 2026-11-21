#!/usr/bin/env python3
"""Independent physical ARM64 evidence agent.
Only reviews live log files + APK bytes; synthetic selftests do not count as a
physical-device approval. Saves its decision without any hymn lyrics or serial.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile

APP_SHA = "329a6195d3582a945a47894cc5e4e432e589bb41ba8bf4bfe785bdd49baa7fed"
CANARY = re.compile(r"cosine=([0-9.]+), max_q8_delta=(\d+), changed_components=(\d+)/384")
PSS = re.compile(r"TOTAL PSS:\s*(\d+)|^\s*TOTAL\s+(\d+)\s", re.M)
TIME = re.compile(r"TotalTime:\s*(\d+)")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def inspect(data, folder, app, tests, expected_sha=APP_SHA):
    errors = []
    def check(ok, message):
        if not ok:
            errors.append(message)
    def read(name):
        path = folder / name
        if not path.is_file():
            errors.append("Missing raw log: " + name)
            return ""
        return path.read_text(encoding="utf-8")
    check(data.get("schema_version") == 1 and data.get("source") == "live_adb_capture",
          "Invalid source/schema")
    actual_app = digest(app)
    actual_tests = digest(tests)
    check(actual_app == expected_sha and data.get("app_sha256") == actual_app,
          "APK SHA mismatch")
    check(data.get("test_apk_sha256") == actual_tests and bool(actual_tests),
          "Instrumentation APK mismatch")
    device = data.get("device") or {}
    check("arm64-v8a" in device.get("abi", "").split(","), "ARM64 ABI not observed")
    check(device.get("kernel_qemu", "") != "1" and device.get("boot_qemu", "") != "1",
          "Emulator detected")
    check(not re.search(r"goldfish|ranchu|cuttlefish|sdk_gphone|generic|emulator|vbox|qemu",
                        device.get("hardware", "").lower()), "Emulated hardware")
    offline = data.get("offline") or {}
    check(offline.get("wifi_on") == "0" and offline.get("mobile_data") in ("0", "null"),
          "Offline status not verified")
    performance = {}
    for label in ("first", "second"):
        log = read("instrumentation-" + label + ".log")
        canary = read("canary-" + label + ".log")
        check("OK (1 test)" in log and "INSTRUMENTATION_STATUS_CODE: 0" in log
              and "FAILURES!!!" not in log and "INSTRUMENTATION_STATUS_CODE: -2" not in log,
              "Android real instrumentation failed: " + label)
        hits = CANARY.findall(canary)
        check(len(hits) == 1, "Expected exactly one logged 384D ONNX canary: " + label)
        if len(hits) == 1:
            cosine, delta, changed = map(float, hits[0])
            check(cosine >= 0.992 and cosine <= 1.000001 and delta <= 3 and changed <= 154,
                  "ONNX vector parity failed: " + label)
            performance[label + "_cosine"] = cosine
            performance[label + "_q8_max_delta"] = int(delta)
        elapsed = (data.get("runs") or {}).get(label, {}).get("instrumentation_elapsed_ms")
        check(isinstance(elapsed, int) and 0 < elapsed < 600000,
              "Invalid end-to-end instrumentation duration: " + label)
        performance[label + "_instrumentation_ms"] = elapsed
    for label in ("cold", "warm"):
        text = read("startup-" + label + ".log")
        times = TIME.findall(text)
        check(len(times) == 1, "Startup TotalTime missing: " + label)
        if times:
            n = int(times[0])
            check(0 <= n < 120000, "Invalid startup duration: " + label)
            performance[label + "_startup_ms"] = n
    mem = read("memory.log")
    matches = PSS.findall(mem)
    check(bool(matches), "Android TOTAL PSS memory measurement missing")
    if matches:
        pss = int(next(v for v in matches[-1] if v))
        check(pss > 0, "Nonpositive memory usage")
        performance["pss_kb"] = pss
    check((data.get("measurements") or {}).get("network_restored_after_run") is True,
          "Network restore plan missing")
    return {"schema_version": 1, "agent": "11-arm64-physical-evidence",
            "decision": "approved" if not errors else "rejected",
            "app_sha256": actual_app, "performance": performance,
            "errors": errors,
            "scope": "ADB physical ARM64 E5 canary, offline, startup and PSS; not top20/50 human judgments",
            "hardware_attestation": "ADB properties only; no cryptographic attestation"}


def selftest():
    # Mocked evidence here tests the agent's rejection logic, NOT a phone.
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        app, tests = folder / "app.apk", folder / "test.apk"
        app.write_bytes(b"fake-app-for-agent-selftest")
        tests.write_bytes(b"fake-instrumentation-for-agent-selftest")
        data = {"schema_version": 1, "source": "live_adb_capture",
                "app_sha256": digest(app), "test_apk_sha256": digest(tests),
                "device": {"abi": "arm64-v8a,armeabi-v7a", "hardware": "test-chip",
                           "kernel_qemu": "0", "boot_qemu": "0"},
                "offline": {"wifi_on": "0", "mobile_data": "0"},
                "runs": {"first": {"instrumentation_elapsed_ms": 28000},
                         "second": {"instrumentation_elapsed_ms": 8000}},
                "measurements": {"network_restored_after_run": True}}
        for label in ("first", "second"):
            (folder / ("instrumentation-" + label + ".log")).write_text(
                "INSTRUMENTATION_STATUS_CODE: 0\nOK (1 test)\n")
            (folder / ("canary-" + label + ".log")).write_text(
                "I E5_CANARY_QA: cosine=0.997, max_q8_delta=2, changed_components=83/384\n")
        (folder / "startup-cold.log").write_text("TotalTime: 812\n")
        (folder / "startup-warm.log").write_text("TotalTime: 138\n")
        (folder / "memory.log").write_text("TOTAL PSS: 125000\n")
        def result(d):
            return inspect(d, folder, app, tests, expected_sha=digest(app))["decision"]
        assert result(data) == "approved", "Positive fixture"
        import copy
        modifications = [
            lambda d: d["device"].update(hardware="ranchu"),
            lambda d: d.update(app_sha256="0" * 64),
            lambda d: d["offline"].update(wifi_on="1"),
            lambda d: d["runs"]["first"].update(instrumentation_elapsed_ms=0),
            lambda d: d["device"].update(abi="x86_64"),
            lambda d: d["measurements"].update(network_restored_after_run=False),
        ]
        for i, modification in enumerate(modifications, 1):
            mutant = copy.deepcopy(data)
            modification(mutant)
            assert result(mutant) == "rejected", "Negative fixture " + str(i)
        path = folder / "canary-second.log"
        original = path.read_text()
        path.write_text(original.replace("cosine=0.997", "cosine=0.5"))
        assert result(data) == "rejected", "Negative fixture 7"
        path.write_text(original)
    print("AGENT 11 SELFTEST: 1 positive + 7 negative fixtures PASS; no device tested")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--app", type=Path)
    parser.add_argument("--tests", type=Path)
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    if not args.evidence or not args.app or not args.tests:
        parser.error("--evidence, --app and --tests are required")
    data = json.loads(args.evidence.read_text(encoding="utf-8"))
    verdict = inspect(data, args.evidence.parent, args.app, args.tests)
    (args.evidence.parent / "independent-agent-11.json").write_text(
        json.dumps(verdict, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("AGENT 11: " + verdict["decision"].upper() + " (" + str(len(verdict["errors"])) + " errors)")
    if verdict["errors"]:
        for e in verdict["errors"]:
            print(" - " + e)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
