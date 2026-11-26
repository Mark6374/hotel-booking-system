"""Profile photo API. Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_photos
"""
import shutil
import tempfile
from io import BytesIO
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TransactionTestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from . import photos
from .auth import make_token
from .chat import ChatMessage, Conversation
from .login_lock import LoginLock
from .models import Guest
from .photos import GuestPhoto
from .roles import GuestRole

MODELS = [Guest, GuestRole, GuestPhoto, Conversation, ChatMessage, LoginLock]
PHOTO = '/api/account/photo/'
ACCOUNT = '/api/account/'


def image_bytes(fmt='JPEG', size=(1200, 800), color=(200, 30, 30), mode='RGB', exif=None):
    out = BytesIO()
    img = Image.new(mode, size, color)
    kwargs = {'exif': exif} if exif is not None else {}
    img.save(out, fmt, **kwargs)
    return out.getvalue()


def upload(data, name='me.jpg', content_type='image/jpeg'):
    return {'photo': SimpleUploadedFile(name, data, content_type=content_type)}


class PhotoTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.schema_editor() as editor:
            for m in MODELS:
                editor.create_model(m)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            for m in reversed(MODELS):
                editor.delete_model(m)
        super().tearDownClass()

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.amina = self._guest('amina@example.com', 'Amina', 'Sadykova')
        self.api = self._client(self.amina)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _guest(self, email, first='F', last='L', role=None):
        g = Guest.objects.create(first_name=first, last_name=last, email=email, phone='+7 700 000 0000')
        if role:
            GuestRole.objects.create(guest=g, role=role)
        return g

    def _client(self, guest):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(guest))
        return c

    def files(self):
        return sorted(p.name for p in (Path(self.media) / 'avatars').glob('*')) if (Path(self.media) / 'avatars').exists() else []

    # ------------------------------------------------------------ add / read

    def test_no_photo_by_default(self):
        self.assertIsNone(self.api.get(ACCOUNT).data['photo_url'])

    def test_upload_adds_photo_and_account_shows_it(self):
        r = self.api.post(PHOTO, upload(image_bytes()), format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        url = r.data['photo_url']
        self.assertRegex(url, r'^/api/photos/[0-9a-f]{32}\.jpg$')
        self.assertEqual(self.api.get(ACCOUNT).data['photo_url'], url)
        self.assertEqual(GuestPhoto.objects.get(guest=self.amina).file_name, url.rsplit('/', 1)[1])
        self.assertEqual(len(self.files()), 1)

    def test_picture_is_public_cached_and_a_clean_512_square_jpeg(self):
        url = self.api.post(PHOTO, upload(image_bytes(size=(1200, 800))), format='multipart').data['photo_url']
        r = APIClient().get(url)                                   # no login: an <img> tag cannot send a token
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'image/jpeg')
        self.assertIn('immutable', r['Cache-Control'])
        img = Image.open(BytesIO(b''.join(r.streaming_content)))
        self.assertEqual(img.format, 'JPEG')
        self.assertEqual(img.size, (512, 512))

    def test_small_picture_is_not_enlarged(self):
        url = self.api.post(PHOTO, upload(image_bytes(size=(100, 80))), format='multipart').data['photo_url']
        img = Image.open(Path(self.media) / 'avatars' / url.rsplit('/', 1)[1])
        self.assertEqual(img.size, (80, 80))

    def test_metadata_such_as_gps_is_removed(self):
        exif = Image.Exif()
        exif[0x010F] = 'SecretCameraMaker'
        exif[0x8825] = {1: 'N', 2: (43.0, 15.0, 0.0)}            # a GPS block
        data = image_bytes(exif=exif)
        self.assertIn(b'SecretCameraMaker', data)                  # the upload has it ...
        url = self.api.post(PHOTO, upload(data), format='multipart').data['photo_url']
        stored = (Path(self.media) / 'avatars' / url.rsplit('/', 1)[1]).read_bytes()
        self.assertNotIn(b'SecretCameraMaker', stored)             # ... the stored picture does not
        self.assertEqual(len(Image.open(BytesIO(stored)).getexif()), 0)

    def test_png_and_webp_are_accepted_and_transparency_becomes_white(self):
        png = image_bytes('PNG', size=(64, 64), color=(0, 0, 0, 0), mode='RGBA')
        url = self.api.post(PHOTO, upload(png, 'a.png', 'image/png'), format='multipart').data['photo_url']
        img = Image.open(Path(self.media) / 'avatars' / url.rsplit('/', 1)[1])
        self.assertEqual(img.getpixel((10, 10)), (255, 255, 255))
        webp = image_bytes('WEBP', size=(64, 64))
        r = self.api.post(PHOTO, upload(webp, 'a.webp', 'image/webp'), format='multipart')
        self.assertEqual(r.status_code, 200)

    # ------------------------------------------------------------ change / remove

    def test_changing_replaces_the_photo_and_deletes_the_old_file(self):
        first = self.api.post(PHOTO, upload(image_bytes()), format='multipart').data['photo_url']
        second = self.api.put(PHOTO, upload(image_bytes(color=(0, 0, 200))), format='multipart').data['photo_url']
        self.assertNotEqual(first, second)                         # a new name: caches never show the old picture
        self.assertEqual(GuestPhoto.objects.count(), 1)
        self.assertEqual(self.files(), [second.rsplit('/', 1)[1]])
        self.assertEqual(APIClient().get(first).status_code, 404)
        self.assertEqual(APIClient().get(second).status_code, 200)

    def test_delete_removes_photo_and_file_and_can_be_repeated(self):
        self.api.post(PHOTO, upload(image_bytes()), format='multipart')
        r = self.api.delete(PHOTO)
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data['photo_url'])
        self.assertEqual(self.files(), [])
        self.assertEqual(GuestPhoto.objects.count(), 0)
        self.assertEqual(self.api.delete(PHOTO).status_code, 200)

    def test_each_guest_has_only_his_own_photo(self):
        daniel = self._guest('daniel@example.com', 'Daniel', 'Brooks')
        self.api.post(PHOTO, upload(image_bytes()), format='multipart')
        self.assertIsNone(self._client(daniel).get(ACCOUNT).data['photo_url'])
        self._client(daniel).delete(PHOTO)                          # does not touch Amina's photo
        self.assertIsNotNone(self.api.get(ACCOUNT).data['photo_url'])

    # ------------------------------------------------------------ refused uploads

    def test_not_an_image_is_refused(self):
        for name, data in (('a.jpg', b'just some text, not a picture'), ('a.jpg', b''),
                           ('a.jpg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
                           ('a.jpg', b'GIF89a' + b'\x00' * 20)):
            r = self.api.post(PHOTO, upload(data, name), format='multipart')
            self.assertEqual(r.status_code, 400, name)
        self.assertEqual(self.files(), [])

    def test_gif_is_not_an_allowed_format(self):
        r = self.api.post(PHOTO, upload(image_bytes('GIF', size=(40, 40)), 'a.gif', 'image/gif'), format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertIn('JPEG, PNG or WebP', r.data['detail'])

    def test_image_with_a_script_after_the_pixels_is_cleaned(self):
        data = image_bytes(size=(64, 64)) + b'<?php system($_GET["c"]); ?>'
        url = self.api.post(PHOTO, upload(data), format='multipart').data['photo_url']
        stored = (Path(self.media) / 'avatars' / url.rsplit('/', 1)[1]).read_bytes()
        self.assertNotIn(b'<?php', stored)

    def test_too_big_file_is_refused(self):
        r = self.api.post(PHOTO, upload(b'x' * (photos.MAX_UPLOAD_BYTES + 10)), format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertIn('too big', r.data['detail'])

    def test_huge_request_is_refused_before_it_is_read(self):
        r = self.api.post(PHOTO, upload(b'x' * (photos.MAX_UPLOAD_BYTES + 200_000)), format='multipart')
        self.assertEqual(r.status_code, 413)

    def test_too_many_pixels_is_refused(self):
        data = image_bytes('PNG', size=(6000, 5000), color=0, mode='L')    # 30 megapixels, tiny file
        self.assertLess(len(data), photos.MAX_UPLOAD_BYTES)
        r = self.api.post(PHOTO, upload(data, 'big.png', 'image/png'), format='multipart')
        self.assertEqual(r.status_code, 400)
        self.assertIn('too large', r.data['detail'])

    def test_missing_field_is_refused(self):
        r = self.api.post(PHOTO, {'other': SimpleUploadedFile('a.jpg', image_bytes())}, format='multipart')
        self.assertEqual(r.status_code, 400)

    # ------------------------------------------------------------ who may

    def test_visitor_cannot_upload(self):
        r = APIClient().post(PHOTO, upload(image_bytes()), format='multipart')
        self.assertEqual(r.status_code, 401)

    def test_blocked_account_cannot_upload(self):
        GuestRole.objects.create(guest=self._guest('b@example.com'), role='guest', is_active=False)
        blocked = Guest.objects.get(email='b@example.com')
        r = self._client(blocked).post(PHOTO, upload(image_bytes()), format='multipart')
        self.assertEqual(r.status_code, 403)

    def test_upload_limit_per_hour(self):
        from .photos_api import PhotoWriteThrottle
        PhotoWriteThrottle.THROTTLE_RATES = {'photo_write': '2/hour'}
        try:
            codes = [self.api.post(PHOTO, upload(image_bytes(size=(64, 64))), format='multipart').status_code
                     for _ in range(3)]
        finally:
            del PhotoWriteThrottle.THROTTLE_RATES
        self.assertEqual(codes, [200, 200, 429])

    # ------------------------------------------------------------ the picture URL

    def test_picture_url_only_serves_names_we_created(self):
        (Path(self.media) / 'avatars').mkdir(parents=True, exist_ok=True)
        (Path(self.media) / 'secret.txt').write_text('secret')
        for name in ('..%2Fsecret.txt', 'secret.txt', 'x.jpg', 'A' * 32 + '.jpg', '0' * 32 + '.jpg',
                     '0' * 32 + '.png', '%2e%2e%2f' + '0' * 32 + '.jpg'):
            self.assertEqual(APIClient().get('/api/photos/' + name).status_code, 404, name)

    # ------------------------------------------------------------ lists

    def test_admin_account_list_has_photo_url(self):
        admin = self._guest('admin@example.com', 'Mark', 'Y', 'admin')
        admin.set_password('Admin12345x')
        admin.save()
        self.amina.set_password('Passw0rd!x')
        self.amina.save()
        url = self.api.post(PHOTO, upload(image_bytes()), format='multipart').data['photo_url']
        rows = {r['email']: r for r in self._client(admin).get('/api/admin/accounts/').data}
        self.assertEqual(rows['amina@example.com']['photo_url'], url)
        self.assertIsNone(rows['admin@example.com']['photo_url'])

    def test_prune_orphans_deletes_only_unused_files(self):
        url = self.api.post(PHOTO, upload(image_bytes()), format='multipart').data['photo_url']
        orphan = Path(self.media) / 'avatars' / ('f' * 32 + '.jpg')
        orphan.write_bytes(b'x')
        young_tmp = Path(self.media) / 'avatars' / 'abc.tmp'
        young_tmp.write_bytes(b'x')
        self.assertEqual(photos.prune_orphans(), 1)
        self.assertFalse(orphan.exists())
        self.assertTrue(young_tmp.exists())                        # an upload may be writing it right now
        self.assertEqual(APIClient().get(url).status_code, 200)
