"""The hotel's admin site: branding, a dashboard on the home page, grouped navigation,
and protection of the login form against password guessing.

Do not import models at the top of this file: Django imports it while the apps are still loading.
"""
import logging

from django.conf import settings
from django.contrib import admin
from django.core.cache import cache
from django.http import HttpResponse

log = logging.getLogger(__name__)

LOCK_SECONDS = 15 * 60

# The side menu groups the booking models by job instead of one long "Booking" block.
SECTIONS = (
    ('Front desk', ('Booking', 'Payment')),
    ('Rooms', ('Room', 'RoomType')),
    ('Guests and reviews', ('Guest', 'GuestRole', 'RoomReview')),
)


class HotelAdminSite(admin.AdminSite):
    site_header = 'Juniper Court'
    site_title = 'Juniper Court admin'
    index_title = 'Hotel management'
    index_template = 'admin/hotel_dashboard.html'
    site_url = settings.FRONTEND_URL            # the "View site" link

    def index(self, request, extra_context=None):
        from .admin_dashboard import dashboard_stats
        context = dict(extra_context or {})
        if request.user.has_perm('booking.view_booking'):
            context['dashboard'] = dashboard_stats()
        return super().index(request, context)

    def get_app_list(self, request, app_label=None):
        apps = super().get_app_list(request, app_label)
        out = []
        for app in apps:
            if app['app_label'] != 'booking':
                out.append(app)
                continue
            by_name = {m['object_name']: m for m in app['models']}
            for title, names in SECTIONS:
                models = [by_name[n] for n in names if n in by_name]
                if models:
                    out.append({**app, 'name': title, 'models': models})
        return out

    # ------------------------------------------------ login protection
    def _failures_key(self, request, scope):
        ip = request.META.get('REMOTE_ADDR', '')
        user = request.POST.get('username', '').strip().lower()[:150]
        return 'admin-login-fail:%s:%s' % (scope, ip if scope == 'ip' else '%s:%s' % (ip, user))

    def login(self, request, extra_context=None):
        """After 5 wrong passwords for one username (or 25 from one address) the login is locked
        for 15 minutes. REMOTE_ADDR is used on purpose: X-Forwarded-For can be forged by the client.
        The counters live in Django's cache - use a shared cache (Redis / Memcached / database)
        when several worker processes run."""
        if request.method != 'POST':
            return super().login(request, extra_context)

        limit = settings.ADMIN_LOGIN_MAX_FAILURES
        keys = {'user': (self._failures_key(request, 'user'), limit),
                'ip': (self._failures_key(request, 'ip'), limit * 5)}
        if any(cache.get(key, 0) >= cap for key, cap in keys.values()):
            log.warning('Admin login locked for %s', request.META.get('REMOTE_ADDR'))
            response = HttpResponse('Too many failed login attempts. Try again in 15 minutes.',
                                    status=429, content_type='text/plain')
            response['Retry-After'] = str(LOCK_SECONDS)
            return response

        response = super().login(request, extra_context)
        if response.status_code == 302:                       # logged in
            cache.delete(keys['user'][0])
        else:                                                 # the form came back with an error
            for key, _ in keys.values():
                cache.add(key, 0, LOCK_SECONDS)
                try:
                    cache.incr(key)
                except ValueError:
                    cache.set(key, 1, LOCK_SECONDS)
            log.warning('Failed admin login for %r from %s', request.POST.get('username', ''),
                        request.META.get('REMOTE_ADDR'))
        return response
