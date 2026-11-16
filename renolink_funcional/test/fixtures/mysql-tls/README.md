# Synthetic MySQL TLS fixtures

These certificates and unencrypted private keys are test-only, synthetic
artifacts. They are not associated with the RenoLink Feira CA, a real server,
or any credential. The CA private key is deliberately not retained.

`generate-mysql-tls-fixtures.ps1` can regenerate the fixtures with a locally
approved OpenSSL executable; pass its path explicitly. Tests consume the
checked-in fixtures and do not need OpenSSL.

| Pair | Purpose |
|---|---|
| `valid.cert.pem` / `valid.key.pem` | Trusted chain and IP SAN `127.0.0.1`. |
| `wrong-ip.cert.pem` / `wrong-ip.key.pem` | Trusted chain but IP SAN `127.0.0.2`. |
| `no-ip-san.cert.pem` / `no-ip-san.key.pem` | Trusted chain with only a DNS SAN; CN is `127.0.0.1`. |
| `expired.cert.pem` / `expired.key.pem` | Trusted chain and matching SAN, but expired leaf certificate. |
| `untrusted.cert.pem` / `untrusted.key.pem` | Matching SAN issued by `untrusted-ca.pem`, which is not the trusted CA. |

Regenerate only with test fixtures; never substitute real certificates or keys.
