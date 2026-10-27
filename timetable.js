/* 시간표 계산 모듈 (화면 없음, 브라우저·Node 공용) — 김해외동초 2단계
 * engine.js 의 build() 결과(날짜별 학년 교시)에 학급 시간표를 대입해
 * 학급별 담임 시수와 전담 교사별 시수, 공휴일·행사로 빠진 전담 수업을 계산한다.
 * 공식 판정(수업일수·학년군 시수)은 engine.js 가 학년 단위로 한다. 여기서 바꾸지 않는다.
 *
 * 시간표 자료(tt):
 *  { version, importedAt, source,
 *    teachers: [{ id, name, desc, kind:'specialist'|'sports' }],   // 전담·강사. id = 이름
 *    classes:  [{ cls:'3-1', grade:3, teacher:'담임 이름' }],
 *    sem: { 1: { subjects:{ cls:[[과목…](월)…(금)] }, assign:{ cls:[[교사id|''] x6] x5 } }, 2: {…} } }
 *  subjects[cls][요일]의 길이 = 그날 교시 수. assign 이 '' 이면 담임 수업.
 *  kind 'sports'(스포츠강사)는 공식적으로 담임 수업으로 센다(따로 sports 로도 집계: 3단계 내부 비교용).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timetable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['월', '화', '수', '목', '금'];
  var MAXP = 6;   // 하루 최대 교시(시간표 칸 수)
  var GRADES = [1, 2, 3, 4, 5, 6];
  // 과학 전담 학기별 교차 편성(주당 전담 시간): 1학기 3·5학년 3, 4·6학년 2 / 2학기 반대
  var SCIENCE_RULE = { 1: { 3: 3, 4: 2, 5: 3, 6: 2 }, 2: { 3: 2, 4: 3, 5: 2, 6: 3 } };

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function emptyAssign() { var a = []; for (var d = 0; d < 5; d++) { var row = []; for (var p = 0; p < MAXP; p++) row.push(''); a.push(row); } return a; }
  var LUNCH = /^점 ?심$/;
  var CLASS_RE = /^([1-6])-(\d{1,2})$/;

  // ---------- 게시판 시트 읽기 ----------
  // rows: 시트 값(2차원 배열, 문자열). 「기초시간표, 전담시간표」 탭 모양을 해석한다.
  function parseBoard(rowsIn) {
    var rows = (rowsIn || []).map(function (r) { return (r || []).map(clean); });
    var warnings = [];
    function cell(r, c) { return (rows[r] || [])[c] || ''; }

    // 1) 기초시간표: 월~금이 모두 있는 첫 줄이 요일 머리줄
    var hdr = -1;
    for (var i = 0; i < rows.length && hdr < 0; i++) if (DAYS.every(function (d) { return rows[i].indexOf(d) >= 0; })) hdr = i;
    if (hdr < 0) throw new Error('기초시간표의 요일(월~금) 머리줄을 찾지 못했습니다');
    var starts = DAYS.map(function (d) { return rows[hdr].indexOf(d); });
    var ends = starts.map(function (s, k) {
      if (k < 4) return starts[k + 1] - 1;
      var e = s; // 마지막 요일: 아래 두 줄(교시 표시)의 마지막 칸까지
      for (var r = hdr + 1; r <= hdr + 2; r++) for (var c = s; c <= s + 8; c++) if (cell(r, c)) e = Math.max(e, c);
      return e;
    });

    // 2) 학급 줄
    var classes = [], rowOf = {};
    rows.forEach(function (r, idx) {
      if (idx <= hdr) return;
      var m = CLASS_RE.exec(r[0] || ''); if (!m || rowOf[r[0]] != null) return;
      rowOf[r[0]] = idx;
      classes.push({ cls: r[0], grade: +m[1], teacher: r[1] || '' });
    });
    if (!classes.length) throw new Error('학급(1-1 같은) 줄을 찾지 못했습니다');

    // 3) 학년·요일별 점심 칸 위치(같은 학년은 점심 칸이 합쳐져 있어 첫 학급에만 글자가 있다)
    var lunch = {};
    GRADES.forEach(function (g) {
      lunch[g] = DAYS.map(function (_, d) {
        var found = -1;
        classes.filter(function (c) { return c.grade === g; }).forEach(function (c) {
          if (found >= 0) return;
          for (var col = starts[d]; col <= ends[d]; col++) if (LUNCH.test(cell(rowOf[c.cls], col))) { found = col - starts[d]; break; }
        });
        return found;
      });
    });

    var subjects = {};
    classes.forEach(function (c) {
      subjects[c.cls] = DAYS.map(function (dn, d) {
        var out = [], lo = lunch[c.grade][d];
        if (lo < 0) warnings.push(c.cls + ' ' + dn + '요일: 점심 칸을 찾지 못해 모든 칸을 교시로 셌습니다');
        for (var col = starts[d]; col <= ends[d]; col++) {
          if (col - starts[d] === lo) continue;
          var v = cell(rowOf[c.cls], col);
          out.push(LUNCH.test(v) ? '' : v);
        }
        while (out.length && !out[out.length - 1]) out.pop();
        if (out.some(function (v) { return !v; })) warnings.push(c.cls + ' ' + dn + '요일: 중간에 빈 교시가 있습니다');
        if (out.length > MAXP) { warnings.push(c.cls + ' ' + dn + '요일: ' + out.length + '교시는 ' + MAXP + '교시까지만 씁니다'); out = out.slice(0, MAXP); }
        return out;
      });
    });

    // 4) 전담시간표: '요일 시간' 칸이 있는 줄, 그 위 줄에 교사 이름표, 아래 줄들이 1교시~
    var teachers = [], assign = {};
    classes.forEach(function (c) { assign[c.cls] = emptyAssign(); });
    var sr = -1, sc = -1;
    for (var r2 = hdr + 1; r2 < rows.length && sr < 0; r2++) for (var c2 = 0; c2 < rows[r2].length; c2++) if (/요일/.test(rows[r2][c2]) && /시간/.test(rows[r2][c2])) { sr = r2; sc = c2; break; }
    if (sr < 0) warnings.push('전담시간표(요일·시간 머리줄)를 찾지 못했습니다. 모두 담임 수업으로 계산합니다');
    else {
      rows[sr].forEach(function (v, col) {
        if (v !== '월' || col <= sc) return;
        var label = '';
        for (var k = col; k < col + 5 && !label; k++) label = cell(sr - 1, k);
        if (!label) { warnings.push((col + 1) + '번째 열 전담시간표에 교사 이름표가 없습니다'); return; }
        var t = parseTeacher(label);
        if (teachers.some(function (x) { return x.id === t.id; })) t.id = t.name = t.name + '(' + (teachers.length + 1) + ')';
        teachers.push(t);
        for (var r3 = sr + 1; r3 < rows.length; r3++) {
          var pm = /^(\d)교시$/.exec(cell(r3, sc)); if (!pm) break;
          var p = +pm[1] - 1; if (p >= MAXP) continue;
          for (var d = 0; d < 5; d++) {
            cell(r3, col + d).split(/[^0-9-]+/).filter(function (x) { return CLASS_RE.test(x); }).forEach(function (cls) {
              var where = DAYS[d] + ' ' + (p + 1) + '교시';
              if (!assign[cls]) { warnings.push(t.name + ' ' + where + ': ' + cls + '반이 기초시간표에 없습니다'); return; }
              if (assign[cls][d][p]) { warnings.push(cls + ' ' + where + ': ' + assign[cls][d][p] + '·' + t.name + ' 두 사람에게 배정되어 앞사람만 씁니다'); return; }
              if (!subjects[cls][d][p]) warnings.push(cls + ' ' + where + ': 기초시간표에 수업이 없는데 ' + t.name + ' 전담이 배정되어 있습니다');
              assign[cls][d][p] = t.id;
            });
          }
        }
      });
    }
    return { teachers: teachers, classes: classes, subjects: subjects, assign: assign, warnings: warnings };
  }

  // '3,4체육 + 5실과 + 6도덕(홍길동)' → { id:'홍길동', name, desc:'3,4체육 + 5실과 + 6도덕', kind }
  function parseTeacher(label) {
    var m = /^(.*)\(([^()]+)\)\s*$/.exec(label);
    var name = clean(m ? m[2] : label), desc = clean(m ? m[1] : '');
    return { id: name, name: name, desc: desc, kind: /스포츠/.test(label) ? 'sports' : 'specialist' };
  }

  // 게시판에서 읽은 것을 학기 시간표로. which: 'both' | 1 | 2. 다른 학기는 prev 에서 유지
  function fromBoard(parsed, prev, which, at) {
    var tt = prev ? clone(prev) : { version: 1, sem: {} };
    tt.version = 1; tt.importedAt = at || new Date().toISOString(); tt.source = '외동 게시판';
    // 교사·학급 목록은 합친다(이전 학기 시간표에 쓰인 교사가 사라지지 않게)
    var tmap = {}; (tt.teachers || []).forEach(function (t) { tmap[t.id] = t; });
    parsed.teachers.forEach(function (t) { tmap[t.id] = clone(t); });
    tt.teachers = Object.keys(tmap).map(function (k) { return tmap[k]; });
    tt.classes = clone(parsed.classes);
    tt.sem = tt.sem || {};
    (which === 'both' || !which ? [1, 2] : [+which]).forEach(function (s) {
      tt.sem[s] = { subjects: clone(parsed.subjects), assign: clone(parsed.assign) };
    });
    [1, 2].forEach(function (s) { if (!tt.sem[s]) tt.sem[s] = { subjects: clone(parsed.subjects), assign: clone(parsed.assign) }; });
    return tt;
  }

  // 받은 자료를 검사해 안전한 모양으로(형식이 틀린 값은 버림)
  function sanitize(src) {
    if (!src || typeof src !== 'object' || !src.sem) return null;
    var tt = { version: 1, importedAt: typeof src.importedAt === 'string' ? src.importedAt : '', source: clean(src.source).slice(0, 40), teachers: [], classes: [], sem: {} };
    var ids = {};
    (Array.isArray(src.teachers) ? src.teachers : []).forEach(function (t) {
      var id = clean(t && t.id).slice(0, 30); if (!id || ids[id]) return; ids[id] = 1;
      tt.teachers.push({ id: id, name: clean(t.name).slice(0, 30) || id, desc: clean(t.desc).slice(0, 60), kind: t.kind === 'sports' ? 'sports' : 'specialist' });
    });
    var seen = {};
    (Array.isArray(src.classes) ? src.classes : []).forEach(function (c) {
      var m = CLASS_RE.exec(clean(c && c.cls)); if (!m || seen[c.cls]) return; seen[c.cls] = 1;
      tt.classes.push({ cls: c.cls, grade: +m[1], teacher: clean(c.teacher).slice(0, 30) });
    });
    [1, 2].forEach(function (s) {
      var x = src.sem[s] || src.sem[String(s)] || {}, subj = {}, asg = {};
      tt.classes.forEach(function (c) {
        var sd = x.subjects && x.subjects[c.cls], ad = x.assign && x.assign[c.cls];
        subj[c.cls] = DAYS.map(function (_, d) { return (Array.isArray(sd) && Array.isArray(sd[d]) ? sd[d] : []).slice(0, MAXP).map(function (v) { return clean(v).slice(0, 12); }); });
        asg[c.cls] = emptyAssign();
        DAYS.forEach(function (_, d) { for (var p = 0; p < MAXP; p++) { var v = Array.isArray(ad) && Array.isArray(ad[d]) ? clean(ad[d][p]) : ''; asg[c.cls][d][p] = ids[v] ? v : ''; } });
      });
      tt.sem[s] = { subjects: subj, assign: asg };
    });
    return tt;
  }

  // ---------- 요일별 교시(기준 시수 자동 채움) ----------
  // { periods:{학년:[월~금]}, mismatch:[문장] }  같은 학년 학급끼리 다르면 첫 학급 기준 + 안내
  function gradePeriods(tt, sem) {
    var out = {}, mismatch = [];
    GRADES.forEach(function (g) {
      var cs = tt.classes.filter(function (c) { return c.grade === g; });
      if (!cs.length) return;
      var first = DAYS.map(function (_, d) { return tt.sem[sem].subjects[cs[0].cls][d].length; });
      out[g] = first;
      cs.slice(1).forEach(function (c) {
        var mine = DAYS.map(function (_, d) { return tt.sem[sem].subjects[c.cls][d].length; });
        if (mine.join() !== first.join()) mismatch.push(sem + '학기 ' + c.cls + ' 요일별 교시(' + mine.join('·') + ')가 ' + cs[0].cls + '(' + first.join('·') + ')와 다릅니다');
      });
    });
    return { periods: out, mismatch: mismatch };
  }

  // ---------- 날짜별 대입 ----------
  function inVacation(date, d) {
    return (d.summerStart && d.summerEnd && date > d.summerStart && date < d.summerEnd) ||
      (d.winterStart && d.winterEnd && date > d.winterStart && date < d.winterEnd);
  }
  function zero() { return { sem1: 0, sem2: 0, total: 0 }; }
  function add(o, sem, n) { o['sem' + sem] += n; o.total += n; }

  // result: Engine.build() 결과. 반환:
  //  classes[cls] = { cls, grade, teacher, homeroom, sports, extra, specialist:{교사id:{sem1,sem2,total}}, specialistSum, total, months:{ym:{homeroom,specialist}} }
  //  teachers[id] = { …교사, hours, byClass:{cls:{sem1,sem2,total}}, lost }
  //  dropped = [{ date, sem, cls, period, teacher, kind, reason, why:'holiday'|'short' }]
  function compute(result, tt) {
    var st = result.state, out = { classes: {}, teachers: {}, dropped: [], mismatch: [] };
    var tmap = {}; tt.teachers.forEach(function (t) { tmap[t.id] = t; out.teachers[t.id] = Object.assign(clone(t), { hours: zero(), byClass: {}, lost: zero() }); });
    tt.classes.forEach(function (c) {
      out.classes[c.cls] = { cls: c.cls, grade: c.grade, teacher: c.teacher, homeroom: zero(), sports: zero(), extra: zero(), specialist: {}, specialistSum: zero(), total: zero(), months: {} };
    });
    if (!result.ready) return out;
    var seenMismatch = {};
    result.days.forEach(function (day) {
      if (day.dow < 1 || day.dow > 5 || !day.sem) return;
      var di = day.dow - 1, sem = day.sem, sd = tt.sem[sem];
      if (day.status === 'holiday' || day.status === 'closure') {
        if (inVacation(day.date, st.dates)) return; // 방학 중 공휴일은 원래 수업이 없음
        tt.classes.forEach(function (c) {
          sd.assign[c.cls][di].forEach(function (tid, p) {
            if (!tid || p >= sd.subjects[c.cls][di].length) return;
            lose(day, c, p, tid, 'holiday', day.labels.join(', ') || (day.status === 'closure' ? '휴업일' : '공휴일'));
          });
        });
        return;
      }
      if (day.status !== 'school') return;
      tt.classes.forEach(function (c) {
        var o = out.classes[c.cls], n = day.periods[c.grade] || 0, m = sd.subjects[c.cls][di].length;
        var ym = day.date.slice(0, 7), mo = o.months[ym] = o.months[ym] || { homeroom: 0, specialist: 0 };
        for (var p = 0; p < n; p++) {
          var tid = p < m ? sd.assign[c.cls][di][p] : '', t = tid && tmap[tid];
          add(o.total, sem, 1);
          if (t && t.kind === 'specialist') {
            o.specialist[tid] = o.specialist[tid] || zero(); add(o.specialist[tid], sem, 1); add(o.specialistSum, sem, 1); mo.specialist++;
            var th = out.teachers[tid]; add(th.hours, sem, 1); th.byClass[c.cls] = th.byClass[c.cls] || zero(); add(th.byClass[c.cls], sem, 1);
          } else {
            add(o.homeroom, sem, 1); mo.homeroom++;
            if (t && t.kind === 'sports') {
              add(o.sports, sem, 1);
              var ts = out.teachers[tid]; add(ts.hours, sem, 1); ts.byClass[c.cls] = ts.byClass[c.cls] || zero(); add(ts.byClass[c.cls], sem, 1);
            }
            if (p >= m) add(o.extra, sem, 1);
          }
        }
        // 행사 등으로 교시가 줄어든 날: 뒤쪽 교시부터 빠진 것으로 본다
        for (var q = n; q < m; q++) { var tq = sd.assign[c.cls][di][q]; if (tq) lose(day, c, q, tq, 'short', day.labels.join(', ') || '교시 단축'); }
        var key = sem + ':' + c.grade + ':' + di;
        var base = basePeriodsFor(st, c.grade, sem)[di];
        if (base !== m && !seenMismatch[key]) { seenMismatch[key] = 1; out.mismatch.push({ sem: sem, grade: c.grade, dow: di, base: base, timetable: m }); }
      });
    });
    function lose(day, c, p, tid, why, reason) {
      var t = tmap[tid]; if (!t) return;
      out.dropped.push({ date: day.date, sem: day.sem, cls: c.cls, period: p + 1, teacher: tid, kind: t.kind, why: why, reason: reason });
      add(out.teachers[tid].lost, day.sem, 1);
    }
    Object.keys(out.classes).forEach(function (k) {
      var o = out.classes[k]; o.specialistSum = o.specialistSum || zero();
    });
    return out;
  }
  // engine.basePeriodsFor 와 같은 규칙(엔진에 의존하지 않으려고 복사)
  function basePeriodsFor(state, grade, semester) {
    var row = semester === 2 && state.basePeriods2 && state.basePeriods2[grade];
    return state.basePeriods[grade].map(function (v, i) { return row && row[i] != null ? row[i] : v; });
  }

  // ---------- 주간 점검 ----------
  // 학기 시간표에서 교사·학급별 주당 시간: { 교사id: { cls: n } }
  function weekly(tt, sem) {
    var out = {};
    tt.classes.forEach(function (c) {
      tt.sem[sem].assign[c.cls].forEach(function (row, d) {
        row.forEach(function (tid, p) {
          if (!tid || p >= tt.sem[sem].subjects[c.cls][d].length) return;
          out[tid] = out[tid] || {}; out[tid][c.cls] = (out[tid][c.cls] || 0) + 1;
        });
      });
    });
    return out;
  }
  // 같은 교사가 같은 시간에 두 반: [{ sem, teacher, day, period, classes:[…] }]
  function conflicts(tt, sem) {
    var at = {}, out = [];
    tt.classes.forEach(function (c) {
      tt.sem[sem].assign[c.cls].forEach(function (row, d) {
        row.forEach(function (tid, p) { if (tid) { var k = tid + '|' + d + '|' + p; (at[k] = at[k] || []).push(c.cls); } });
      });
    });
    Object.keys(at).forEach(function (k) {
      if (at[k].length < 2) return;
      var x = k.split('|'); out.push({ sem: sem, teacher: x[0], day: DAYS[+x[1]], period: +x[2] + 1, classes: at[k] });
    });
    return out;
  }
  // 과학 전담 교차 편성 점검: [{ sem, cls, grade, teacher, hours, expected, ok }]
  function scienceCheck(tt) {
    var sci = tt.teachers.filter(function (t) { return t.kind === 'specialist' && /과학/.test(t.desc); });
    var out = [];
    [1, 2].forEach(function (sem) {
      var w = weekly(tt, sem);
      tt.classes.forEach(function (c) {
        var exp = SCIENCE_RULE[sem][c.grade]; if (exp == null) return;
        var t = sci.filter(function (x) { return gradesOf(x.desc).indexOf(c.grade) >= 0; })[0] || sci.filter(function (x) { return w[x.id] && w[x.id][c.cls]; })[0];
        if (!t) return;
        var h = (w[t.id] && w[t.id][c.cls]) || 0;
        out.push({ sem: sem, cls: c.cls, grade: c.grade, teacher: t.id, hours: h, expected: exp, ok: h === exp });
      });
    });
    return out;
  }
  // '5,6 과학' → [5,6]
  function gradesOf(desc) { var m = /^([\d,\s]+)/.exec(desc || ''); return m ? m[1].split(/[,\s]+/).filter(Boolean).map(Number) : []; }

  return {
    DAYS: DAYS, MAXP: MAXP, SCIENCE_RULE: SCIENCE_RULE,
    parseBoard: parseBoard, parseTeacher: parseTeacher, fromBoard: fromBoard, sanitize: sanitize,
    gradePeriods: gradePeriods, compute: compute, weekly: weekly, conflicts: conflicts, scienceCheck: scienceCheck
  };
});
