-- =====================================================================
-- schema.sql — Jalankan sekali di phpMyAdmin InfinityFree
-- =====================================================================
CREATE TABLE IF NOT EXISTS players (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(16) NOT NULL UNIQUE,
    elo         INT NOT NULL DEFAULT 1000,
    wins        INT NOT NULL DEFAULT 0,
    losses      INT NOT NULL DEFAULT 0,
    streak      INT NOT NULL DEFAULT 0,
    best_streak INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_elo (elo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matches (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    winner      VARCHAR(16) NOT NULL,
    loser       VARCHAR(16) NOT NULL,
    winner_char VARCHAR(16),
    loser_char  VARCHAR(16),
    elo_change  INT NOT NULL,
    ip_hash     CHAR(40),
    played_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_time (played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
