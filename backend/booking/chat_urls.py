from django.urls import path

from . import chat_api as v

urlpatterns = [
    path('chat/ticket/', v.TicketView.as_view()),
    path('chat/unread/', v.UnreadView.as_view()),
    path('chat/conversation/', v.MyConversationView.as_view()),
    path('chat/messages/', v.MyMessagesView.as_view()),
    path('chat/read/', v.MyReadView.as_view()),
    path('chat/admin/conversations/', v.InboxView.as_view()),
    path('chat/admin/conversations/<int:pk>/messages/', v.AdminMessagesView.as_view()),
    path('chat/admin/conversations/<int:pk>/read/', v.AdminReadView.as_view()),
]
