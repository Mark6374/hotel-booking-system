from django.urls import path

from . import assistant, views

urlpatterns = [
    path('auth/register/', views.RegisterView.as_view()),
    path('auth/login/', views.LoginView.as_view()),
    path('auth/me/', views.MeView.as_view()),
    path('guests/', views.GuestListView.as_view()),
    path('room-types/', views.RoomTypeListView.as_view()),
    path('rooms/', views.RoomListView.as_view()),
    path('bookings/', views.BookingListView.as_view()),
    path('booking-rooms/', views.BookingRoomListView.as_view()),
    path('payments/', views.PaymentListView.as_view()),
    path('assistant/', assistant.AssistantView.as_view()),   # AI assistant for guests (AI_ASSISTANT.md)
]
