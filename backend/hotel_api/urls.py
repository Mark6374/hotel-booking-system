from django.urls import include, path

urlpatterns = [
    path('api/', include('booking.urls')),
    path('api/', include('booking.frontend_urls')),  # write endpoints for the React frontend
]
