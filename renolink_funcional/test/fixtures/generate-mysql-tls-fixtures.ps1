param(
    [Parameter(Mandatory = $true)]
    [string]$OpenSsl,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'mysql-tls')
)

$ErrorActionPreference = 'Stop'
$OpenSsl = [IO.Path]::GetFullPath($OpenSsl)
if (-not (Test-Path -LiteralPath $OpenSsl -PathType Leaf)) {
    throw 'OpenSSL executable was not found.'
}

$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw 'Output directory must already exist.'
}

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('renolink-mysql-tls-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $tempDirectory 'newcerts') | Out-Null
New-Item -ItemType File -Path (Join-Path $tempDirectory 'index.txt') | Out-Null
[IO.File]::WriteAllText((Join-Path $tempDirectory 'serial'), '1000')

function Write-AsciiLines([string]$Path, [string[]]$Lines) {
    [IO.File]::WriteAllLines($Path, $Lines, [Text.Encoding]::ASCII)
}

function Invoke-OpenSsl([string[]]$Arguments) {
    & $OpenSsl @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "OpenSSL failed: $($Arguments[0])"
    }
}

try {
    $caKey = Join-Path $tempDirectory 'synthetic-ca.key.pem'
    $caCert = Join-Path $tempDirectory 'ca.pem'
    Invoke-OpenSsl @('genpkey', '-quiet', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', $caKey)
    Invoke-OpenSsl @(
        'req', '-x509', '-new', '-key', $caKey, '-sha256', '-days', '3650',
        '-out', $caCert, '-subj', '/CN=RenoLink Synthetic TLS Test CA',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', 'subjectKeyIdentifier=hash'
    )
    Copy-Item -LiteralPath $caCert -Destination (Join-Path $OutputDirectory 'ca.pem')
    $caConfig = Join-Path $tempDirectory 'ca.cnf'
    $tempUnix = $tempDirectory.Replace('\', '/')
    $caCertUnix = $caCert.Replace('\', '/')
    $caKeyUnix = $caKey.Replace('\', '/')
    Write-AsciiLines $caConfig @(
        '[ca]', 'default_ca=CA_default', '[CA_default]',
        "dir=$tempUnix", 'database=$dir/index.txt', 'new_certs_dir=$dir/newcerts',
        "certificate=$caCertUnix", "private_key=$caKeyUnix", 'serial=$dir/serial',
        'default_md=sha256', 'policy=policy_any', 'unique_subject=no',
        '[policy_any]', 'commonName=supplied'
    )

    $variants = @(
        @{ Name = 'valid'; CommonName = '127.0.0.1'; San = 'IP:127.0.0.1'; Expired = $false },
        @{ Name = 'wrong-ip'; CommonName = '127.0.0.1'; San = 'IP:127.0.0.2'; Expired = $false },
        @{ Name = 'no-ip-san'; CommonName = '127.0.0.1'; San = 'DNS:127.0.0.1'; Expired = $false },
        @{ Name = 'expired'; CommonName = '127.0.0.1'; San = 'IP:127.0.0.1'; Expired = $true }
    )

    foreach ($variant in $variants) {
        $key = Join-Path $OutputDirectory ($variant.Name + '.key.pem')
        $csr = Join-Path $tempDirectory ($variant.Name + '.csr.pem')
        $cert = Join-Path $OutputDirectory ($variant.Name + '.cert.pem')
        $reqConfig = Join-Path $tempDirectory ($variant.Name + '.req.cnf')
        $extConfig = Join-Path $tempDirectory ($variant.Name + '.ext.cnf')

        Write-AsciiLines $reqConfig @(
            '[req]', 'distinguished_name=dn', 'prompt=no', 'req_extensions=v3_req',
            '[dn]', "CN=$($variant.CommonName)", '[v3_req]', "subjectAltName=$($variant.San)"
        )
        Invoke-OpenSsl @('genpkey', '-quiet', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', $key)
        Invoke-OpenSsl @('req', '-new', '-key', $key, '-out', $csr, '-config', $reqConfig)

        Write-AsciiLines $extConfig @(
            '[server_cert]', 'basicConstraints=critical,CA:FALSE',
            'keyUsage=critical,digitalSignature,keyEncipherment',
            'extendedKeyUsage=serverAuth', "subjectAltName=$($variant.San)",
            'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer'
        )

        if ($variant.Expired) {
            $startDate = '20190101000000Z'
            $endDate = '20200101000000Z'
        } else {
            $startDate = '20200101000000Z'
            $endDate = '20360101000000Z'
        }
        Invoke-OpenSsl @(
            'ca', '-batch', '-notext', '-config', $caConfig, '-in', $csr, '-out', $cert,
            '-startdate', $startDate, '-enddate', $endDate,
            '-extfile', $extConfig, '-extensions', 'server_cert'
        )
    }

    $untrustedCaKey = Join-Path $tempDirectory 'untrusted-ca.key.pem'
    $untrustedCaCert = Join-Path $OutputDirectory 'untrusted-ca.pem'
    $untrustedDirectory = Join-Path $tempDirectory 'untrusted-ca'
    New-Item -ItemType Directory -Path (Join-Path $untrustedDirectory 'newcerts') | Out-Null
    New-Item -ItemType File -Path (Join-Path $untrustedDirectory 'index.txt') | Out-Null
    [IO.File]::WriteAllText((Join-Path $untrustedDirectory 'serial'), '2000')
    Invoke-OpenSsl @('genpkey', '-quiet', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', $untrustedCaKey)
    Invoke-OpenSsl @(
        'req', '-x509', '-new', '-key', $untrustedCaKey, '-sha256', '-days', '3650',
        '-out', $untrustedCaCert, '-subj', '/CN=RenoLink Untrusted Synthetic CA',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', 'subjectKeyIdentifier=hash'
    )
    $untrustedCaConfig = Join-Path $tempDirectory 'untrusted-ca.cnf'
    $untrustedDirectoryUnix = $untrustedDirectory.Replace('\', '/')
    $untrustedCaCertUnix = $untrustedCaCert.Replace('\', '/')
    $untrustedCaKeyUnix = $untrustedCaKey.Replace('\', '/')
    Write-AsciiLines $untrustedCaConfig @(
        '[ca]', 'default_ca=CA_default', '[CA_default]',
        "dir=$untrustedDirectoryUnix", 'database=$dir/index.txt', 'new_certs_dir=$dir/newcerts',
        "certificate=$untrustedCaCertUnix", "private_key=$untrustedCaKeyUnix",
        'serial=$dir/serial', 'default_md=sha256', 'policy=policy_any',
        'unique_subject=no', '[policy_any]', 'commonName=supplied'
    )
    $untrustedKey = Join-Path $OutputDirectory 'untrusted.key.pem'
    $untrustedCsr = Join-Path $tempDirectory 'untrusted.csr.pem'
    $untrustedCert = Join-Path $OutputDirectory 'untrusted.cert.pem'
    $untrustedReqConfig = Join-Path $tempDirectory 'untrusted.req.cnf'
    $untrustedExtConfig = Join-Path $tempDirectory 'untrusted.ext.cnf'
    Write-AsciiLines $untrustedReqConfig @(
        '[req]', 'distinguished_name=dn', 'prompt=no', 'req_extensions=v3_req',
        '[dn]', 'CN=127.0.0.1', '[v3_req]', 'subjectAltName=IP:127.0.0.1'
    )
    Write-AsciiLines $untrustedExtConfig @(
        '[server_cert]', 'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth', 'subjectAltName=IP:127.0.0.1',
        'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer'
    )
    Invoke-OpenSsl @('genpkey', '-quiet', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', $untrustedKey)
    Invoke-OpenSsl @('req', '-new', '-key', $untrustedKey, '-out', $untrustedCsr, '-config', $untrustedReqConfig)
    Invoke-OpenSsl @(
        'ca', '-batch', '-notext', '-config', $untrustedCaConfig, '-in', $untrustedCsr,
        '-out', $untrustedCert, '-startdate', '20200101000000Z',
        '-enddate', '20360101000000Z', '-extfile', $untrustedExtConfig,
        '-extensions', 'server_cert'
    )
} finally {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force
}
