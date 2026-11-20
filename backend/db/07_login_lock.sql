-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  Login protection (lock after 5 wrong passwords)
--
--  Author   : 24B032036 (Tester / Backend), week 12
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  One row per account that typed a wrong password.
--   failed_count   wrong passwords in a row (0..4)
--   locked_until   end of the 15-minute lock, NULL = not locked
--  Kept in its own table (like guest_role), so `guest` does not change.
--  Deleting a guest deletes its row (ON DELETE CASCADE).
--
--  Run order: 02 -> 04 -> 05 -> 06 -> 07 (this file)
--  Safe to run many times (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

USE hotel_booking;

CREATE TABLE IF NOT EXISTS login_lock (
    guest_id        INT       NOT NULL,
    failed_count    INT       NOT NULL DEFAULT 0,
    locked_until    DATETIME  NULL,
    last_failed_at  DATETIME  NULL,

    PRIMARY KEY (guest_id),
    CONSTRAINT chk_login_lock_count CHECK (failed_count BETWEEN 0 AND 5),
    CONSTRAINT fk_login_lock_guest  FOREIGN KEY (guest_id) REFERENCES guest (guest_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Wrong-password counter and 15-minute lock per account.';
