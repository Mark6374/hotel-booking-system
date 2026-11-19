-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  Room ratings and comments (reviews)
--
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  One review = one rating (1-5 stars) and an optional comment that a
--  guest writes about ONE room of ONE finished stay.
--
--  Design (3NF, same style as the other tables):
--   * room_review points to booking_room (the "room inside a booking"
--     bridge row). From it we always know the room, the booking and the
--     guest, so none of them is stored twice and they can never disagree.
--   * UNIQUE (booking_room_id): one review per room per stay. A guest who
--     stays in the same room twice can review it twice (two stays).
--   * The backend only lets a guest review a room after the booking is
--     'Completed' (verified stay: no fake reviews).
--   * updated_at changes only when the author edits the review (not when a
--     moderator hides it), so created_at <> updated_at means "edited".
--   * status 'Hidden' = removed from the website by a moderator. The row
--     stays (audit), so it is a soft delete.
--
--  Run order: 02 -> 04 -> 05 -> 06 (this file) -> python manage.py migrate
--  Safe to run many times (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

USE hotel_booking;

CREATE TABLE IF NOT EXISTS room_review (
    review_id        INT           NOT NULL AUTO_INCREMENT,
    booking_room_id  INT           NOT NULL,
    rating           TINYINT       NOT NULL,
    comment          VARCHAR(1000) NOT NULL DEFAULT '',
    status           VARCHAR(10)   NOT NULL DEFAULT 'Published',
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- last time the AUTHOR edited it

    PRIMARY KEY (review_id),
    CONSTRAINT uq_review_booking_room  UNIQUE (booking_room_id),
    CONSTRAINT chk_review_rating       CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT chk_review_status       CHECK (status IN ('Published', 'Hidden')),
    CONSTRAINT fk_review_booking_room  FOREIGN KEY (booking_room_id) REFERENCES booking_room (booking_room_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    -- the public list of a room is "Published, newest first"; the moderation queue is the same
    INDEX idx_review_status_created (status, created_at)
) ENGINE=InnoDB COMMENT='Normalized (3NF). One rating + comment per room per finished stay.';
