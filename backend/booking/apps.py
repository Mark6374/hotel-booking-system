from django.apps import AppConfig


class BookingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'booking'

    def ready(self):
        # Register the models that live outside models.py (their tables come from db/08 and db/09).
        from . import chat, photos  # noqa: F401
