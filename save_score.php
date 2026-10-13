<?php
/* =====================================================================
 * save_score.php — Simpan hasil pertandingan online + hitung ELO
 * POST JSON: {winner, loser, winner_char, loser_char}
 * Hanya client host (P1) yang melapor, agar tidak tercatat ganda.
 * ===================================================================== */
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['ok' => false, 'error' => 'POST only'], 405);

$in = json_decode(file_get_contents('php://input'), true) ?: $_POST;
$winner = clean_name($in['winner'] ?? '');
$loser  = clean_name($in['loser'] ?? '');
$wc = preg_replace('/[^a-z0-9]/', '', (string)($in['winner_char'] ?? ''));
$lc = preg_replace('/[^a-z0-9]/', '', (string)($in['loser_char'] ?? ''));
if ($winner === '' || $loser === '' || strcasecmp($winner, $loser) === 0) json_out(['ok' => false, 'error' => 'Nama tidak valid'], 400);

try {
    $pdo = db();
    // Anti-spam sederhana: maks 1 laporan / 20 detik per IP
    $ip = sha1(($_SERVER['REMOTE_ADDR'] ?? '') . 'kombat');
    $q = $pdo->prepare('SELECT COUNT(*) FROM matches WHERE ip_hash = ? AND played_at > (NOW() - INTERVAL 20 SECOND)');
    $q->execute([$ip]);
    if ($q->fetchColumn() > 0) json_out(['ok' => false, 'error' => 'Terlalu cepat'], 429);

    $pdo->beginTransaction();
    $ins = $pdo->prepare('INSERT IGNORE INTO players (username, elo) VALUES (?, ?)');
    $ins->execute([$winner, ELO_START]);
    $ins->execute([$loser, ELO_START]);

    $get = $pdo->prepare('SELECT * FROM players WHERE username = ? FOR UPDATE');
    $get->execute([$winner]); $w = $get->fetch();
    $get->execute([$loser]);  $l = $get->fetch();

    // ELO: peluang menang = 1 / (1 + 10^((Rb - Ra)/400))
    $expW = 1 / (1 + pow(10, ($l['elo'] - $w['elo']) / 400));
    $delta = max(1, (int)round(ELO_K * (1 - $expW)));

    $pdo->prepare('UPDATE players SET elo = elo + ?, wins = wins + 1, streak = streak + 1, best_streak = GREATEST(best_streak, streak + 1) WHERE id = ?')
        ->execute([$delta, $w['id']]);
    $pdo->prepare('UPDATE players SET elo = GREATEST(0, elo - ?), losses = losses + 1, streak = 0 WHERE id = ?')
        ->execute([$delta, $l['id']]);
    $pdo->prepare('INSERT INTO matches (winner, loser, winner_char, loser_char, elo_change, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$winner, $loser, $wc, $lc, $delta, $ip]);
    $pdo->commit();

    json_out(['ok' => true, 'delta' => $delta, 'winner_elo' => $w['elo'] + $delta, 'loser_elo' => max(0, $l['elo'] - $delta)]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    json_out(['ok' => false, 'error' => 'Database error'], 500);
}
