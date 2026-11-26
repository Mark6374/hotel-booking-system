-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  Profile photos
--
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  One optional row per guest account = the account has a profile photo.
--  Kept in its own table (like guest_role and login_lock), so `guest`
--  does not change.
--
--   file_name   random name of the image file in MEDIA_ROOT/avatars/
--               (32 hex characters + .jpg). The name is random on purpose:
--               every upload gets a new name, so browsers can cache the
--               photo for ever and the address cannot be guessed.
--   updated_at  last time the owner added or changed the photo
--
--  The image itself is stored as a file, not in the database
--  (the backend re-encodes every upload to a 512 x 512 JPEG).
--
--  Run order: 02 -> 04 -> 05 -> 06 -> 07 -> 08 (this file) -> 09
--  Safe to run many times (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

USE hotel_booking;

CREATE TABLE IF NOT EXISTS guest_photo (
    guest_id    INT          NOT NULL,
    file_name   VARCHAR(40)  NOT NULL,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (guest_id),
    CONSTRAINT uq_guest_photo_file  UNIQUE (file_name),
    CONSTRAINT fk_guest_photo_guest FOREIGN KEY (guest_id) REFERENCES guest (guest_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Optional profile photo of a guest account (file name in MEDIA_ROOT/avatars).';
