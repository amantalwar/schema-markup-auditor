<?php
/**
 * Server-side fetch proxy for the Schema Markup & E-E-A-T Auditor.
 * Fetches a target URL's HTML so the browser-side JS can parse it
 * without hitting CORS restrictions. Includes basic SSRF protections
 * since this endpoint is public.
 */

header('Content-Type: application/json; charset=utf-8');

// Only allow this to be called from your own site.
$allowedOrigins = [
    'https://amantalwar.com',
    'https://www.amantalwar.com',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
}
header('Access-Control-Allow-Methods: GET');

function fail(string $message, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

$url = $_GET['url'] ?? '';
if ($url === '') {
    fail('Missing "url" parameter.');
}

// Basic URL validation
$parts = parse_url($url);
if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
    fail('Invalid URL.');
}
if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
    fail('Only http/https URLs are allowed.');
}

// SSRF protection: resolve host and block private/reserved IP ranges.
$host = $parts['host'];
$ips = [];
$recordsA = @dns_get_record($host, DNS_A);
$recordsAAAA = @dns_get_record($host, DNS_AAAA);
foreach (array_merge($recordsA ?: [], $recordsAAAA ?: []) as $rec) {
    if (!empty($rec['ip'])) $ips[] = $rec['ip'];
    if (!empty($rec['ipv6'])) $ips[] = $rec['ipv6'];
}
if (empty($ips)) {
    // Fall back to gethostbyname (IPv4 only) if DNS functions are restricted.
    $resolved = @gethostbyname($host);
    if ($resolved && $resolved !== $host) $ips[] = $resolved;
}
if (empty($ips)) {
    fail('Could not resolve host.');
}
foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        fail('This host resolves to a private or reserved IP address and cannot be fetched.', 403);
    }
}

// Fetch with cURL, with strict limits.
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; SchemaMarkupAuditor/1.0; +https://amantalwar.com/schema-markup)',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_ENCODING => '', // accept gzip/deflate automatically
    CURLOPT_HEADER => false,
]);

// Abort early if the response is unexpectedly large (cap at 5MB).
$maxBytes = 5 * 1024 * 1024;
$downloaded = 0;
curl_setopt($ch, CURLOPT_NOPROGRESS, false);
curl_setopt($ch, CURLOPT_PROGRESSFUNCTION, function ($resource, $downloadSize, $downloaded_) use ($maxBytes) {
    return $downloaded_ > $maxBytes ? 1 : 0;
});

$html = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
$err = curl_error($ch);
curl_close($ch);

if ($html === false) {
    fail('Fetch failed: ' . $err, 502);
}
if ($contentType && stripos($contentType, 'text/html') === false && stripos($contentType, 'application/xhtml') === false) {
    fail('The URL did not return an HTML page (content-type: ' . $contentType . ').', 415);
}

echo json_encode([
    'html' => $html,
    'status' => $httpCode,
    'finalUrl' => $finalUrl,
]);
