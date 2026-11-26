from django.core.management.base import BaseCommand
from django.db import connection

from booking.models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from booking.reviews import RoomReview

DEMO_PASSWORD = 'demo12345'  # all demo guests can log in with this

GUESTS = [
    {'guest_id': 1, 'first_name': 'Saltanat', 'last_name': 'Sultanakhmet', 'email': 'saltanat@gmail.com', 'phone': '+7 700 111 2233'},
    {'guest_id': 2, 'first_name': 'Daniel', 'last_name': 'Brooks', 'email': 'daniel@example.com', 'phone': '+44 20 7946 0101'},
    {'guest_id': 3, 'first_name': 'Mei', 'last_name': 'Tanaka', 'email': 'mei@example.com', 'phone': '+81 3 5550 0123'},
]

ROOM_TYPES = [
    {'room_type_id': 1, 'type_name': 'Standard', 'capacity': 2, 'price_per_night': 60, 'description': 'Queen bed, quiet courtyard view, 24 m².'},
    {'room_type_id': 2, 'type_name': 'Deluxe', 'capacity': 3, 'price_per_night': 90, 'description': 'King bed, city view, work desk and rain shower, 32 m².'},
    {'room_type_id': 3, 'type_name': 'Suite', 'capacity': 4, 'price_per_night': 150, 'description': 'Bedroom and separate lounge with corner windows, 55 m².'},
]

ROOMS = [
    {'room_id': 1, 'room_number': '101', 'floor': 1, 'status': 'Available', 'room_type_id': 1},
    {'room_id': 2, 'room_number': '102', 'floor': 1, 'status': 'Available', 'room_type_id': 1},
    {'room_id': 3, 'room_number': '103', 'floor': 1, 'status': 'Available', 'room_type_id': 1},
    {'room_id': 4, 'room_number': '201', 'floor': 2, 'status': 'Available', 'room_type_id': 2},
    {'room_id': 5, 'room_number': '202', 'floor': 2, 'status': 'Available', 'room_type_id': 2},
    {'room_id': 6, 'room_number': '301', 'floor': 3, 'status': 'Available', 'room_type_id': 3},
]

BOOKINGS = [
    {'booking_id': 1, 'guest_id': 1, 'booking_date': '2026-10-02 09:15', 'check_in': '2026-12-09', 'check_out': '2026-12-12', 'status': 'Confirmed'},
    {'booking_id': 2, 'guest_id': 2, 'booking_date': '2026-10-05 14:40', 'check_in': '2026-12-11', 'check_out': '2026-12-14', 'status': 'Confirmed'},
    {'booking_id': 3, 'guest_id': 1, 'booking_date': '2026-09-10 11:05', 'check_in': '2026-12-01', 'check_out': '2026-12-05', 'status': 'Completed'},
    {'booking_id': 4, 'guest_id': 3, 'booking_date': '2026-10-07 18:22', 'check_in': '2026-12-10', 'check_out': '2026-12-13', 'status': 'Cancelled'},
    {'booking_id': 5, 'guest_id': 2, 'booking_date': '2026-10-08 10:00', 'check_in': '2026-12-10', 'check_out': '2026-12-13', 'status': 'Confirmed'},
]

BOOKING_ROOMS = [
    {'booking_room_id': 1, 'booking_id': 1, 'room_id': 1, 'guests_count': 2, 'price_per_night': 60},
    {'booking_room_id': 2, 'booking_id': 2, 'room_id': 4, 'guests_count': 2, 'price_per_night': 90},
    {'booking_room_id': 3, 'booking_id': 3, 'room_id': 2, 'guests_count': 1, 'price_per_night': 60},
    {'booking_room_id': 4, 'booking_id': 4, 'room_id': 3, 'guests_count': 2, 'price_per_night': 60},
    {'booking_room_id': 5, 'booking_id': 5, 'room_id': 5, 'guests_count': 3, 'price_per_night': 90},
]

PAYMENTS = [
    {'payment_id': 1, 'booking_id': 1, 'amount': 180, 'payment_method': 'Card', 'payment_status': 'Paid', 'payment_date': '2026-10-02 09:16'},
    {'payment_id': 2, 'booking_id': 2, 'amount': 270, 'payment_method': 'Card', 'payment_status': 'Paid', 'payment_date': '2026-10-05 14:41'},
    {'payment_id': 3, 'booking_id': 3, 'amount': 240, 'payment_method': 'Cash', 'payment_status': 'Paid', 'payment_date': '2026-09-10 11:06'},
    {'payment_id': 4, 'booking_id': 4, 'amount': 180, 'payment_method': 'Card', 'payment_status': 'Refunded', 'payment_date': '2026-10-07 18:23'},
    {'payment_id': 5, 'booking_id': 5, 'amount': 270, 'payment_method': 'Transfer', 'payment_status': 'Paid', 'payment_date': '2026-10-08 10:02'},
]


class Command(BaseCommand):
    help = 'Wipes and re-inserts the same demo rows the frontend prototype used to seed itself with.'

    def handle(self, *args, **options):
        with connection.cursor() as cur:
            cur.execute('SET FOREIGN_KEY_CHECKS=0')
            existing = connection.introspection.table_names(cur)
            for table in ('chat_message', 'chat_conversation', 'guest_photo', 'login_lock', 'room_review', 'payment',
                          'booking_room', 'booking', 'room', 'room_type', 'guest'):
                if table in existing:      # the optional tables exist only after db/06, 07, 08 and 09
                    cur.execute(f'TRUNCATE TABLE {table}')
            cur.execute('SET FOREIGN_KEY_CHECKS=1')

        guests = [Guest(**row) for row in GUESTS]
        for g in guests:
            g.set_password(DEMO_PASSWORD)
        Guest.objects.bulk_create(guests)
        RoomType.objects.bulk_create([RoomType(**row) for row in ROOM_TYPES])
        Room.objects.bulk_create([
            Room(room_id=r['room_id'], room_number=r['room_number'], floor=r['floor'], status=r['status'], room_type_id=r['room_type_id'])
            for r in ROOMS
        ])
        Booking.objects.bulk_create([
            Booking(booking_id=b['booking_id'], guest_id=b['guest_id'], booking_date=b['booking_date'], check_in=b['check_in'], check_out=b['check_out'], status=b['status'])
            for b in BOOKINGS
        ])
        BookingRoom.objects.bulk_create([
            BookingRoom(booking_room_id=l['booking_room_id'], booking_id=l['booking_id'], room_id=l['room_id'], guests_count=l['guests_count'], price_per_night=l['price_per_night'])
            for l in BOOKING_ROOMS
        ])
        Payment.objects.bulk_create([
            Payment(payment_id=p['payment_id'], booking_id=p['booking_id'], amount=p['amount'], payment_method=p['payment_method'], payment_status=p['payment_status'], payment_date=p['payment_date'])
            for p in PAYMENTS
        ])

        # One review on the only finished stay (booking 3: Saltanat in room 102). The other rooms can be
        # reviewed after a staff member checks the booking in and out.
        if 'room_review' in connection.introspection.table_names():
            RoomReview.objects.create(
                booking_room_id=3, rating=5, status='Published',
                comment='Quiet courtyard, spotless room and very friendly front desk. Would stay again.')

        self.stdout.write(self.style.SUCCESS('Seeded 3 guests (password: ' + DEMO_PASSWORD + '), 3 room types, 6 rooms, 5 bookings, 5 booking_room lines, 5 payments.'))
