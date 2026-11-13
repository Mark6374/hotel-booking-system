-- Run this ONLY if you already created the database from an older
-- 02_normalized_schema.sql (without the guest.password column).
-- Fresh installs get the column from 02_normalized_schema.sql.
USE hotel_booking;

ALTER TABLE guest
    ADD COLUMN password VARCHAR(128) NULL
    COMMENT 'Django password hash (never plain text). NULL = guest has no website account.'
    AFTER phone;
