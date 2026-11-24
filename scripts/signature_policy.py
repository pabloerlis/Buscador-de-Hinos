"""Policy for APK updates to the original 2.6.1 distribution line."""
import re

REFERENCE_CERT_SHA256 = "cf07bce9b5f581a50beb7817e390d0393b46cc2dc771bf54df4cc03537c0c511"


def inspect_signature(output, returncode):
    """Require successful verification and exactly one current signer."""
    digests = re.findall(r"^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$", output, re.M)
    certs = [digest.lower() for digest in digests]
    verified = returncode == 0 and len(certs) == 1
    return {"verified": verified, "certificate_sha256": certs[0] if verified else None,
            "reference_certificate_sha256": REFERENCE_CERT_SHA256,
            "update_certificate_matches": verified and certs[0] == REFERENCE_CERT_SHA256}
