-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  FIX: business rules inside the database
--
--  Author   : 24B032036 (Tester / Backend)
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  Why: testing/database-tests.sql found 3 rules that the database did
--  NOT protect. A wrong program (or a bug in the backend) could save:
--     DB-25  the same room twice for overlapping dates   (rule BR-1)
--     DB-26  more guests than the room type capacity     (rule BR-2)
--     DB-27  a new booking whose check-in is in the past (rule BR-3)
--
--  The Django backend already checks these rules in frontend_api.py.
--  This file makes the DATABASE refuse them too, as a last safety net
--  (another program, a bug, or a manual INSERT cannot break them).
--  After it, testing/database-tests.sql gives 27 PASS out of 27.
--
--  Run order for the website:
--     02_normalized_schema.sql -> 04_add_guest_role.sql
--     -> 05_business_rules.sql (this file)
--     -> python manage.py seed_demo -> python manage.py seed_roles
--  (Existing database: just run this file once.)
--
--  Safe to run many times (everything is dropped and created again).
-- =====================================================================

USE hotel_booking;


-- ---------------------------------------------------------------------
--  Rule BR-3 (DB-27): a stay cannot start before the day it was booked.
--  booking_date is filled automatically with the current time, so for a
--  new booking this means "check-in cannot be in the past".
--  Old bookings (booked in October for December) still pass the rule.
--  A CHECK constraint is enough because it only compares two columns
--  of the same row.
-- ---------------------------------------------------------------------
SET @drop_chk = (
    SELECT IF(COUNT(*) > 0,
              'ALTER TABLE booking DROP CHECK chk_booking_not_in_past',
              'DO 0')
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'hotel_booking'
      AND TABLE_NAME = 'booking'
      AND CONSTRAINT_NAME = 'chk_booking_not_in_past');
PREPARE s FROM @drop_chk; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE booking
  ADD CONSTRAINT chk_booking_not_in_past CHECK (check_in >= DATE(booking_date));


-- ---------------------------------------------------------------------
--  Rules BR-1 (DB-25) and BR-2 (DB-26) need data from OTHER rows and
--  other tables, so a CHECK constraint cannot do it. A TRIGGER can:
--  it runs automatically BEFORE every INSERT or UPDATE and refuses the
--  row with SIGNAL (an error), so nothing is saved.
-- ---------------------------------------------------------------------

DROP TRIGGER   IF EXISTS trg_booking_room_before_insert;
DROP TRIGGER   IF EXISTS trg_booking_room_before_update;
DROP TRIGGER   IF EXISTS trg_booking_before_update;
DROP PROCEDURE IF EXISTS check_room_line;

DELIMITER $$

-- One procedure with both checks, used by the two booking_room triggers
CREATE PROCEDURE check_room_line(IN p_booking_id INT, IN p_room_id INT, IN p_guests INT)
BEGIN
    DECLARE v_capacity INT;
    DECLARE v_conflicts INT;

    -- BR-2: guests in the room <= capacity of its room type
    SELECT rt.capacity INTO v_capacity
    FROM   room r
    JOIN   room_type rt ON rt.room_type_id = r.room_type_id
    WHERE  r.room_id = p_room_id;

    IF p_guests > v_capacity THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BR-2: more guests than the capacity of this room type';
    END IF;

    -- BR-1: if this booking is active, no OTHER active booking may have
    -- the same room on overlapping dates.
    -- Two stays overlap when: other.check_in < this.check_out
    --                     AND other.check_out > this.check_in
    SELECT COUNT(*) INTO v_conflicts
    FROM   booking this_b
    JOIN   booking_room br ON br.room_id = p_room_id
                          AND br.booking_id <> this_b.booking_id
    JOIN   booking other  ON other.booking_id = br.booking_id
    WHERE  this_b.booking_id = p_booking_id
      AND  this_b.status IN ('Confirmed', 'CheckedIn')
      AND  other.status  IN ('Confirmed', 'CheckedIn')
      AND  other.check_in  < this_b.check_out
      AND  other.check_out > this_b.check_in;

    IF v_conflicts > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BR-1: this room is already booked for overlapping dates';
    END IF;
END$$

-- A room is added to a booking
CREATE TRIGGER trg_booking_room_before_insert
BEFORE INSERT ON booking_room
FOR EACH ROW
BEGIN
    CALL check_room_line(NEW.booking_id, NEW.room_id, NEW.guests_count);
END$$

-- A room line is changed (other room, other guest count)
CREATE TRIGGER trg_booking_room_before_update
BEFORE UPDATE ON booking_room
FOR EACH ROW
BEGIN
    CALL check_room_line(NEW.booking_id, NEW.room_id, NEW.guests_count);
END$$

-- A booking changes its dates, or a cancelled booking becomes active again:
-- its rooms must still be free for the new dates (BR-1)
CREATE TRIGGER trg_booking_before_update
BEFORE UPDATE ON booking
FOR EACH ROW
BEGIN
    DECLARE v_conflicts INT;

    IF NEW.status IN ('Confirmed', 'CheckedIn')
       AND (NEW.check_in <> OLD.check_in
            OR NEW.check_out <> OLD.check_out
            OR OLD.status NOT IN ('Confirmed', 'CheckedIn')) THEN

        SELECT COUNT(*) INTO v_conflicts
        FROM   booking_room mine
        JOIN   booking_room br ON br.room_id = mine.room_id
                              AND br.booking_id <> mine.booking_id
        JOIN   booking other  ON other.booking_id = br.booking_id
        WHERE  mine.booking_id = NEW.booking_id
          AND  other.status IN ('Confirmed', 'CheckedIn')
          AND  other.check_in  < NEW.check_out
          AND  other.check_out > NEW.check_in;

        IF v_conflicts > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'BR-1: a room of this booking is already booked for these dates';
        END IF;
    END IF;
END$$

DELIMITER ;

-- The backend also locks the rooms (select_for_update in frontend_api.py),
-- so two people pressing "Confirm" at the same second cannot both win.

-- Show what was added
SELECT TRIGGER_NAME, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS on_table
FROM   information_schema.TRIGGERS
WHERE  TRIGGER_SCHEMA = 'hotel_booking'
ORDER BY TRIGGER_NAME;
