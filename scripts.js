'use strict';

/* Juniper Court Hotel – booking prototype
   The "database" below follows the Task 9 plan: guest, room_type, room,
   booking, booking_room (bridge table) and payment. It is kept in memory
   and saved to localStorage so the data survives a page reload. */

(function () {
  var STORAGE_KEY = 'juniper-court-db-v1';
  var ACTIVE = ['Confirmed', 'CheckedIn'];

  /* ---------- Small helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function nights(ci, co) {
    return Math.round((Date.parse(co + 'T00:00:00Z') - Date.parse(ci + 'T00:00:00Z')) / 86400000);
  }

  function fmtDate(iso) {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(iso + 'T00:00:00Z'));
  }

  function nowStamp() {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function ref(bookingId) { return 'HB-' + String(bookingId).padStart(4, '0'); }

  function nextId(rows, key) {
    return rows.reduce(function (max, r) { return Math.max(max, r[key]); }, 0) + 1;
  }

  /* ---------- Database ---------- */

  function seed() {
    return {
      guest: [
        { guest_id: 1, first_name: 'Amina', last_name: 'Sadykova', email: 'amina@example.com', phone: '+7 700 111 2233' },
        { guest_id: 2, first_name: 'Daniel', last_name: 'Brooks', email: 'daniel@example.com', phone: '+44 20 7946 0101' },
        { guest_id: 3, first_name: 'Mei', last_name: 'Tanaka', email: 'mei@example.com', phone: '+81 3 5550 0123' }
      ],
      room_type: [
        { room_type_id: 1, type_name: 'Standard', capacity: 2, price_per_night: 60, description: 'Queen bed, quiet courtyard view, 24 m².' },
        { room_type_id: 2, type_name: 'Deluxe', capacity: 3, price_per_night: 90, description: 'King bed, city view, work desk and rain shower, 32 m².' },
        { room_type_id: 3, type_name: 'Suite', capacity: 4, price_per_night: 150, description: 'Bedroom and separate lounge with corner windows, 55 m².' }
      ],
      room: [
        { room_id: 1, room_number: '101', floor: 1, status: 'Available', room_type_id: 1 },
        { room_id: 2, room_number: '102', floor: 1, status: 'Available', room_type_id: 1 },
        { room_id: 3, room_number: '103', floor: 1, status: 'Available', room_type_id: 1 },
        { room_id: 4, room_number: '201', floor: 2, status: 'Available', room_type_id: 2 },
        { room_id: 5, room_number: '202', floor: 2, status: 'Available', room_type_id: 2 },
        { room_id: 6, room_number: '301', floor: 3, status: 'Available', room_type_id: 3 }
      ],
      booking: [
        { booking_id: 1, guest_id: 1, booking_date: '2026-10-02 09:15', check_in: '2026-12-09', check_out: '2026-12-12', status: 'Confirmed' },
        { booking_id: 2, guest_id: 2, booking_date: '2026-10-05 14:40', check_in: '2026-12-11', check_out: '2026-12-14', status: 'Confirmed' },
        { booking_id: 3, guest_id: 1, booking_date: '2026-09-10 11:05', check_in: '2026-12-01', check_out: '2026-12-05', status: 'Completed' },
        { booking_id: 4, guest_id: 3, booking_date: '2026-10-07 18:22', check_in: '2026-12-10', check_out: '2026-12-13', status: 'Cancelled' },
        { booking_id: 5, guest_id: 2, booking_date: '2026-10-08 10:00', check_in: '2026-12-10', check_out: '2026-12-13', status: 'Confirmed' }
      ],
      booking_room: [
        { booking_room_id: 1, booking_id: 1, room_id: 1, guests_count: 2, price_per_night: 60 },
        { booking_room_id: 2, booking_id: 2, room_id: 4, guests_count: 2, price_per_night: 90 },
        { booking_room_id: 3, booking_id: 3, room_id: 2, guests_count: 1, price_per_night: 60 },
        { booking_room_id: 4, booking_id: 4, room_id: 3, guests_count: 2, price_per_night: 60 },
        { booking_room_id: 5, booking_id: 5, room_id: 5, guests_count: 3, price_per_night: 90 }
      ],
      payment: [
        { payment_id: 1, booking_id: 1, amount: 180, payment_method: 'Card', payment_status: 'Paid', payment_date: '2026-10-02 09:16' },
        { payment_id: 2, booking_id: 2, amount: 270, payment_method: 'Card', payment_status: 'Paid', payment_date: '2026-10-05 14:41' },
        { payment_id: 3, booking_id: 3, amount: 240, payment_method: 'Cash', payment_status: 'Paid', payment_date: '2026-09-10 11:06' },
        { payment_id: 4, booking_id: 4, amount: 180, payment_method: 'Card', payment_status: 'Refunded', payment_date: '2026-10-07 18:23' },
        { payment_id: 5, booking_id: 5, amount: 270, payment_method: 'Transfer', payment_status: 'Paid', payment_date: '2026-10-08 10:02' }
      ]
    };
  }

  var TABLES = ['guest', 'room_type', 'room', 'booking', 'booking_room', 'payment'];

  function isValidDb(d) {
    return d && TABLES.every(function (t) { return Array.isArray(d[t]); });
  }

  function loadDb() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (isValidDb(parsed)) return parsed;
      }
    } catch (e) { /* storage blocked or corrupt: fall back to seed data */ }
    var fresh = seed();
    saveDb(fresh);
    return fresh;
  }

  function saveDb(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d || db)); } catch (e) { /* ignore */ }
  }

  var db = loadDb();

  /* ---------- Availability (same logic as the SELECT query in Task 9) ---------- */

  function blockedRoomIds(d, ci, co) {
    var ids = {};
    d.booking
      .filter(function (b) { return ACTIVE.indexOf(b.status) !== -1 && b.check_in < co && b.check_out > ci; })
      .forEach(function (b) {
        d.booking_room.forEach(function (l) { if (l.booking_id === b.booking_id) ids[l.room_id] = b.booking_id; });
      });
    return ids;
  }

  function roomsOfType(d, typeId) {
    return d.room.filter(function (r) { return r.room_type_id === typeId; });
  }

  function freeRooms(d, typeId, ci, co) {
    var blocked = blockedRoomIds(d, ci, co);
    return roomsOfType(d, typeId).filter(function (r) { return r.status === 'Available' && !blocked[r.room_id]; });
  }

  function typeOf(d, room) {
    return d.room_type.filter(function (t) { return t.room_type_id === room.room_type_id; })[0];
  }

  /* ---------- State ---------- */

  function defaultDates() {
    var today = todayISO();
    var ci = today < '2026-12-10' ? '2026-12-10' : addDays(today, 7);
    return { ci: ci, co: addDays(ci, 3) };
  }

  var dd = defaultDates();
  var state = {
    search: { ci: dd.ci, co: dd.co, guests: 2 },
    sel: {},
    staff: { ci: dd.ci, co: dd.co },
    mineEmail: ''
  };

  function validateSearch(s) {
    if (!s.ci || !s.co) return 'Choose both a check-in and a check-out date.';
    if (s.ci < todayISO()) return 'Check-in cannot be in the past.';
    if (s.co <= s.ci) return 'Check-out must be after check-in.';
    if (!(s.guests >= 1 && s.guests <= 10)) return 'Guests must be between 1 and 10.';
    return '';
  }

  /* ---------- Navigation ---------- */

  function showView(name) {
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    var navName = (name === 'checkout' || name === 'confirm') ? 'book' : name;
    $$('.nav-btn').forEach(function (b) {
      if (b.dataset.view === navName) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (name === 'mine') renderMine();
    if (name === 'staff') renderStaff();
    var h = $('#view-' + name + ' h1');
    if (h) h.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (name === 'book' || name === 'mine' || name === 'staff') {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- Book view: results and summary ---------- */

  function getSelection() {
    var s = state.search;
    var n = nights(s.ci, s.co);
    var out = { lines: [], total: 0, cap: 0, count: 0, n: n };
    db.room_type.forEach(function (t) {
      var q = state.sel[t.room_type_id] || 0;
      if (!q) return;
      var rooms = freeRooms(db, t.room_type_id, s.ci, s.co).slice(0, q);
      if (!rooms.length) return;
      var sub = rooms.length * t.price_per_night * n;
      out.lines.push({ type: t, rooms: rooms, subtotal: sub });
      out.total += sub;
      out.cap += rooms.length * t.capacity;
      out.count += rooms.length;
    });
    return out;
  }

  function renderResults(focusSel) {
    var s = state.search;
    var err = validateSearch(s);
    var title = $('#results-title');
    var box = $('#results');

    if (err) {
      title.textContent = 'Choose valid dates to see rooms';
      box.innerHTML = '<p class="empty">' + esc(err) + '</p>';
      renderSummary();
      return;
    }

    var n = nights(s.ci, s.co);
    title.textContent = 'Rooms for ' + fmtDate(s.ci) + ' to ' + fmtDate(s.co) + ' (' + plural(n, 'night', 'nights') + ')';

    var blocked = blockedRoomIds(db, s.ci, s.co);

    box.innerHTML = db.room_type.map(function (t) {
      var all = roomsOfType(db, t.room_type_id);
      var free = freeRooms(db, t.room_type_id, s.ci, s.co);
      var qty = Math.min(state.sel[t.room_type_id] || 0, free.length);
      state.sel[t.room_type_id] = qty;

      var segs = all.map(function (r) {
        var cls = r.status !== 'Available' ? 'off' : (blocked[r.room_id] ? 'taken' : 'free');
        return '<span class="seg ' + cls + '"></span>';
      }).join('');

      var left = free.length === 0
        ? '<p class="left sold">Sold out for these dates</p>'
        : '<p class="left">' + free.length + ' of ' + all.length + ' left</p>';

      return '' +
        '<article class="rt">' +
          '<div class="rt-info">' +
            '<h3>' + esc(t.type_name) + '</h3>' +
            '<p class="desc">' + esc(t.description) + '</p>' +
            '<p class="price">Sleeps ' + t.capacity + '. ' + money(t.price_per_night) + ' per night, ' +
              money(t.price_per_night * n) + ' for ' + plural(n, 'night', 'nights') + '.</p>' +
          '</div>' +
          '<div class="rt-avail">' +
            '<div class="segs" role="img" aria-label="' + free.length + ' of ' + all.length + ' ' + esc(t.type_name) + ' rooms free">' + segs + '</div>' +
            left +
          '</div>' +
          '<div class="stepper" role="group" aria-label="Number of ' + esc(t.type_name) + ' rooms">' +
            '<button type="button" class="step" data-type="' + t.room_type_id + '" data-delta="-1" aria-label="Remove one ' + esc(t.type_name) + ' room"' + (qty === 0 ? ' disabled' : '') + '>&minus;</button>' +
            '<output aria-live="polite">' + qty + '</output>' +
            '<button type="button" class="step" data-type="' + t.room_type_id + '" data-delta="1" aria-label="Add one ' + esc(t.type_name) + ' room"' + (qty >= free.length ? ' disabled' : '') + '>+</button>' +
          '</div>' +
        '</article>';
    }).join('');

    renderSummary();

    if (focusSel) {
      var btn = $(focusSel);
      if (btn && btn.disabled) {
        var other = $$('.step[data-type="' + btn.dataset.type + '"]').filter(function (b) { return !b.disabled; })[0];
        if (other) other.focus();
      } else if (btn) {
        btn.focus();
      }
    }
  }

  function summaryDates(s, n) {
    return '<dl>' +
      '<div><dt>Check-in</dt><dd>' + fmtDate(s.ci) + '</dd></div>' +
      '<div><dt>Check-out</dt><dd>' + fmtDate(s.co) + '</dd></div>' +
      '<div><dt>Nights</dt><dd>' + n + '</dd></div>' +
      '<div><dt>Guests</dt><dd>' + s.guests + '</dd></div>' +
    '</dl>';
  }

  function summaryLines(sel) {
    return sel.lines.map(function (l) {
      return '<div class="sum-line"><div>' + l.rooms.length + ' &times; ' + esc(l.type.type_name) +
        '<small>' + plural(sel.n, 'night', 'nights') + ' at ' + money(l.type.price_per_night) + '</small></div>' +
        '<strong>' + money(l.subtotal) + '</strong></div>';
    }).join('');
  }

  function renderSummary() {
    var body = $('#summary-body');
    var btn = $('#continue-btn');
    var s = state.search;

    if (validateSearch(s)) {
      body.innerHTML = '<p class="muted">Choose valid dates to start.</p>';
      btn.disabled = true;
      return;
    }

    var sel = getSelection();
    var html = summaryDates(s, sel.n);

    if (!sel.lines.length) {
      body.innerHTML = html + '<p class="muted">No rooms yet. Press + on a room type to add one.</p>';
      btn.disabled = true;
      return;
    }

    html += '<hr>' + summaryLines(sel) + '<hr>' +
      '<div class="sum-line"><span>Total</span><span class="sum-total">' + money(sel.total) + '</span></div>';

    var enough = sel.cap >= s.guests;
    if (!enough) {
      html += '<p class="note">These rooms sleep ' + sel.cap + ', but you are booking for ' + s.guests +
        '. Add another room or lower the number of guests.</p>';
    }
    body.innerHTML = html;
    btn.disabled = !enough;
  }

  /* ---------- Checkout ---------- */

  function renderCheckoutSummary() {
    var s = state.search;
    var sel = getSelection();
    $('#checkout-summary').innerHTML =
      '<h2>Your stay</h2>' + summaryDates(s, sel.n) + '<hr>' + summaryLines(sel) + '<hr>' +
      '<div class="sum-line"><span>Total</span><span class="sum-total">' + money(sel.total) + '</span></div>';
  }

  function renderLog(log) {
    return '<ol class="txlog">' + log.map(function (i) {
      return '<li class="' + (i.ok ? 'ok' : 'fail') + (i.final ? ' final' : '') + '">' +
        '<span class="mark" aria-hidden="true">' + (i.ok ? '&#10003;' : '&#10007;') + '</span>' +
        '<span><span class="sr">' + (i.ok ? 'Done: ' : 'Failed: ') + '</span>' + esc(i.label) +
        (i.detail ? '<small>' + esc(i.detail) + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function setFieldError(name, msg) {
    var input = $('#' + name);
    var out = $('#err-' + name);
    if (out) out.textContent = msg || '';
    if (input && input.tagName === 'INPUT' && input.type !== 'radio') {
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function currentMethod() {
    var checked = $('input[name="method"]:checked');
    return checked ? checked.value : '';
  }

  function toggleCardField() {
    $('#card-field').hidden = currentMethod() !== 'Card';
  }

  function onCheckoutSubmit(e) {
    e.preventDefault();
    var fail = $('#tx-failure');
    fail.hidden = true;
    fail.innerHTML = '';

    var v = {
      first_name: $('#first_name').value.trim(),
      last_name: $('#last_name').value.trim(),
      email: $('#email').value.trim(),
      phone: $('#phone').value.trim(),
      method: currentMethod(),
      cardDigits: $('#card').value.replace(/[\s-]/g, '')
    };

    var errors = {};
    if (!v.first_name) errors.first_name = 'Enter your first name.';
    if (!v.last_name) errors.last_name = 'Enter your last name.';
    if (!v.email) errors.email = 'Enter your email.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.email = 'Enter an email like name@example.com.';
    if (!v.phone) errors.phone = 'Enter your phone number.';
    else if (!/^\+?[\d\s()-]{6,20}$/.test(v.phone)) errors.phone = 'Use digits, spaces, and an optional + at the start.';
    if (!v.method) errors.method = 'Choose how you pay.';
    if (v.method === 'Card' && !/^\d{16}$/.test(v.cardDigits)) errors.card = 'Enter a 16-digit card number.';

    ['first_name', 'last_name', 'email', 'phone', 'method', 'card'].forEach(function (k) {
      setFieldError(k, errors[k]);
    });

    var firstBad = Object.keys(errors)[0];
    if (firstBad) {
      var target = $('#' + (firstBad === 'method' ? 'first_name' : firstBad));
      if (target) target.focus();
      return;
    }

    var searchErr = validateSearch(state.search);
    var sel = getSelection();
    if (searchErr || !sel.lines.length || sel.cap < state.search.guests) {
      showFailure({
        message: searchErr || 'The rooms you picked are no longer available or do not fit your group.',
        log: []
      });
      return;
    }

    var remaining = state.search.guests;
    var rooms = [];
    sel.lines.forEach(function (l) {
      l.rooms.forEach(function (r) {
        var g = Math.max(1, Math.min(l.type.capacity, remaining));
        remaining = Math.max(0, remaining - g);
        rooms.push({ room_id: r.room_id, room_number: r.room_number, price: l.type.price_per_night, guests_count: g });
      });
    });

    var result = runBookingTransaction({
      guest: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone },
      ci: state.search.ci,
      co: state.search.co,
      rooms: rooms,
      total: sel.total,
      method: v.method,
      cardDigits: v.cardDigits
    });

    if (result.ok) {
      state.sel = {};
      state.mineEmail = v.email;
      renderConfirm(result, v.email);
      showView('confirm');
      renderResults();
    } else {
      showFailure(result);
    }
  }

  function showFailure(result) {
    var box = $('#tx-failure');
    box.innerHTML =
      '<h3>Booking not saved</h3>' +
      '<p>' + esc(result.message) + '</p>' +
      (result.log && result.log.length ? renderLog(result.log) : '') +
      '<div class="actions"><button type="button" class="btn btn-ghost" id="search-again">Search again</button></div>';
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Transaction: book a room and pay ---------- */

  function runBookingTransaction(req) {
    var work = loadDb();
    var snapshot = JSON.stringify(work);
    var log = [];

    function step(label, fn) {
      try {
        var out = fn();
        log.push({ label: label, ok: true });
        return out;
      } catch (err) {
        log.push({ label: label, ok: false, detail: err.message });
        throw err;
      }
    }

    try {
      step('Lock the chosen rooms and check they are open', function () {
        req.rooms.forEach(function (r) {
          var row = work.room.filter(function (x) { return x.room_id === r.room_id; })[0];
          if (!row || row.status !== 'Available') throw new Error('Room ' + r.room_number + ' is closed for maintenance.');
        });
      });

      step('Check that no active booking overlaps these dates', function () {
        var blocked = blockedRoomIds(work, req.ci, req.co);
        req.rooms.forEach(function (r) {
          if (blocked[r.room_id]) throw new Error('Room ' + r.room_number + ' was just booked by someone else for overlapping dates.');
        });
      });

      var guestId = step('Find or create the guest', function () {
        var g = work.guest.filter(function (x) { return x.email.toLowerCase() === req.guest.email.toLowerCase(); })[0];
        if (g) {
          g.first_name = req.guest.first_name;
          g.last_name = req.guest.last_name;
          g.phone = req.guest.phone;
        } else {
          g = {
            guest_id: nextId(work.guest, 'guest_id'),
            first_name: req.guest.first_name,
            last_name: req.guest.last_name,
            email: req.guest.email,
            phone: req.guest.phone
          };
          work.guest.push(g);
        }
        return g.guest_id;
      });

      var bookingId = step('Insert the booking', function () {
        var b = {
          booking_id: nextId(work.booking, 'booking_id'),
          guest_id: guestId,
          booking_date: nowStamp(),
          check_in: req.ci,
          check_out: req.co,
          status: 'Confirmed'
        };
        work.booking.push(b);
        return b.booking_id;
      });

      step('Insert one room line for each room', function () {
        req.rooms.forEach(function (r) {
          work.booking_room.push({
            booking_room_id: nextId(work.booking_room, 'booking_room_id'),
            booking_id: bookingId,
            room_id: r.room_id,
            guests_count: r.guests_count,
            price_per_night: r.price
          });
        });
      });

      step('Insert the payment', function () {
        if (req.method === 'Card' && /0000$/.test(req.cardDigits)) throw new Error('The bank declined this card.');
        work.payment.push({
          payment_id: nextId(work.payment, 'payment_id'),
          booking_id: bookingId,
          amount: req.total,
          payment_method: req.method,
          payment_status: 'Paid',
          payment_date: nowStamp()
        });
      });

      log.push({ label: 'COMMIT', ok: true, final: true, detail: 'Booking, rooms, and payment saved together.' });
      db = work;
      saveDb();
      return { ok: true, bookingId: bookingId, log: log, total: req.total };
    } catch (err) {
      log.push({ label: 'ROLLBACK', ok: false, final: true, detail: 'Nothing was saved, so no room is blocked without payment.' });
      db = JSON.parse(snapshot);
      return { ok: false, message: err.message, log: log };
    }
  }

  /* ---------- Booking details (shared by confirmation and My bookings) ---------- */

  function bookingDetails(b) {
    var n = nights(b.check_in, b.check_out);
    var lines = db.booking_room.filter(function (l) { return l.booking_id === b.booking_id; });
    var total = 0;
    var rooms = lines.map(function (l) {
      var room = db.room.filter(function (r) { return r.room_id === l.room_id; })[0];
      var type = room ? typeOf(db, room) : null;
      total += l.price_per_night * n;
      return (room ? room.room_number : '?') + ' (' + (type ? type.type_name : 'Room') + ')';
    });
    var pays = db.payment.filter(function (p) { return p.booking_id === b.booking_id; });
    var pay = pays.length ? pays[pays.length - 1] : null;
    return { n: n, total: total, rooms: rooms, pay: pay };
  }

  function statusBadge(status) {
    var cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' ? 'good'
      : status === 'Cancelled' || status === 'Failed' ? 'bad'
      : status === 'Refunded' ? 'warn' : '';
    var label = status === 'CheckedIn' ? 'Checked in' : status;
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
  }

  function renderConfirm(result, email) {
    var b = db.booking.filter(function (x) { return x.booking_id === result.bookingId; })[0];
    var g = db.guest.filter(function (x) { return x.guest_id === b.guest_id; })[0];
    var d = bookingDetails(b);
    $('#confirm-body').innerHTML =
      '<div class="confirm-card">' +
        '<div class="booking-head"><span class="ref">' + ref(b.booking_id) + '</span>' + statusBadge(b.status) + '</div>' +
        '<div class="booking-meta">' +
          '<span>Guest <strong>' + esc(g.first_name + ' ' + g.last_name) + '</strong></span>' +
          '<span>Dates <strong>' + fmtDate(b.check_in) + ' to ' + fmtDate(b.check_out) + '</strong></span>' +
          '<span>Rooms <strong>' + esc(d.rooms.join(', ')) + '</strong></span>' +
          '<span>Total paid <strong>' + money(d.total) + '</strong> by ' + esc(d.pay ? d.pay.payment_method.toLowerCase() : '') + '</span>' +
        '</div>' +
        '<p class="muted">A confirmation would be sent to ' + esc(email) + '.</p>' +
        '<div class="tx-box tx-ok"><h3>What the database did</h3>' + renderLog(result.log) + '</div>' +
      '</div>';
  }

  /* ---------- My bookings ---------- */

  function renderMine() {
    var box = $('#mine-results');
    var email = state.mineEmail;
    if (!email) { box.innerHTML = ''; return; }

    var g = db.guest.filter(function (x) { return x.email.toLowerCase() === email.toLowerCase(); })[0];
    var list = g ? db.booking.filter(function (b) { return b.guest_id === g.guest_id; }) : [];
    if (!list.length) {
      box.innerHTML = '<p class="empty">No bookings found for ' + esc(email) + '. Check the spelling, or book a room first.</p>';
      return;
    }

    list.sort(function (a, b) { return b.booking_id - a.booking_id; });
    box.innerHTML = '<div class="booking-list">' + list.map(function (b) {
      var d = bookingDetails(b);
      var canCancel = b.status === 'Confirmed' && b.check_in >= todayISO();
      return '<article class="booking-card">' +
        '<div class="booking-head"><span class="ref">' + ref(b.booking_id) + '</span>' + statusBadge(b.status) + '</div>' +
        '<div class="booking-meta">' +
          '<span>Dates <strong>' + fmtDate(b.check_in) + ' to ' + fmtDate(b.check_out) + '</strong></span>' +
          '<span>Nights <strong>' + d.n + '</strong></span>' +
          '<span>Rooms <strong>' + esc(d.rooms.join(', ')) + '</strong></span>' +
          '<span>Total <strong>' + money(d.total) + '</strong></span>' +
          '<span>Payment ' + (d.pay ? statusBadge(d.pay.payment_status) : '<strong>None</strong>') + '</span>' +
        '</div>' +
        (canCancel ? '<div><button type="button" class="btn btn-danger" data-cancel="' + b.booking_id + '">Cancel booking ' + ref(b.booking_id) + '</button></div>' : '') +
      '</article>';
    }).join('') + '</div>';
  }

  function cancelBooking(id) {
    var b = db.booking.filter(function (x) { return x.booking_id === id; })[0];
    if (!b || b.status !== 'Confirmed') return;
    b.status = 'Cancelled';
    var refunded = false;
    db.payment.forEach(function (p) {
      if (p.booking_id === id && p.payment_status === 'Paid') { p.payment_status = 'Refunded'; refunded = true; }
    });
    saveDb();
    $('#mine-status').textContent = 'Booking ' + ref(id) + ' cancelled.' + (refunded ? ' The payment is marked as refunded.' : '');
    renderMine();
    renderResults();
  }

  /* ---------- Staff view ---------- */

  function renderStaff() {
    $('#staff-ci').value = state.staff.ci;
    $('#staff-co').value = state.staff.co;
    var err = $('#staff-error');
    var s = state.staff;

    var grid = $('#staff-rooms');
    if (!s.ci || !s.co || s.co <= s.ci) {
      err.textContent = 'Choose a start date and an end date after it.';
      grid.innerHTML = '';
    } else {
      err.textContent = '';
      var blocked = blockedRoomIds(db, s.ci, s.co);
      grid.innerHTML = db.room.map(function (r) {
        var t = typeOf(db, r);
        var cls = 'room';
        var line;
        if (r.status !== 'Available') {
          cls += ' off';
          line = 'Closed for maintenance';
        } else if (blocked[r.room_id]) {
          cls += ' taken';
          var b = db.booking.filter(function (x) { return x.booking_id === blocked[r.room_id]; })[0];
          var g = db.guest.filter(function (x) { return x.guest_id === b.guest_id; })[0];
          line = 'Booked by ' + g.first_name + ' ' + g.last_name + ' (' + ref(b.booking_id) + ')';
        } else {
          line = 'Free for these dates';
        }
        return '<div class="' + cls + '">' +
          '<strong>Room ' + esc(r.room_number) + '</strong>' +
          '<span>' + esc(t.type_name) + ', floor ' + r.floor + '</span>' +
          '<small>' + esc(line) + '</small>' +
          '<button type="button" class="link-btn" data-room="' + r.room_id + '">' +
            (r.status === 'Available' ? 'Close for maintenance' : 'Reopen room') + '</button>' +
        '</div>';
      }).join('');
    }

    var rows = db.booking.slice().sort(function (a, b) { return a.check_in < b.check_in ? -1 : 1; });
    $('#staff-bookings').innerHTML =
      '<thead><tr><th>Ref</th><th>Guest</th><th>Rooms</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Payment</th></tr></thead><tbody>' +
      rows.map(function (b) {
        var g = db.guest.filter(function (x) { return x.guest_id === b.guest_id; })[0];
        var d = bookingDetails(b);
        return '<tr><td>' + ref(b.booking_id) + '</td><td>' + esc(g.first_name + ' ' + g.last_name) + '</td><td>' +
          esc(d.rooms.join(', ')) + '</td><td>' + fmtDate(b.check_in) + '</td><td>' + fmtDate(b.check_out) + '</td><td>' +
          statusBadge(b.status) + '</td><td>' + (d.pay ? statusBadge(d.pay.payment_status) : 'None') + '</td></tr>';
      }).join('') + '</tbody>';

    $('#staff-db').innerHTML = TABLES.map(function (name) {
      var data = db[name];
      var cols = data.length ? Object.keys(data[0]) : [];
      return '<details><summary>' + name + ' (' + plural(data.length, 'row', 'rows') + ')</summary>' +
        '<div class="tbl-wrap"><table><thead><tr>' +
        cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        data.map(function (row) {
          return '<tr>' + cols.map(function (c) { return '<td>' + esc(row[c]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div></details>';
    }).join('');
  }

  /* ---------- Events ---------- */

  function bind() {
    document.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-view]');
      if (nav) { e.preventDefault(); showView(nav.dataset.view); return; }

      var step = e.target.closest('.step');
      if (step) {
        var id = Number(step.dataset.type);
        var delta = Number(step.dataset.delta);
        state.sel[id] = Math.max(0, (state.sel[id] || 0) + delta);
        renderResults('.step[data-type="' + id + '"][data-delta="' + delta + '"]');
        return;
      }

      var cancel = e.target.closest('[data-cancel]');
      if (cancel) { cancelBooking(Number(cancel.dataset.cancel)); return; }

      var room = e.target.closest('[data-room]');
      if (room) {
        var r = db.room.filter(function (x) { return x.room_id === Number(room.dataset.room); })[0];
        if (r) {
          r.status = r.status === 'Available' ? 'Maintenance' : 'Available';
          saveDb();
          renderStaff();
          renderResults();
        }
        return;
      }

      if (e.target.id === 'search-again') {
        showView('book');
        renderResults();
      }
    });

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var s = {
        ci: $('#ci').value,
        co: $('#co').value,
        guests: parseInt($('#guests').value, 10)
      };
      var err = validateSearch(s);
      $('#search-error').textContent = err;
      if (err) return;
      state.search = s;
      state.sel = {};
      renderResults();
      $('#results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#continue-btn').addEventListener('click', function () {
      if (validateSearch(state.search)) return;
      renderCheckoutSummary();
      $('#tx-failure').hidden = true;
      showView('checkout');
    });

    $('#back-to-book').addEventListener('click', function () { showView('book'); });

    $('#checkout-form').addEventListener('submit', onCheckoutSubmit);
    $$('input[name="method"]').forEach(function (r) { r.addEventListener('change', toggleCardField); });

    $('#confirm-mine').addEventListener('click', function () { showView('mine'); });
    $('#confirm-again').addEventListener('click', function () { showView('book'); });

    $('#mine-form').addEventListener('submit', function (e) {
      e.preventDefault();
      state.mineEmail = $('#mine-email').value.trim();
      $('#mine-status').textContent = '';
      renderMine();
    });

    $('#staff-ci').addEventListener('change', function () { state.staff.ci = this.value; renderStaff(); });
    $('#staff-co').addEventListener('change', function () { state.staff.co = this.value; renderStaff(); });

    $('#reset-demo').addEventListener('click', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      db = seed();
      saveDb();
      state.sel = {};
      state.mineEmail = '';
      renderResults();
      renderMine();
      renderStaff();
      $('#global-status').textContent = 'Demo data reset.';
      setTimeout(function () { $('#global-status').textContent = ''; }, 3000);
    });
  }

  /* ---------- Start ---------- */

  function init() {
    var today = todayISO();
    $('#ci').min = today;
    $('#co').min = today;
    $('#ci').value = state.search.ci;
    $('#co').value = state.search.co;
    $('#guests').value = state.search.guests;
    $('#mine-email').value = '';
    toggleCardField();
    bind();
    renderResults();

    var hash = location.hash.replace('#', '');
    showView(['mine', 'staff'].indexOf(hash) !== -1 ? hash : 'book');
  }

  init();
})();
