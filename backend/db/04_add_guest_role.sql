-- Roles for website accounts (added for the React frontend).
-- One optional row per guest. No row = an ordinary active guest.
--   role      : guest | staff | admin
--   is_active : 0 = account blocked by an admin (cannot use the site)
-- Safe to run on an existing database; does not touch other tables.
USE hotel_booking;

CREATE TABLE IF NOT EXISTS guest_role (
    guest_id   INT          NOT NULL,
    role       VARCHAR(10)  NOT NULL DEFAULT 'guest',
    is_active  TINYINT(1)   NOT NULL DEFAULT 1,

    PRIMARY KEY (guest_id),
    CONSTRAINT chk_guest_role  CHECK (role IN ('guest', 'staff', 'admin')),
    CONSTRAINT fk_role_guest   FOREIGN KEY (guest_id) REFERENCES guest (guest_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Website role of a guest account (frontend staff/admin pages).';
