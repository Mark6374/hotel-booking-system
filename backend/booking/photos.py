"""Profile photos.

Kept in its own module, like roles.py and reviews.py, so the shared models.py stays as it is.
Table: db/08_profile_photo.sql.  API: photos_api.py.  Docs: PHOTOS_AND_CHAT_API.md.

How a photo is stored
 * The upload is NEVER saved as it came. It is opened with Pillow, checked, rotated the way the
   camera meant (EXIF), stripped of all metadata (GPS position, camera, ...), cropped to a square
   and saved again as a JPEG of at most 512 x 512 pixels. A file that is not really an image, or
   an image with something hidden after the pixels, cannot get through this.
 * The file lives in MEDIA_ROOT/avatars/<32 random hex characters>.jpg and the table guest_photo
   remembers the name. A new random name is used for every upload, so the address cannot be guessed
   and browsers may cache it for ever. The old file is deleted.
"""
import datetime
import os
import re
import tempfile
import uuid
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.db import models
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024          # the file the user sends
MAX_PIXELS = 25_000_000                      # width x height, protects the server memory (a 5000 x 5000 photo)
ALLOWED_FORMATS = ('JPEG', 'PNG', 'WEBP')
AVATAR_SIZE = 512                            # the stored photo is at most this wide and this high
FILE_NAME_RE = re.compile(r'^[0-9a-f]{32}\.jpg$')
URL_PREFIX = '/api/photos/'


class PhotoError(ValueError):
    """The upload cannot be used. The message is shown to the user."""


def _now():
    return datetime.datetime.now().replace(microsecond=0)   # MySQL DATETIME has no fractions


class GuestPhoto(models.Model):
    guest = models.OneToOneField('booking.Guest', db_column='guest_id', primary_key=True,
                                 on_delete=models.CASCADE, related_name='photo_row')
    file_name = models.CharField(max_length=40, unique=True)
    updated_at = models.DateTimeField(default=_now)

    class Meta:
        managed = False
        db_table = 'guest_photo'

    def __str__(self):
        return 'Photo of guest %s' % self.guest_id


# ---------------------------------------------------------------- files

def avatar_dir():
    path = Path(settings.MEDIA_ROOT) / 'avatars'
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_path(file_name):
    """Full path of a stored photo, or None when the name is not one we create (no path tricks)."""
    if not FILE_NAME_RE.match(file_name or ''):
        return None
    return avatar_dir() / file_name


def photo_url(file_name):
    return URL_PREFIX + file_name if file_name else None


def photo_url_for(guest):
    """URL of a guest's photo or None. Always asks the database: Django remembers a MISSING one-to-one row,
    which would still be missing in the same request after an upload."""
    name = GuestPhoto.objects.filter(guest_id=guest.guest_id).values_list('file_name', flat=True).first()
    return photo_url(name)


def photo_urls(guest_ids):
    """{guest_id: url} for many guests in one query (lists must not ask the database once per row)."""
    return {row.guest_id: photo_url(row.file_name)
            for row in GuestPhoto.objects.filter(guest_id__in=list(guest_ids))}


def _delete_file(file_name):
    path = file_path(file_name)
    if path is not None:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------- the upload

def process_upload(uploaded):
    """Checks an uploaded file and returns the bytes of the clean 512 x 512 (at most) JPEG.
    Raises PhotoError with a message for the user."""
    if uploaded.size > MAX_UPLOAD_BYTES:
        raise PhotoError('The photo is too big. The limit is %d MB.' % (MAX_UPLOAD_BYTES // (1024 * 1024)))
    try:
        img = Image.open(uploaded)
        if img.format not in ALLOWED_FORMATS:
            raise PhotoError('Use a JPEG, PNG or WebP picture.')
        width, height = img.size
        if width * height > MAX_PIXELS:                # only the header was read so far
            raise PhotoError('The picture is too large. Use one under %d megapixels.' % (MAX_PIXELS // 1_000_000))
        img.load()                                      # reads all the pixels: a broken file fails here
    except PhotoError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise PhotoError('This file is not a valid picture. Use a JPEG, PNG or WebP picture.')

    img = ImageOps.exif_transpose(img)                  # the way the camera was held
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        rgba = img.convert('RGBA')
        flat = Image.new('RGB', rgba.size, (255, 255, 255))   # transparent parts become white
        flat.paste(rgba, mask=rgba.getchannel('A'))
        img = flat
    else:
        img = img.convert('RGB')

    side = min(AVATAR_SIZE, *img.size)                  # never enlarge a small picture
    img = ImageOps.fit(img, (side, side), method=Image.Resampling.LANCZOS)   # centred square crop
    out = BytesIO()
    img.save(out, 'JPEG', quality=88, optimize=True)   # a new image: no EXIF, no GPS, nothing hidden
    return out.getvalue()


def _write_atomically(directory, file_name, data):
    """Write to a temporary file, then rename: a reader never sees half a photo."""
    fd, tmp = tempfile.mkstemp(dir=directory, suffix='.tmp')
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(data)
        os.replace(tmp, directory / file_name)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save_photo(guest, uploaded):
    """Adds or replaces the guest's photo. Returns the new URL. Raises PhotoError."""
    data = process_upload(uploaded)
    file_name = uuid.uuid4().hex + '.jpg'
    _write_atomically(avatar_dir(), file_name, data)
    old = GuestPhoto.objects.filter(guest_id=guest.guest_id).values_list('file_name', flat=True).first()
    try:
        GuestPhoto.objects.update_or_create(
            guest_id=guest.guest_id,
            defaults={'file_name': file_name, 'updated_at': _now()})
    except BaseException:
        _delete_file(file_name)                         # do not leave a file nobody points to
        raise
    if old:
        _delete_file(old)
    return photo_url(file_name)


def remove_photo(guest):
    """Deletes the guest's photo. Returns True when there was one."""
    old = GuestPhoto.objects.filter(guest_id=guest.guest_id).values_list('file_name', flat=True).first()
    if not old:
        return False
    GuestPhoto.objects.filter(guest_id=guest.guest_id).delete()
    _delete_file(old)
    return True


def prune_orphans():
    """Deletes files in MEDIA_ROOT/avatars that no guest_photo row points to
    (left behind by a demo reset or a crash). Returns how many were deleted."""
    used = set(GuestPhoto.objects.values_list('file_name', flat=True))
    removed = 0
    for path in avatar_dir().iterdir():
        if not path.is_file():
            continue
        if FILE_NAME_RE.match(path.name):
            stale = path.name not in used
        else:   # a temporary file: only when it is old, an upload may be writing it right now
            stale = path.suffix == '.tmp' and path.stat().st_mtime < datetime.datetime.now().timestamp() - 3600
        if stale:
            path.unlink()
            removed += 1
    return removed
