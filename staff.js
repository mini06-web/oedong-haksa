/* 김해외동초 ⑤ 전담 배정 짜기 계산 (화면 없음, 브라우저·Node 공용). 화면은 staffui.js
 * 학사일정 자료의 state.ext.staff 에 둔다(학사일정과 함께 시트에 저장, 새 Apps Script 필요 없음).
 *  staff = { classes:{학년:학급 수}, published:bool,
 *            teachers:[{ id, name, kind:'specialist'|'sports', note, min, max,
 *                        items:[{ grade, subject, n(맡는 학급 수), h1, h2(학급당 주당 시간) }] }] }
 * 요일·교시 칸 배치는 하지 않는다(담임·전담 탭 편집기에서 사람이 함). 공식 시수와 무관.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./timetable.js'));
  else root.Staff = factory(root.Timetable);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  var GRADES = [1, 2, 3, 4, 5, 6];

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function int(v, lo, hi) { v = Math.round(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
  function optInt(v) { if (v === '' || v == null) return null; v = Math.round(+v); return isFinite(v) && v >= 0 && v <= 60 ? v : null; }

  function empty() { var c = {}; GRADES.forEach(function (g) { c[g] = 0; }); return { classes: c, published: false, teachers: [] }; }

  // 받은 자료를 검사해 안전한 모양으로
  function sanitize(src) {
    if (!src || typeof src !== 'object') return null;
    var s = empty(), ids = {};
    GRADES.forEach(function (g) { s.classes[g] = int(src.classes && src.classes[g], 0, 20); });
    s.published = src.published === true;
    (Array.isArray(src.teachers) ? src.teachers : []).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var name = clean(t.name).slice(0, 30), id = clean(t.id).slice(0, 30) || name;
      if (!id || ids[id]) return; ids[id] = 1;
      s.teachers.push({
        id: id, name: name || id, kind: t.kind === 'sports' ? 'sports' : 'specialist', note: clean(t.note).slice(0, 40),
        min: optInt(t.min), max: optInt(t.max),
        items: (Array.isArray(t.items) ? t.items : []).filter(function (x) { return x && GRADES.indexOf(+x.grade) >= 0; }).map(function (x) {
          return { grade: +x.grade, subject: clean(x.subject).slice(0, 12), n: int(x.n, 0, 20), h1: int(x.h1, 0, 10), h2: int(x.h2, 0, 10) };
        })
      });
    });
    return s;
  }
  function of(state) { return sanitize(state && state.ext && state.ext.staff); }
  function put(state, staff) { var s = clone(state); s.ext = s.ext || {}; if (staff) s.ext.staff = clone(staff); else delete s.ext.staff; return s; }

  // ---------- 시간표에서 불러오기 ----------
  // 학기 시간표의 전담 배정을 교사·학년·과목 줄로 묶는다. 학급당 주당 시간은 가장 흔한 값(같으면 큰 값)
  function fromTimetable(tt) {
    var s = empty(), per = {}, order = [];
    tt.classes.forEach(function (c) { s.classes[c.grade] = (s.classes[c.grade] || 0) + 1; });
    [1, 2].forEach(function (sem) {
      var sd = tt.sem[sem]; if (!sd) return;
      tt.classes.forEach(function (c) {
        (sd.assign[c.cls] || []).forEach(function (row, d) {
          row.forEach(function (tid, p) {
            var subj = (sd.subjects[c.cls] && sd.subjects[c.cls][d]) || [];
            if (!tid || p >= subj.length) return;
            var k = tid + '|' + c.grade + '|' + (subj[p] || '?');
            if (!per[k]) { per[k] = { 1: {}, 2: {} }; order.push(k); }
            per[k][sem][c.cls] = (per[k][sem][c.cls] || 0) + 1;
          });
        });
      });
    });
    function mode(m) {
      var cnt = {}, best = 0, bc = 0;
      Object.keys(m).forEach(function (cls) { var v = m[cls]; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc || (cnt[v] === bc && v > best)) { best = v; bc = cnt[v]; } });
      return best;
    }
    s.teachers = tt.teachers.map(function (t) {
      return { id: t.id, name: t.name, kind: t.kind, note: /^\d/.test(t.desc) ? '' : t.desc, min: null, max: null, items: [] };
    });
    var byId = {}; s.teachers.forEach(function (t) { byId[t.id] = t; });
    order.sort(function (a, b) { var x = a.split('|'), y = b.split('|'); return (+x[1]) - (+y[1]); });
    order.forEach(function (k) {
      var x = k.split('|'), t = byId[x[0]]; if (!t) return;
      var n = Math.max(Object.keys(per[k][1]).length, Object.keys(per[k][2]).length);
      t.items.push({ grade: +x[1], subject: x[2], n: n, h1: mode(per[k][1]), h2: mode(per[k][2]) });
    });
    return s;
  }

  // ---------- 계산 ----------
  // 교사의 학기 주당 합계
  function load(t, sem) { return t.items.reduce(function (a, x) { return a + x.n * x['h' + sem]; }, 0); }
  // 목표 범위 판정: 'none'(범위 없음) | 'low' | 'high' | 'ok'
  function range(t, sem) {
    var v = load(t, sem);
    if (t.min == null && t.max == null) return 'none';
    if (t.min != null && v < t.min) return 'low';
    if (t.max != null && v > t.max) return 'high';
    return 'ok';
  }
  // '3,4체육 + 5실과 + 6도덕' (과목별로 학년을 모음, 처음 나온 순서)
  function describe(t) {
    var subj = [], gs = {};
    t.items.forEach(function (x) {
      if (!x.n || !(x.h1 || x.h2)) return;
      if (!gs[x.subject]) { gs[x.subject] = []; subj.push(x.subject); }
      if (gs[x.subject].indexOf(x.grade) < 0) gs[x.subject].push(x.grade);
    });
    var d = subj.map(function (s) { return gs[s].sort().join(',') + s; }).join(' + ');
    return t.note && d ? d + ' · ' + t.note : d || t.note;
  }

  // 학년별 요약: [{ grade, classes, subjects:[{ subject, teacher, n, h1, h2 }], avg1, avg2 }]  avg = 학급당 평균 전담 시간
  function grades(staff) {
    return GRADES.map(function (g) {
      var rows = [], sum = { 1: 0, 2: 0 };
      staff.teachers.forEach(function (t) {
        t.items.forEach(function (x) {
          if (x.grade !== g) return;
          rows.push({ subject: x.subject, teacher: t.name, kind: t.kind, n: x.n, h1: x.h1, h2: x.h2 });
          if (t.kind === 'specialist') { sum[1] += x.n * x.h1; sum[2] += x.n * x.h2; }
        });
      });
      var c = staff.classes[g] || 0;
      return { grade: g, classes: c, subjects: rows, avg1: c ? sum[1] / c : 0, avg2: c ? sum[2] / c : 0 };
    });
  }

  // 점검: [{ level:'bad'|'warn'|'info', teacher?, msg }]
  function checks(staff) {
    var out = [], cover = {};
    function add(level, msg, teacher) { out.push({ level: level, msg: msg, teacher: teacher || null }); }
    staff.teachers.forEach(function (t) {
      [1, 2].forEach(function (sem) {
        var r = range(t, sem), v = load(t, sem);
        if (r === 'low') add('warn', t.name + ' ' + sem + '학기 주당 ' + v + '시간: 목표(' + t.min + '시간 이상)보다 적음', t.id);
        if (r === 'high') add('warn', t.name + ' ' + sem + '학기 주당 ' + v + '시간: 목표(' + t.max + '시간 이하)보다 많음', t.id);
      });
      if (!t.items.length) add('info', t.name + ': 맡은 수업이 없습니다', t.id);
      t.items.forEach(function (x) {
        if (!x.subject) add('warn', t.name + ' ' + x.grade + '학년: 과목 이름이 비어 있습니다', t.id);
        if (!(staff.classes[x.grade] > 0)) add('bad', t.name + ' ' + x.grade + '학년 ' + x.subject + ': 이 학년 학급 수가 0입니다', t.id);
        if (x.n && !x.h1 && !x.h2) add('info', t.name + ' ' + x.grade + '학년 ' + x.subject + ': 주당 시간이 0입니다', t.id);
        // 과학 학기 교차 편성(timetable.js 와 같은 규칙)
        var r1 = T.SCIENCE_RULE[1][x.grade], r2 = T.SCIENCE_RULE[2][x.grade];
        if (/과학/.test(x.subject) && r1 != null && x.n && (x.h1 !== r1 || x.h2 !== r2))
          add('warn', t.name + ' ' + x.grade + '학년 과학: 1학기 ' + x.h1 + '·2학기 ' + x.h2 + '시간 → 교차 편성 규칙은 ' + r1 + '·' + r2 + '시간', t.id);
        var all = staff.classes[x.grade] || 0;
        if (all && x.n > all) add('bad', t.name + ' ' + x.grade + '학년 ' + x.subject + ': ' + x.n + '학급 배정 → 학급 수(' + all + ')보다 많음', t.id);
        // 한 과목을 두 사람이 시간을 나눠 같은 학급을 맡을 수 있으므로(영어 2+2 등) 학급 수는 합치지 않고 가장 많은 쪽으로 봄
        var k = x.grade + '|' + x.subject; cover[k] = cover[k] || { grade: x.grade, subject: x.subject, n: 0 };
        cover[k].n = Math.max(cover[k].n, x.n);
      });
    });
    Object.keys(cover).forEach(function (k) {
      var c = cover[k], all = staff.classes[c.grade] || 0;
      if (all && c.n && c.n < all) add('info', c.grade + '학년 ' + c.subject + ': ' + all + '학급 중 ' + c.n + '학급만 전담(나머지는 담임)');
    });
    return out;
  }

  // ---------- 시간표(담임·전담 탭)와 맞추기 ----------
  // 시간표의 교사 목록에 반영: 같은 id 는 이름·설명·종류를 바꾸고, 없는 교사는 더함. 계획에 없는 교사는 둠(칸 배정이 있을 수 있음)
  function applyToTimetable(ttIn, staff) {
    var tt = clone(ttIn), added = [], updated = [], map = {};
    tt.teachers.forEach(function (t) { map[t.id] = t; });
    staff.teachers.forEach(function (s) {
      var d = { id: s.id, name: s.name, desc: describe(s).slice(0, 60), kind: s.kind };
      if (map[s.id]) { var t = map[s.id]; if (t.name !== d.name || t.desc !== d.desc || t.kind !== d.kind) updated.push(s.name); t.name = d.name; t.desc = d.desc; t.kind = d.kind; }
      else { tt.teachers.push(d); map[s.id] = d; added.push(s.name); }
    });
    var kept = tt.teachers.filter(function (t) { return !staff.teachers.some(function (s) { return s.id === t.id; }); }).map(function (t) { return t.name; });
    var counts = {}; tt.classes.forEach(function (c) { counts[c.grade] = (counts[c.grade] || 0) + 1; });
    var classDiff = GRADES.filter(function (g) { return (counts[g] || 0) !== (staff.classes[g] || 0); })
      .map(function (g) { return g + '학년 계획 ' + (staff.classes[g] || 0) + '학급 · 시간표 ' + (counts[g] || 0) + '학급'; });
    return { tt: tt, added: added, updated: updated, kept: kept, classDiff: classDiff };
  }
  // 계획과 시간표 칸 배치 비교: { 교사id: { 1:{plan,actual}, 2:{plan,actual} } }
  function versus(staff, tt) {
    var out = {}, w = { 1: T.weekly(tt, 1), 2: T.weekly(tt, 2) };
    staff.teachers.forEach(function (t) {
      out[t.id] = {};
      [1, 2].forEach(function (sem) {
        var m = w[sem][t.id] || {};
        out[t.id][sem] = { plan: load(t, sem), actual: Object.keys(m).reduce(function (a, c) { return a + m[c]; }, 0) };
      });
    });
    return out;
  }
  function newTeacher(staff) {
    var i = staff.teachers.length + 1, ids = {}; staff.teachers.forEach(function (t) { ids[t.id] = 1; });
    while (ids['새 교사' + i]) i++;
    return { id: '새 교사' + i, name: '새 교사' + i, kind: 'specialist', note: '', min: null, max: null, items: [] };
  }

  return {
    GRADES: GRADES, empty: empty, sanitize: sanitize, of: of, put: put, fromTimetable: fromTimetable,
    load: load, range: range, describe: describe, grades: grades, checks: checks,
    applyToTimetable: applyToTimetable, versus: versus, newTeacher: newTeacher
  };
});
