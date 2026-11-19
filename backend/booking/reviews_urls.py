from django.urls import path

from . import reviews_api as v

urlpatterns = [
    path('reviews/summary/', v.RatingsOverviewView.as_view()),
    path('reviews/mine/', v.MyReviewsView.as_view()),
    path('reviews/<int:pk>/', v.ReviewDetailView.as_view()),
    path('reviews/<int:pk>/moderate/', v.ReviewModerateView.as_view()),
    path('rooms/<int:pk>/reviews/', v.RoomReviewListCreateView.as_view()),
]
