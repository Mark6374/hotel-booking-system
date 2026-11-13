from django.urls import path

from . import frontend_api as v
from . import password_reset as pr

urlpatterns = [
    path('auth/password-reset/', pr.PasswordResetRequestView.as_view()),
    path('auth/password-reset/confirm/', pr.PasswordResetConfirmView.as_view()),
    path('account/', v.AccountView.as_view()),
    path('account/password/', v.ChangePasswordView.as_view()),
    path('bookings/create/', v.CreateBookingView.as_view()),
    path('bookings/<int:pk>/cancel/', v.CancelBookingView.as_view()),
    path('bookings/<int:pk>/check-in/', v.CheckInView.as_view()),
    path('bookings/<int:pk>/check-out/', v.CheckOutView.as_view()),
    path('rooms/<int:pk>/maintenance/', v.ToggleMaintenanceView.as_view()),
    path('room-types/<int:pk>/price/', v.RoomTypePriceView.as_view()),
    path('admin/accounts/', v.AccountListView.as_view()),
    path('admin/accounts/<int:pk>/', v.AccountAdminView.as_view()),
    path('admin/reset-demo/', v.ResetDemoView.as_view()),
]
