import re

from rest_framework import serializers

from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType

# A phone number: optional + at the start, then 6-20 characters of digits,
# spaces, ( ) and -, and AT LEAST 6 digits. "((((((" or "abc" are refused.
PHONE_RE = re.compile(r'^\+?(?=(?:\D*\d){6})[\d\s()-]{6,20}$')
PHONE_MESSAGE = 'Enter at least 6 digits. Spaces, ( ) - and a + at the start are allowed.'


def clean_phone(value):
    """Used by register, profile and booking, so every way in checks the phone the same way."""
    value = (value or '').strip()
    if not PHONE_RE.match(value):
        raise serializers.ValidationError(PHONE_MESSAGE)
    return value


class GuestSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guest
        exclude = ('password',)  # never expose the password hash


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = '__all__'


class RoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = Room
        fields = '__all__'


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = '__all__'


class BookingRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingRoom
        fields = '__all__'


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = '__all__'


class RegisterSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50)
    last_name = serializers.CharField(max_length=50)
    email = serializers.EmailField(max_length=100)
    phone = serializers.CharField(max_length=20)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        value = value.strip().lower()
        if Guest.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate_phone(self, value):
        return clean_phone(value)

    def validate_password(self, value):
        if value.isdigit():
            raise serializers.ValidationError('Password cannot be only digits.')
        return value

    def create(self, validated_data):
        guest = Guest(**{k: v for k, v in validated_data.items() if k != 'password'})
        guest.set_password(validated_data['password'])
        guest.save()
        return guest


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
