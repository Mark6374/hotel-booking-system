"""Settings. Development works with no setup (see .env.example); production is switched on
with environment variables (DJANGO_DEBUG=0 ...), see ADMIN.md -> "Production checklist"."""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name):
    return [item.strip() for item in os.environ.get(name, '').split(',') if item.strip()]


# ---------------------------------------------------------------- core
DEBUG = env_bool('DJANGO_DEBUG', True)          # True = local development (as before)

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '')
ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS')
if DEBUG:
    SECRET_KEY = SECRET_KEY or 'local-dev-only-not-for-production'
    ALLOWED_HOSTS = ALLOWED_HOSTS or ['*']
else:
    if len(SECRET_KEY) < 50:
        raise ImproperlyConfigured('Set DJANGO_SECRET_KEY (at least 50 random characters) when DJANGO_DEBUG=0.')
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured('Set DJANGO_ALLOWED_HOSTS (comma separated) when DJANGO_DEBUG=0.')

# Where the React site lives (links in e-mails and "View site" in the admin).
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')

# The admin panel path. Change it in production to keep bots away from /admin/.
ADMIN_URL = os.environ.get('DJANGO_ADMIN_URL', 'admin/').strip('/') + '/'

INSTALLED_APPS = [
    'daphne',                                   # must be first: makes `runserver` serve ASGI (the chat WebSocket)
    'booking.admin_apps.HotelAdminConfig',      # django.contrib.admin with the hotel's own AdminSite
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'channels',
    'booking',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',    # serves the admin's CSS/JS (collectstatic)
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',     # the JSON API is exempt (Bearer token, no cookies)
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'hotel_api.urls'
ASGI_APPLICATION = 'hotel_api.asgi.application'   # HTTP + the chat WebSocket (WSGI_APPLICATION is not used any more)

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

# ---------------------------------------------------------------- CORS (the React site)
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS')
if DEBUG:
    CORS_ALLOWED_ORIGINS += ['http://localhost:%d' % port for port in range(5173, 5181)]

# ---------------------------------------------------------------- database
if os.environ.get('USE_SQLITE'):
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.environ['DB_NAME'],
            'USER': os.environ['DB_USER'],
            'PASSWORD': os.environ.get('DB_PASSWORD', ''),
            'HOST': os.environ['DB_HOST'],
            'PORT': os.environ['DB_PORT'],
            'OPTIONS': {'charset': 'utf8mb4'},
            'CONN_MAX_AGE': 0 if DEBUG else int(os.environ.get('DB_CONN_MAX_AGE', '60')),
        }
    }

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# The hotel's local time zone. Django sets the process time zone from it, and the booking code
# uses datetime.now() / date.today(), so "today" in the admin dashboard follows this setting.
TIME_ZONE = os.environ.get('DJANGO_TIME_ZONE', 'UTC')
USE_TZ = False

# ---------------------------------------------------------------- chat (WebSocket) and profile photos
# The channel layer carries a chat message from the process that received it to the sockets of the
# other people. In-memory works for ONE server process (development, a single daphne). With several
# processes / servers set REDIS_URL (pip install channels-redis), or messages reach only some people.
REDIS_URL = os.environ.get('REDIS_URL', '')
if REDIS_URL:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels_redis.core.RedisChannelLayer',
                                  'CONFIG': {'hosts': [REDIS_URL]}}}
else:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

# Uploaded profile photos (MEDIA_ROOT/avatars/). Keep this folder when you deploy a new version.
MEDIA_ROOT = Path(os.environ.get('MEDIA_ROOT') or BASE_DIR / 'media')

# ---------------------------------------------------------------- static files (admin CSS/JS)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'           # python manage.py collectstatic
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

# ---------------------------------------------------------------- admin accounts and sessions
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
SESSION_COOKIE_AGE = 8 * 60 * 60                 # an admin session lasts one working day
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_NAME = 'juniper_admin_session'
CSRF_COOKIE_NAME = 'juniper_admin_csrf'
CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_TRUSTED_ORIGINS')
X_FRAME_OPTIONS = 'DENY'
ADMIN_LOGIN_MAX_FAILURES = 5                     # per IP + username, then locked for 15 minutes

# ---------------------------------------------------------------- HTTPS (production)
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = env_bool('DJANGO_SECURE_COOKIES', not DEBUG)
SECURE_SSL_REDIRECT = env_bool('DJANGO_SSL_REDIRECT', not DEBUG)
SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_HSTS_SECONDS', '0' if DEBUG else '31536000'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('DJANGO_HSTS_INCLUDE_SUBDOMAINS', not DEBUG)
SECURE_HSTS_PRELOAD = env_bool('DJANGO_HSTS_PRELOAD', False)
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CONTENT_TYPE_NOSNIFF = True
if env_bool('DJANGO_BEHIND_PROXY', False):       # nginx / load balancer terminates TLS
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ---------------------------------------------------------------- e-mail (password reset)
EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'localhost')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '25'))
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = env_bool('EMAIL_USE_TLS', False)
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'no-reply@junipercourt.example')

# ---------------------------------------------------------------- REST framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['booking.auth.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'DEFAULT_THROTTLE_RATES': {'auth': '20/min', 'review_write': '30/hour', 'photo_write': '20/hour'},
}

# ---------------------------------------------------------------- logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '%(asctime)s %(levelname)s %(name)s: %(message)s'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'root': {'handlers': ['console'], 'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO')},
    'loggers': {'django.request': {'level': 'WARNING'}},
}
