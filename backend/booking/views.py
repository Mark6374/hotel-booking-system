from django.contrib.auth.hashers import check_password
from django.db import IntegrityError
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .auth import make_token

from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .roles import role_info
from .serializers import (
    BookingRoomSerializer,
    BookingSerializer,
    GuestSerializer,
    LoginSerializer,
    RegisterSerializer,
    PaymentSerializer,
    RoomSerializer,
    RoomTypeSerializer,
)


def _viewer(request):
    """(logged-in guest or None, is staff/admin). Blocked accounts count as visitors."""
    user = request.user
    if not isinstance(user, Guest):
        return None, False
    role, active = role_info(user)
    if not active:
        return None, False
    return user, role in ('staff', 'admin')


class GuestListView(generics.ListAPIView):
    """Personal data (name, email, phone): staff and admin see every guest,
    a guest sees only herself, a visitor without login sees nobody."""
    serializer_class = GuestSerializer

    def get_queryset(self):
        user, staff = _viewer(self.request)
        if staff:
            return Guest.objects.all()
        if user:
            return Guest.objects.filter(pk=user.pk)
        return Guest.objects.none()


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
    """Payments: staff and admin see all, a guest sees only her own, a visitor none."""
    serializer_class = PaymentSerializer

    def get_queryset(self):
        user, staff = _viewer(self.request)
        if staff:
            return Payment.objects.all()
        if user:
            return Payment.objects.filter(booking__guest_id=user.pk)
        return Payment.objects.none()


# A hash of a throwaway password, checked when the email is unknown so that
# login takes about the same time either way (avoids account enumeration).
_DUMMY_HASH = 'pbkdf2_sha256$1000000$dummy$' + 'x' * 43


class AuthRateThrottle(AnonRateThrottle):
    scope = 'auth'


def _auth_payload(guest):
    return {'token': make_token(guest), 'guest': GuestSerializer(guest).data}


class RegisterView(APIView):
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            guest = serializer.save()
        except IntegrityError:  # two requests registering the same email at once
            return Response({'email': ['An account with this email already exists.']},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(_auth_payload(guest), status=status.HTTP_201_CREATED)


class LoginView(APIView):
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email'].strip().lower()
        password = serializer.validated_data['password']

        guest = Guest.objects.filter(email__iexact=email).first()
        if guest is None or not guest.password:
            check_password(password, _DUMMY_HASH)
            ok = False
        else:
            ok = guest.check_password(password)
        if not ok:
            return Response({'detail': 'Invalid email or password.'},
                            status=status.HTTP_401_UNAUTHORIZED)
        return Response(_auth_payload(guest))


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(GuestSerializer(request.user).data)
