"""Profile photo API for the React frontend. See PHOTOS_AND_CHAT_API.md.

  POST / PUT  /api/account/photo/    multipart field "photo"   add or change my photo
  DELETE      /api/account/photo/                              remove my photo
  GET         /api/photos/<name>.jpg                           the picture itself (public, unguessable name)
"""
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from . import photos
from .roles import IsActiveAccount, account_payload


class PhotoWriteThrottle(UserRateThrottle):
    scope = 'photo_write'


class AccountPhotoView(APIView):
    permission_classes = [IsActiveAccount]
    parser_classes = [MultiPartParser]
    throttle_classes = [PhotoWriteThrottle]

    def _save(self, request):
        # Refuse a huge upload before Django reads it (the body also holds the multipart framing).
        try:
            length = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            length = 0
        if length > photos.MAX_UPLOAD_BYTES + 64 * 1024:
            return Response({'detail': 'The photo is too big. The limit is %d MB.'
                                       % (photos.MAX_UPLOAD_BYTES // (1024 * 1024))},
                            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        uploaded = request.FILES.get('photo')
        if uploaded is None:
            return Response({'detail': 'Send the picture in the form field "photo".'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            photos.save_photo(request.user, uploaded)
        except photos.PhotoError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(account_payload(request.user))

    def post(self, request):
        return self._save(request)

    def put(self, request):
        return self._save(request)

    def delete(self, request):
        photos.remove_photo(request.user)      # no photo is fine too: the result is the same
        return Response(account_payload(request.user))


class PhotoFileView(APIView):
    """The picture. Public on purpose: an <img> tag cannot send the Authorization header. The name is 32
    random characters, only people who are allowed to see the account get it (account, chat), and a new
    random name is made on every upload, so the answer can be cached for ever."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, name):
        path = photos.file_path(name)
        if path is None or not path.is_file():
            raise Http404
        response = FileResponse(open(path, 'rb'), content_type='image/jpeg')
        response['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response
