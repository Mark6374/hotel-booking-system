from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),        # staff admin panel (ADMIN.md)
    path('api/', include('booking.urls')),
    path('api/', include('booking.frontend_urls')),  # write endpoints for the React frontend
    path('api/', include('booking.reviews_urls')),   # room ratings and comments
    path('api/', include('booking.photos_urls')),    # profile photos (PHOTOS_AND_CHAT_API.md)
    path('api/', include('booking.chat_urls')),      # chat customer <-> admin (REST part; the socket is ws/chat/)
]
