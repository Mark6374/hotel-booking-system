-- =====================================================================
--  HOTEL BOOKING SYSTEM  -  Chat between a customer and the admin
--
--  Database : hotel_booking (MySQL 8.0.16 or newer)
--
--  Design (3NF, same style as the other tables)
--   * chat_conversation: ONE conversation per customer (UNIQUE guest_id).
--     It is created when the customer writes the first message. All admins
--     share the same conversation, so a customer always sees one history.
--   * chat_message: every message ever sent, oldest = smallest message_id.
--     sender_id is the guest account that wrote it: the customer
--     (sender_id = the conversation's guest_id) or the admin who answered.
--     "From the customer?" is therefore derived and never stored twice.
--   * read_at: NULL = not read yet. Customer messages are read by an admin,
--     admin messages are read by the customer.
--   * Messages are never deleted by the application. Deleting a guest row
--     removes its conversation and messages (ON DELETE CASCADE).
--
--  Run order: 02 -> 04 -> 05 -> 06 -> 07 -> 08 -> 09 (this file)
--  Safe to run many times (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

USE hotel_booking;

CREATE TABLE IF NOT EXISTS chat_conversation (
    conversation_id  INT       NOT NULL AUTO_INCREMENT,
    guest_id         INT       NOT NULL,
    created_at       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (conversation_id),
    CONSTRAINT uq_chat_conversation_guest UNIQUE (guest_id),
    CONSTRAINT fk_chat_conversation_guest FOREIGN KEY (guest_id) REFERENCES guest (guest_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='One support conversation per customer.';

CREATE TABLE IF NOT EXISTS chat_message (
    message_id       INT            NOT NULL AUTO_INCREMENT,
    conversation_id  INT            NOT NULL,
    sender_id        INT            NOT NULL,
    body             VARCHAR(2000)  NOT NULL,
    created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at          DATETIME       NULL,

    PRIMARY KEY (message_id),
    CONSTRAINT chk_chat_message_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 2000),
    CONSTRAINT fk_chat_message_conversation FOREIGN KEY (conversation_id)
        REFERENCES chat_conversation (conversation_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_chat_message_sender FOREIGN KEY (sender_id) REFERENCES guest (guest_id)
        ON UPDATE CASCADE ON DELETE CASCADE,

    -- history of one conversation (newest first / "after id X"), and its unread count
    INDEX idx_chat_message_conv (conversation_id, message_id),
    INDEX idx_chat_message_unread (conversation_id, read_at)
) ENGINE=InnoDB COMMENT='Every chat message. Normalized (3NF).';
