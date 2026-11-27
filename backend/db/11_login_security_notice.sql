-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  "Someone tried to log in" notice (week 13)
--
--  Author   : 24B032036 (Tester / Backend)
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--  Needs    : 07_login_lock.sql (table login_lock)
--
--  Two new columns in login_lock. They remember the wrong passwords since
--  the owner's last successful login, so that after the next login she
--  sees a notice: "5 wrong passwords, last at 14:05, the account was
--  locked. If it was not you, change your password."
--   unseen_failed   wrong passwords since the last successful login
--   last_locked_at  when the account was last locked (NULL = not locked)
--  (last_failed_at already exists: time of the last wrong password)
--
--  Run order: ... 07 -> 08 -> 09 -> 10 -> 11 (this file)
--  Safe to run many times: a column is added only when it is missing.
-- =====================================================================

USE hotel_booking;

SET @sql = (SELECT IF(COUNT(*) = 0,
    'ALTER TABLE login_lock ADD COLUMN unseen_failed INT NOT NULL DEFAULT 0 COMMENT ''wrong passwords since the last successful login''',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'hotel_booking' AND TABLE_NAME = 'login_lock' AND COLUMN_NAME = 'unseen_failed');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = (SELECT IF(COUNT(*) = 0,
    'ALTER TABLE login_lock ADD COLUMN last_locked_at DATETIME NULL COMMENT ''when the account was last locked''',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'hotel_booking' AND TABLE_NAME = 'login_lock' AND COLUMN_NAME = 'last_locked_at');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SHOW COLUMNS FROM login_lock;
