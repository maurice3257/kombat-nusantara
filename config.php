<?php
/* =====================================================================
 * config.php — Kredensial MySQL InfinityFree
 * Isi dari: Control Panel InfinityFree → MySQL Databases
 * (host biasanya sqlXXX.infinityfree.com, BUKAN localhost)
 * ===================================================================== */
define('DB_HOST', 'sql123.infinityfree.com');
define('DB_NAME', 'if0_00000000_kombat');
define('DB_USER', 'if0_00000000');
define('DB_PASS', 'PASSWORD_VPANEL_KAMU');

define('ELO_START', 1000);
define('ELO_K', 50);          // K=50 → pertandingan seimbang = ±25 poin

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function json_out($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

function clean_name($s) {
    $s = preg_replace('/[^\w\- .]/u', '', (string)$s);
    return mb_substr(trim($s), 0, 16);
}
