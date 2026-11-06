from django.db import models


class Guest(models.Model):
    guest_id = models.AutoField(primary_key=True)
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50)
    email = models.CharField(max_length=100, unique=True)
    phone = models.CharField(max_length=20)

    class Meta:
        managed = False
        db_table = 'guest'


class RoomType(models.Model):
    room_type_id = models.AutoField(primary_key=True)
    type_name = models.CharField(max_length=50, unique=True)
    capacity = models.IntegerField()
    price_per_night = models.DecimalField(max_digits=8, decimal_places=2)
    description = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'room_type'


class Room(models.Model):
    room_id = models.AutoField(primary_key=True)
    room_number = models.CharField(max_length=10, unique=True)
    floor = models.IntegerField()
    status = models.CharField(max_length=15, default='Available')
    room_type = models.ForeignKey(RoomType, db_column='room_type_id', on_delete=models.PROTECT)

    class Meta:
        managed = False
        db_table = 'room'


class Booking(models.Model):
    booking_id = models.AutoField(primary_key=True)
    guest = models.ForeignKey(Guest, db_column='guest_id', on_delete=models.PROTECT)
    booking_date = models.DateTimeField()
    check_in = models.DateField()
    check_out = models.DateField()
    status = models.CharField(max_length=15, default='Confirmed')

    class Meta:
        managed = False
        db_table = 'booking'


class BookingRoom(models.Model):
    booking_room_id = models.AutoField(primary_key=True)
    booking = models.ForeignKey(Booking, db_column='booking_id', on_delete=models.PROTECT, related_name='bookingroom')
    room = models.ForeignKey(Room, db_column='room_id', on_delete=models.PROTECT)
    guests_count = models.IntegerField()
    price_per_night = models.DecimalField(max_digits=8, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'booking_room'


class Payment(models.Model):
    payment_id = models.AutoField(primary_key=True)
    booking = models.ForeignKey(Booking, db_column='booking_id', on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=15)
    payment_status = models.CharField(max_length=10)
    payment_date = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'payment'
