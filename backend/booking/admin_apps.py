from django.contrib.admin.apps import AdminConfig


class HotelAdminConfig(AdminConfig):
    """Makes `admin.site` our HotelAdminSite (booking/admin_site.py). Needs no other change."""
    default_site = 'booking.admin_site.HotelAdminSite'
