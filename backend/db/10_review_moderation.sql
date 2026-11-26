-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  Review moderation (week 13)
--
--  A new review is 'Pending' and is NOT shown on the website until an
--  admin approves it ('Published') or rejects it ('Hidden').
--  Existing reviews keep their status (they were already published).
--
--  Run order: ... 06_room_reviews.sql -> ... -> 10 (this file)
--  Safe to run many times. Works on MySQL 8.0.19+ and MariaDB 10.2+.
-- =====================================================================

USE hotel_booking;

-- allow the new status: drop the old CHECK (Published, Hidden) if it is there ...
SET @drop_chk = (
    SELECT IF(COUNT(*) > 0, 'ALTER TABLE room_review DROP CONSTRAINT chk_review_status', 'DO 0')
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'hotel_booking'
      AND TABLE_NAME = 'room_review'
      AND CONSTRAINT_NAME = 'chk_review_status');
PREPARE s FROM @drop_chk; EXECUTE s; DEALLOCATE PREPARE s;

-- ... and add it again with 'Pending'; new rows start as 'Pending'
ALTER TABLE room_review
  ADD CONSTRAINT chk_review_status CHECK (status IN ('Pending', 'Published', 'Hidden')),
  ALTER COLUMN status SET DEFAULT 'Pending';

SELECT status, COUNT(*) AS reviews FROM room_review GROUP BY status;
