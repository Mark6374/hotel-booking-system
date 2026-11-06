from rest_framework import generics

from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .serializers import (
    BookingRoomSerializer,
    BookingSerializer,
    GuestSerializer,
    PaymentSerializer,
    RoomSerializer,
    RoomTypeSerializer,
)


class GuestListView(generics.ListAPIView):
    queryset = Guest.objects.all()
    serializer_class = GuestSerializer


class RoomTypeListView(generics.ListAPIView):
    queryset = RoomType.objects.all()
    serializer_class = RoomTypeSerializer


class RoomListView(generics.ListAPIView):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer


class BookingListView(generics.ListAPIView):
    queryset = Booking.objects.all()
    serializer_class = BookingSerializer


class BookingRoomListView(generics.ListAPIView):
    queryset = BookingRoom.objects.all()
    serializer_class = BookingRoomSerializer


class PaymentListView(generics.ListAPIView):
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
