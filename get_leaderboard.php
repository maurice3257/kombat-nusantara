<?php
/* =====================================================================
 * get_leaderboard.php — Top 10 pemain berdasarkan ELO
 * GET → {ok, players:[{username, elo, wins, losses, streak}]}
 * ===================================================================== */
require __DIR__ . '/config.php';

try {
    $rows = db()->query('SELECT username, elo, wins, losses, streak, best_streak FROM players ORDER BY elo DESC, wins DESC LIMIT 10')->fetchAll();
    foreach ($rows as &$r) foreach (['elo', 'wins', 'losses', 'streak', 'best_streak'] as $k) $r[$k] = (int)$r[$k];
    json_out(['ok' => true, 'players' => $rows]);
} catch (Throwable $e) {
    json_out(['ok' => false, 'error' => 'Database error'], 500);
}
