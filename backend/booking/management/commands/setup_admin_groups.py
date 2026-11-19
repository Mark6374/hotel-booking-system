from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError

# group -> {model: actions}. "change" on booking means "may check in / out / cancel" (the admin never
# edits a booking by hand). Role changes (guestrole) and the admin log are for superusers only.
GROUPS = {
    'Front desk': {
        'booking': ('view', 'change'), 'payment': ('view',),
        'room': ('view', 'change'), 'roomtype': ('view',),
        'guest': ('view', 'add', 'change'), 'roomreview': ('view',),
    },
    'Review moderators': {
        'roomreview': ('view', 'change'), 'room': ('view',), 'roomtype': ('view',),
        'guest': ('view',), 'booking': ('view',),
    },
    'Managers': {
        'booking': ('view', 'change'), 'payment': ('view',),
        'room': ('view', 'add', 'change'), 'roomtype': ('view', 'add', 'change'),
        'guest': ('view', 'add', 'change'), 'roomreview': ('view', 'change'),
    },
}


class Command(BaseCommand):
    help = ('Creates / updates the staff groups of the admin panel: Front desk, Review moderators, Managers. '
            'Run after "migrate". Safe to run again. Then add people to a group in Admin -> Users.')

    def handle(self, *args, **options):
        for name, models in GROUPS.items():
            wanted = []
            for model, actions in models.items():
                for action in actions:
                    perm = Permission.objects.filter(content_type__app_label='booking',
                                                     codename='%s_%s' % (action, model)).first()
                    if perm is None:
                        raise CommandError('Permission %s_%s not found. Run "python manage.py migrate" first.'
                                           % (action, model))
                    wanted.append(perm)
            group, created = Group.objects.get_or_create(name=name)
            group.permissions.set(wanted)
            self.stdout.write('%s group "%s" with %d permissions.' % ('Created' if created else 'Updated', name, len(wanted)))
