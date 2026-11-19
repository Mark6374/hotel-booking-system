from django.core.management.base import BaseCommand

from booking.models import Guest
from booking.roles import GuestRole

# Demo hotel employees. Guests from seed_demo keep the password demo12345.
STAFF = [
    {'email': 'admin@junipercourt.example', 'first_name': 'Mark', 'last_name': 'Yeriskin',
     'phone': '+7 700 000 0001', 'role': 'admin', 'password': 'Admin12345'},
    {'email': 'staff@junipercourt.example', 'first_name': 'Dmitriy', 'last_name': 'Cherepkov',
     'phone': '+7 700 000 0002', 'role': 'staff', 'password': 'Staff12345'},
]


class Command(BaseCommand):
    help = 'Creates the demo admin and staff accounts (run after seed_demo and db/04_add_guest_role.sql).'

    def handle(self, *args, **options):
        # seed_demo truncates guest, which can leave role rows pointing nowhere.
        GuestRole.objects.exclude(guest_id__in=Guest.objects.values('guest_id')).delete()
        for row in STAFF:
            g = Guest.objects.filter(email__iexact=row['email']).first() or Guest(email=row['email'])
            g.first_name, g.last_name, g.phone = row['first_name'], row['last_name'], row['phone']
            g.set_password(row['password'])
            g.save()
            GuestRole.objects.update_or_create(guest_id=g.guest_id, defaults={'role': row['role'], 'is_active': True})
        self.stdout.write(self.style.SUCCESS(
            'Staff accounts ready: ' + ', '.join('%s / %s (%s)' % (r['email'], r['password'], r['role']) for r in STAFF)))
