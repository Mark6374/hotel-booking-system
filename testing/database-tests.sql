-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  DATABASE TESTS (27 tests, DB-01 ... DB-27)
--
--  Tester   : 24B032036 (Tester / Backend)
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  Run order (tests use the migrated data of Dmitry's scripts):
--     1. 01_unnormalized_schema.sql              (repo wwsqpor/Hotel-Booking-System)
--     2. backend/db/02_normalized_schema.sql
--     3. 03_migrate_unnormalized_to_normalized.sql (repo wwsqpor/Hotel-Booking-System)
--     4. backend/db/04_add_guest_role.sql
--     5. backend/db/05_business_rules.sql        (without it DB-25..27 FAIL)
--     6. testing/database-tests.sql              <- this file
--
--  What it does:
--     PART A  checks that the migrated data is correct (SELECT only)
--     PART B  tries to save BAD data. The database must REFUSE it.
--     PART C  business rules BR-1..BR-3 (double booking, capacity,
--             check-in in the past). Protected by 05_business_rules.sql.
--
--  Safe to run many times: every write is inside a transaction that is
--  rolled back, so the real data is never changed.
--
--  Result: one table with  test_id | title | expected | actual | status
-- =====================================================================

USE hotel_booking;

DROP TEMPORARY TABLE IF EXISTS test_result;
CREATE TEMPORARY TABLE test_result (
    test_id   VARCHAR(10)  NOT NULL,
    title     VARCHAR(120) NOT NULL,
    expected  VARCHAR(120) NOT NULL,
    actual    VARCHAR(255) NOT NULL,
    status    VARCHAR(4)   NOT NULL,
    PRIMARY KEY (test_id)
);


-- ---------------------------------------------------------------------
--  Helper procedure for PART B and PART C.
--  It runs one SQL statement inside a transaction, remembers whether the
--  database gave an error, and then ROLLBACKs so nothing is saved.
--    must_fail = 1 : PASS if the database refused the statement
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS expect_rejected;
DELIMITER $$
CREATE PROCEDURE expect_rejected(IN p_id VARCHAR(10), IN p_title VARCHAR(120), IN p_sql TEXT)
BEGIN
    DECLARE v_error BOOLEAN DEFAULT FALSE;
    DECLARE v_msg   VARCHAR(255) DEFAULT 'accepted - the bad row was saved';

    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT;
        SET v_error = TRUE;
    END;

    START TRANSACTION;
        SET @stmt = p_sql;
        PREPARE s FROM @stmt;
        EXECUTE s;
        DEALLOCATE PREPARE s;
    ROLLBACK;

    INSERT INTO test_result VALUES
        (p_id, p_title, 'refused with an error', LEFT(v_msg, 255),
         IF(v_error, 'PASS', 'FAIL'));
END$$
DELIMITER ;


-- =====================================================================
--  PART A. The migrated data is correct
-- =====================================================================

-- DB-01  Every table got the expected number of rows
INSERT INTO test_result
SELECT 'DB-01', 'Row counts after migration',
       'guest 3, room_type 3, room 6, booking 6, booking_room 7, payment 7',
       CONCAT('guest ', (SELECT COUNT(*) FROM guest),
              ', room_type ', (SELECT COUNT(*) FROM room_type),
              ', room ', (SELECT COUNT(*) FROM room),
              ', booking ', (SELECT COUNT(*) FROM booking),
              ', booking_room ', (SELECT COUNT(*) FROM booking_room),
              ', payment ', (SELECT COUNT(*) FROM payment)),
       IF((SELECT COUNT(*) FROM guest) = 3 AND (SELECT COUNT(*) FROM room_type) = 3
          AND (SELECT COUNT(*) FROM room) = 6 AND (SELECT COUNT(*) FROM booking) = 6
          AND (SELECT COUNT(*) FROM booking_room) = 7 AND (SELECT COUNT(*) FROM payment) = 7,
          'PASS', 'FAIL');

-- DB-02  The old stored total_price equals the new calculated total
INSERT INTO test_result
SELECT 'DB-02', 'Old total_price = calculated total (view v_booking_total)',
       '0 bookings with a different total',
       CONCAT(COUNT(*), ' bookings with a different total'),
       IF(COUNT(*) = 0, 'PASS', 'FAIL')
FROM   hotel_unnormalized.UNF_booking_flat f
LEFT JOIN v_booking_total v ON v.booking_id = f.booking_id
WHERE  v.total_price IS NULL OR f.total_price <> v.total_price;

-- DB-03  The guest who had two phone numbers now has one (the newest)
INSERT INTO test_result
SELECT 'DB-03', 'Amina has one phone number, from her newest booking',
       '1 row, phone +7 700 111 2233',
       CONCAT(COUNT(*), ' row(s), phone ', COALESCE(MAX(phone), 'none')),
       IF(COUNT(*) = 1 AND MAX(phone) = '+7 700 111 2233', 'PASS', 'FAIL')
FROM   guest
WHERE  email = 'amina@example.com';

-- DB-04  The full name was split into first and last name (1NF)
INSERT INTO test_result
SELECT 'DB-04', 'Name split into first_name and last_name',
       '0 names with a space inside, Amina / Sadykova',
       CONCAT(SUM(first_name LIKE '% %' OR last_name LIKE '% %'), ' with a space; guest 1 = ',
              MAX(IF(email = 'amina@example.com', CONCAT(first_name, ' / ', last_name), NULL))),
       IF(SUM(first_name LIKE '% %' OR last_name LIKE '% %') = 0
          AND MAX(IF(email = 'amina@example.com', CONCAT(first_name, '/', last_name), NULL)) = 'Amina/Sadykova',
          'PASS', 'FAIL')
FROM   guest;

-- DB-05  The list '102;103' became two rows in the bridge table
INSERT INTO test_result
SELECT 'DB-05', 'Booking 6 has two room rows: 102 and 103',
       '102,103',
       COALESCE(GROUP_CONCAT(r.room_number ORDER BY r.room_number), 'none'),
       IF(GROUP_CONCAT(r.room_number ORDER BY r.room_number) = '102,103', 'PASS', 'FAIL')
FROM   booking_room br
JOIN   room r ON r.room_id = br.room_id
WHERE  br.booking_id = 6;

-- DB-06  The repeating payment columns became two payment rows
INSERT INTO test_result
SELECT 'DB-06', 'Booking 6 has two payments: Failed then Paid',
       'Failed,Paid',
       COALESCE(GROUP_CONCAT(payment_status ORDER BY payment_date), 'none'),
       IF(GROUP_CONCAT(payment_status ORDER BY payment_date) = 'Failed,Paid', 'PASS', 'FAIL')
FROM   payment
WHERE  booking_id = 6;

-- DB-07  Every booking has at least one room
INSERT INTO test_result
SELECT 'DB-07', 'Every booking has at least one room',
       '0 bookings without a room',
       CONCAT(COUNT(*), ' bookings without a room'),
       IF(COUNT(*) = 0, 'PASS', 'FAIL')
FROM   booking b
WHERE  NOT EXISTS (SELECT 1 FROM booking_room br WHERE br.booking_id = b.booking_id);

-- DB-08  The price of a room type is stored only once (3NF)
INSERT INTO test_result
SELECT 'DB-08', 'Standard price stored once, used by 3 rooms',
       '1 room_type row, 3 rooms',
       CONCAT((SELECT COUNT(*) FROM room_type WHERE type_name = 'Standard'), ' room_type row, ',
              (SELECT COUNT(*) FROM room r JOIN room_type t ON t.room_type_id = r.room_type_id
               WHERE t.type_name = 'Standard'), ' rooms'),
       IF((SELECT COUNT(*) FROM room_type WHERE type_name = 'Standard') = 1
          AND (SELECT COUNT(*) FROM room r JOIN room_type t ON t.room_type_id = r.room_type_id
               WHERE t.type_name = 'Standard') = 3, 'PASS', 'FAIL');

-- DB-09  Availability search for 10-13 Dec 2026 (the main user process)
INSERT INTO test_result
SELECT 'DB-09', 'Free rooms 10-13 Dec 2026',
       'Deluxe 0, Standard 2, Suite 1',
       GROUP_CONCAT(CONCAT(type_name, ' ', available_rooms) ORDER BY type_name SEPARATOR ', '),
       IF(GROUP_CONCAT(CONCAT(type_name, ' ', available_rooms) ORDER BY type_name SEPARATOR ', ')
          = 'Deluxe 0, Standard 2, Suite 1', 'PASS', 'FAIL')
FROM (
    SELECT rt.type_name, COUNT(r.room_id) AS available_rooms
    FROM   room_type rt
    LEFT JOIN room r
           ON  r.room_type_id = rt.room_type_id
           AND r.status = 'Available'
           AND r.room_id NOT IN (
                 SELECT br.room_id
                 FROM   booking_room br
                 JOIN   booking b ON b.booking_id = br.booking_id
                 WHERE  b.status IN ('Confirmed', 'CheckedIn')
                   AND  b.check_in  < '2026-12-13'
                   AND  b.check_out > '2026-12-10')
    GROUP BY rt.room_type_id, rt.type_name
) a;


-- =====================================================================
--  PART B. Bad data must be refused (CHECK, UNIQUE, FOREIGN KEY)
-- =====================================================================

CALL expect_rejected('DB-10', 'Check-out before check-in',
  "INSERT INTO booking (guest_id, check_in, check_out, status) VALUES (1, '2026-12-20', '2026-12-18', 'Confirmed')");

CALL expect_rejected('DB-11', 'Zero nights (check-out = check-in)',
  "INSERT INTO booking (guest_id, check_in, check_out, status) VALUES (1, '2026-12-20', '2026-12-20', 'Confirmed')");

CALL expect_rejected('DB-12', 'Unknown booking status',
  "INSERT INTO booking (guest_id, check_in, check_out, status) VALUES (1, '2026-12-20', '2026-12-22', 'Waiting')");

CALL expect_rejected('DB-13', 'Booking for a guest that does not exist',
  "INSERT INTO booking (guest_id, check_in, check_out, status) VALUES (999, '2026-12-20', '2026-12-22', 'Confirmed')");

CALL expect_rejected('DB-14', 'Same email again, in capital letters',
  "INSERT INTO guest (first_name, last_name, email, phone) VALUES ('Test', 'User', 'SALTANAT@GMAIL.COM', '+7 700 000 0000')");

CALL expect_rejected('DB-15', 'Email without @',
  "INSERT INTO guest (first_name, last_name, email, phone) VALUES ('Test', 'User', 'test.example.com', '+7 700 000 0000')");

CALL expect_rejected('DB-16', 'Empty first name (only spaces)',
  "INSERT INTO guest (first_name, last_name, email, phone) VALUES ('   ', 'User', 'empty@example.com', '+7 700 000 0000')");

CALL expect_rejected('DB-17', 'Room type with price 0',
  "INSERT INTO room_type (type_name, capacity, price_per_night) VALUES ('Free room', 2, 0)");

CALL expect_rejected('DB-18', 'Room status that is not allowed',
  "UPDATE room SET status = 'Dirty' WHERE room_number = '101'");

CALL expect_rejected('DB-19', 'Unknown payment method',
  "INSERT INTO payment (booking_id, amount, payment_method, payment_status) VALUES (1, 100, 'Bitcoin', 'Paid')");

CALL expect_rejected('DB-20', 'Negative payment amount',
  "INSERT INTO payment (booking_id, amount, payment_method, payment_status) VALUES (1, -50, 'Card', 'Paid')");

CALL expect_rejected('DB-21', 'Same room twice in one booking',
  "INSERT INTO booking_room (booking_id, room_id, guests_count, price_per_night) VALUES (1, 1, 1, 60)");

CALL expect_rejected('DB-22', 'Zero guests in a room',
  "INSERT INTO booking_room (booking_id, room_id, guests_count, price_per_night) VALUES (1, 2, 0, 60)");

CALL expect_rejected('DB-23', 'Delete a guest who has bookings',
  "DELETE FROM guest WHERE email = 'saltanat@gmail.com'");

CALL expect_rejected('DB-24', 'Delete a room type that still has rooms',
  "DELETE FROM room_type WHERE type_name = 'Standard'");


-- =====================================================================
--  PART C. Business rules inside the database (BR-1..BR-3)
--  The backend checks them too (frontend_api.py), but the database must
--  refuse them even if a program forgets. Without
--  backend/db/05_business_rules.sql these three tests FAIL.
-- =====================================================================

-- Room 101 (room_id 1) is already booked 9-12 Dec 2026 by booking 1 (Amina).
-- Booking 5 (Daniel, 10-13 Dec) gets the same room: a double booking.
CALL expect_rejected('DB-25', 'Double booking: room 101 also given to booking 5',
  "INSERT INTO booking_room (booking_id, room_id, guests_count, price_per_night) VALUES (5, 1, 1, 60)");

-- A Standard room sleeps 2 people (room_type.capacity = 2)
CALL expect_rejected('DB-26', '5 guests in a Standard room (capacity 2)',
  "INSERT INTO booking_room (booking_id, room_id, guests_count, price_per_night) VALUES (2, 2, 5, 60)");

CALL expect_rejected('DB-27', 'New booking with check-in in the past (2020)',
  "INSERT INTO booking (guest_id, check_in, check_out, status) VALUES (1, '2020-01-01', '2020-01-03', 'Confirmed')");


-- =====================================================================
--  RESULT
-- =====================================================================
SELECT test_id, title, expected, actual, status
FROM   test_result
ORDER BY CAST(SUBSTRING(test_id, 4) AS UNSIGNED);

SELECT SUM(status = 'PASS') AS passed,
       SUM(status = 'FAIL') AS failed,
       COUNT(*)             AS total
FROM   test_result;

DROP PROCEDURE IF EXISTS expect_rejected;
