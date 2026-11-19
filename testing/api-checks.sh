#!/bin/bash
# Backend API checks API-01..05 (tester 24B032036).
# Needs: Django running on :8000 with the demo data (seed_demo + seed_roles).
# Run (Windows: in Git Bash):  bash testing/api-checks.sh
# Resets the demo data at the start and at the end (admin API).
B=${1:-http://127.0.0.1:8000/api}
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
ADMIN=$(curl -s -X POST $B/auth/login/ -H 'Content-Type: application/json' -d '{"email":"admin@junipercourt.example","password":"Admin12345"}' | j "d['token']")
curl -s -X POST $B/admin/reset-demo/ -H "Authorization: Bearer $ADMIN" > /dev/null
AMINA=$(curl -s -X POST $B/auth/login/ -H 'Content-Type: application/json' -d '{"email":"saltanat@gmail.com","password":"demo12345"}' | j "d['token']")

echo "API-01  Visitor (no login) GET /api/guests/        -> expected: no personal data"
curl -s -w '' $B/guests/ | j "'        got %d guests: ' % len(d) + ', '.join(g['email']+' '+g['phone'] for g in d)"
echo "API-02  Visitor (no login) GET /api/payments/      -> expected: no payments"
curl -s $B/payments/ | j "'        got %d payments, amounts: ' % len(d) + ', '.join(p['amount'] for p in d)"
echo "API-03  Guest Amina GET /api/guests/               -> expected: only herself"
curl -s $B/guests/ -H "Authorization: Bearer $AMINA" | j "'        got %d guests: ' % len(d) + ', '.join(g['email'] for g in d)"
echo "API-04  Register with phone '(((((('                  -> expected: 400"
curl -s -o /dev/null -w '        HTTP %{http_code}\n' -X POST $B/auth/register/ -H 'Content-Type: application/json' -d '{"first_name":"Api","last_name":"Test","email":"api-test@example.com","phone":"((((((","password":"Hotel2026a"}'
echo "API-05  Booking request with phone 'abc'           -> expected: 400"
curl -s -o /dev/null -w '        HTTP %{http_code}\n' -X POST $B/bookings/create/ -H "Authorization: Bearer $AMINA" -H 'Content-Type: application/json' -d '{"check_in":"2026-12-20","check_out":"2026-12-22","rooms":[{"room_id":6,"guests_count":2}],"payment_method":"Cash","phone":"abc"}'
curl -s $B/account/ -H "Authorization: Bearer $AMINA" | j "'        Amina phone is now: ' + repr(d['phone'])"
curl -s -X POST $B/admin/reset-demo/ -H "Authorization: Bearer $ADMIN" > /dev/null
