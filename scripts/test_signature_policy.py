import unittest
from signature_policy import inspect_signature, REFERENCE_CERT_SHA256

class SignaturePolicyTest(unittest.TestCase):
    def test_reference(self):
        self.assertTrue(inspect_signature('Signer #1 certificate SHA-256 digest: '+REFERENCE_CERT_SHA256.upper(), 0)['update_certificate_matches'])
    def test_mismatch(self):
        report = inspect_signature('Signer #1 certificate SHA-256 digest: '+'a'*64, 0)
        self.assertTrue(report['verified'])
        self.assertFalse(report['update_certificate_matches'])
    def test_failed_verify(self):
        self.assertFalse(inspect_signature('Signer #1 certificate SHA-256 digest: '+REFERENCE_CERT_SHA256, 1)['verified'])
    def test_missing_or_malformed(self):
        for value in ('', 'Signer #1 certificate SHA-256 digest: abc'):
            self.assertFalse(inspect_signature(value, 0)['verified'])
    def test_multiple_signers(self):
        self.assertFalse(inspect_signature('Signer #1 certificate SHA-256 digest: '+REFERENCE_CERT_SHA256+'\nSigner #2 certificate SHA-256 digest: '+'a'*64, 0)['verified'])

if __name__ == '__main__':
    unittest.main()
