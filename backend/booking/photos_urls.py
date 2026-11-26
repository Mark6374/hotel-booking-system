from django.urls import path

from . import photos_api as v

urlpatterns = [
    path('account/photo/', v.AccountPhotoView.as_view()),
    path('photos/<str:name>', v.PhotoFileView.as_view()),
]
