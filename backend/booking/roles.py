"""Roles for website accounts (staff / admin pages of the React frontend).

Kept separate from models.py on purpose: the auth code there stays as it is,
and a guest without a row in guest_role is simply an active 'guest'.
Table: db/04_add_guest_role.sql
"""
from django.db import models
from rest_framework.permissions import BasePermission

from .models import Guest

ROLES = ('guest', 'staff', 'admin')


class GuestRole(models.Model):
    guest = models.OneToOneField(Guest, db_column='guest_id', primary_key=True,
                                 on_delete=models.CASCADE, related_name='role_row')
    role = models.CharField(max_length=10, default='guest')
    is_active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = 'guest_role'


def role_info(guest):
    """(role, is_active) for a guest; defaults when there is no row."""
    row = GuestRole.objects.filter(guest_id=guest.guest_id).first()
    return (row.role, row.is_active) if row else ('guest', True)


def account_payload(guest):
    role, active = role_info(guest)
    return {
        'guest_id': guest.guest_id,
        'first_name': guest.first_name,
        'last_name': guest.last_name,
        'email': guest.email,
        'phone': guest.phone,
        'role': role,
        'is_active': active,
    }


class _RolePermission(BasePermission):
    allowed = ROLES
    message = 'Your account cannot do this.'

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, Guest):
            return False
        role, active = role_info(user)
        if not active:
            self.message = 'This account is blocked.'
            return False
        return role in self.allowed


class IsActiveAccount(_RolePermission):
    """Any logged-in, not blocked account."""


class IsStaff(_RolePermission):
    allowed = ('staff', 'admin')
    message = 'Staff only.'


class IsAdmin(_RolePermission):
    allowed = ('admin',)
    message = 'Admins only.'
