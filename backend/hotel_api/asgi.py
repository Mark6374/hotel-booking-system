"""ASGI entry point: normal HTTP (the whole REST API and the admin) plus the chat WebSocket.

Development:  python manage.py runserver        (the `daphne` app in INSTALLED_APPS makes it ASGI)
Production:   daphne -b 0.0.0.0 -p 8000 hotel_api.asgi:application      (or uvicorn hotel_api.asgi:application)
The old WSGI entry point (wsgi.py) still serves the REST API but cannot serve the WebSocket.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hotel_api.settings')

django_asgi_app = get_asgi_application()   # must come first: it loads Django, the consumers need it

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator      # noqa: E402
from django.conf import settings                             # noqa: E402

from booking.routing import websocket_urlpatterns            # noqa: E402

# A page may open the socket only from the hotel's own host names or from the React site (same list as CORS).
ALLOWED_ORIGINS = list(settings.ALLOWED_HOSTS) + list(settings.CORS_ALLOWED_ORIGINS)

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': OriginValidator(URLRouter(websocket_urlpatterns), ALLOWED_ORIGINS),
})
