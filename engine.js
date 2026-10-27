/* 학사일정·수업시수 계산 엔진 (화면 없음, 브라우저·Node 공용)
 * 입력은 state 하나, 나머지(날짜·주별·월별·학년별 시수·판정)는 전부 계산한다.
 * 날짜는 'YYYY-MM-DD' 문자열, 요일 계산은 UTC 기준(시간대 영향 없음).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRADES = [1, 2, 3, 4, 5, 6];
  var GROUP_OF = { 1: '1-2', 2: '1-2', 3: '3-4', 4: '3-4', 5: '5-6', 6: '5-6' };
  var DAY_MS = 86400000;
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

  // 날짜 종류 → 화면 색 구분용 (원본 엑셀 범례와 같은 분류)
  var CATEGORY = {
    ceremony: '행사(입학·개학·방학·졸업)',
    adapt: '입학초기 적응',
    adjust: '시수 증감',
    suneung: '수능',
    closure: '자율휴업일',
    holiday: '공휴일',
    temporary: '임시공휴일'
  };

  // ---------- 날짜 도구 ----------
  function toTime(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function toStr(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return toStr(toTime(s) + n * DAY_MS); }
  function dow(s) { return new Date(toTime(s)).getUTCDay(); }
  function lastDayOfFeb(y) { return toStr(Date.UTC(y, 2, 1) - DAY_MS); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function kd(s) { return (+s.slice(5, 7)) + '.' + (+s.slice(8, 10)) + '.(' + WEEKDAY[dow(s)] + ')'; } // 2.11.(금)
  function kdro(s) { var w = WEEKDAY[dow(s)]; return kd(s) + (w === '금' || w === '목' ? '으로' : '로'); } // 받침(ㄹ 제외) 있으면 '으로'

  // ---------- 기본 설정 ----------
  function defaultState(year) {
    return {
      version: 1,
      year: year,
      school: { name: '' },
      standards: { minDays: 190, groups: { '1-2': 1744, '3-4': 1972, '5-6': 2176 } },
      // 요일별 기준 시수 [월,화,수,목,금]
      basePeriods: {
        1: [4, 5, 4, 5, 5], 2: [4, 5, 4, 5, 5],
        3: [5, 6, 4, 6, 5], 4: [5, 6, 4, 6, 5],
        5: [6, 6, 5, 6, 6], 6: [6, 6, 5, 6, 6]
      },
      // 2학기에 다른 칸만 지정. 빠진 학년·null인 요일은 공통 기준을 따른다.
      basePeriods2: {},
      // 보충 제안 때 넘지 않을 하루 최대 교시
      maxPeriods: { 1: 5, 2: 5, 3: 6, 4: 6, 5: 6, 6: 6 },
      dates: { start: null, summerStart: null, summerEnd: null, winterStart: null, winterEnd: null, end: null },
      suneung: { mode: 'minus1', date: null }, // normal | minus1 | closure, date=null이면 데이터의 수능일
      closures: [],        // {date, name, reason}  자율휴업일·개교기념일 등
      extraHolidays: [],   // {date, name, kind:'temporary'|'holiday'}  임시공휴일·추가 공휴일
      removedHolidays: [], // ['YYYY-MM-DD']  기본 데이터에서 뺄 공휴일
      events: [],          // {date, type, name, reason, periods:{학년:교시}}  빠진 학년은 기준 시수
      prevYear: {},        // {2:870, 4:986, 6:1088}  작년 이수 시수(학년군 둘째 해 판정용)
      targets: {}          // {1:872, ...}  학년군 첫해 목표(없으면 기준의 절반)
    };
  }

  function normalize(state) {
    var base = defaultState(state.year);
    var s = Object.assign(base, clone(state));
    s.dates = Object.assign(defaultState(state.year).dates, s.dates || {});
    s.suneung = Object.assign({ mode: 'minus1', date: null }, s.suneung || {});
    return s;
  }

  // 불러온 파일·브라우저 자료를 검사해 안전한 형태로 만든다(형식이 틀린 값은 버림, 한 날짜에 행사 하나)
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/, EV_TYPES = { ceremony: 1, adapt: 1, adjust: 1 };
  function okDate(x) { return typeof x === 'string' && DATE_RE.test(x) ? x : null; }
  function txt(x, n) { return typeof x === 'string' ? x.slice(0, n || 60) : ''; }
  function int(x, lo, hi) { if (x === null || x === undefined || x === '') return null; var v = Math.round(+x); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; }
  function sanitize(src) {
    src = src || {};
    var y = int(src.year, 2000, 2100) || 2027, s = defaultState(y);
    s.school = { name: txt(src.school && src.school.name, 40) };
    var st = src.standards || {};
    s.standards.minDays = int(st.minDays, 1, 365) || 190;
    ['1-2', '3-4', '5-6'].forEach(function (k) { var v = st.groups && int(st.groups[k], 1, 5000); if (v) s.standards.groups[k] = v; });
    GRADES.forEach(function (g) {
      var b = src.basePeriods && src.basePeriods[g];
      if (Array.isArray(b) && b.length === 5) s.basePeriods[g] = b.map(function (v) { return int(v, 0, 12) || 0; });
      var b2 = src.basePeriods2 && src.basePeriods2[g];
      if (Array.isArray(b2) && b2.length === 5) {
        var row = b2.map(function (v) { return int(v, 0, 12); });
        if (row.some(function (v) { return v !== null; })) s.basePeriods2[g] = row;
      }
      var m = src.maxPeriods && int(src.maxPeriods[g], 1, 12); if (m) s.maxPeriods[g] = m;
    });
    Object.keys(s.dates).forEach(function (k) { s.dates[k] = okDate(src.dates && src.dates[k]); });
    var sm = src.suneung || {};
    s.suneung = { mode: ['normal', 'minus1', 'closure'].indexOf(sm.mode) >= 0 ? sm.mode : 'minus1', date: okDate(sm.date) };
    function uniq(list, map) { var seen = {}; return (Array.isArray(list) ? list : []).filter(function (x) { var d = x && okDate(x.date); if (!d || seen[d]) return false; seen[d] = 1; return true; }).map(map); }
    s.closures = uniq(src.closures, function (c) { return { date: c.date, name: txt(c.name) || '자율휴업일', reason: txt(c.reason, 100) }; });
    s.extraHolidays = uniq(src.extraHolidays, function (h) { return { date: h.date, name: txt(h.name) || '임시공휴일', kind: h.kind === 'holiday' ? 'holiday' : 'temporary' }; });
    s.removedHolidays = (Array.isArray(src.removedHolidays) ? src.removedHolidays : []).filter(okDate);
    // 한 날짜에 행사가 여럿이면 행사(ceremony)를 남기고 이름을 합친다
    var evs = {}, order = [];
    (Array.isArray(src.events) ? src.events : []).forEach(function (e) {
      var d = e && okDate(e.date); if (!d) return;
      var p = {}; GRADES.forEach(function (g) { var v = e.periods && int(e.periods[g], 0, 12); if (v !== null && v !== undefined) p[g] = v; });
      var x = { date: d, type: EV_TYPES[e.type] ? e.type : 'adjust', name: txt(e.name) || '시수 조정', reason: txt(e.reason, 100), periods: p };
      var cur = evs[d];
      if (!cur) { evs[d] = x; order.push(d); return; }
      var keep = cur.type === 'ceremony' || x.type !== 'ceremony' ? cur : x, drop = keep === cur ? x : cur;
      keep.name = keep.name + '·' + drop.name; evs[d] = keep;
    });
    s.events = order.map(function (d) { return evs[d]; });
    [2, 4, 6].forEach(function (g) { var v = src.prevYear && int(src.prevYear[g], 0, 5000); if (v !== null && v !== undefined) s.prevYear[g] = v; });
    [1, 3, 5].forEach(function (g) { var v = src.targets && int(src.targets[g], 0, 5000); if (v !== null && v !== undefined) s.targets[g] = v; });
    var pf = src.prevYearFrom;
    if (pf && int(pf.year, 2000, 2100)) {
      var vals = {}; [2, 4, 6].forEach(function (g) { var v = pf.values && int(pf.values[g], 0, 5000); if (v !== null && v !== undefined) vals[g] = v; });
      s.prevYearFrom = { year: int(pf.year, 2000, 2100), values: vals, confirmed: !!pf.confirmed };
    }
    return s;
  }

  // ---------- 휴일 ----------
  function holidayIndex(state, H) {
    var map = {}, notes = {};
    (H && H.items || []).forEach(function (it) {
      if (it.kind === 'event') { (notes[it.date] = notes[it.date] || []).push(it); return; }
      (map[it.date] = map[it.date] || []).push({ name: it.name, kind: it.kind, sure: it.sure, note: it.note });
    });
    (state.removedHolidays || []).forEach(function (d) { delete map[d]; });
    (state.extraHolidays || []).forEach(function (h) {
      (map[h.date] = map[h.date] || []).push({ name: h.name || '임시공휴일', kind: h.kind || 'temporary', sure: true });
    });
    return { map: map, notes: notes };
  }

  function suneungDate(state, idx) {
    if (state.suneung.date) return state.suneung.date;
    var y = String(state.year);
    for (var d in idx.notes) {
      if (d.slice(0, 4) === y && idx.notes[d].some(function (n) { return n.name === '대학수학능력시험'; })) return d;
    }
    return null;
  }

  function byDate(list) {
    var m = {};
    (list || []).forEach(function (x) { m[x.date] = x; });
    return m;
  }

  // ---------- 달력 만들기 ----------
  function basePeriodsFor(state, grade, semester) {
    var row = semester === 2 && state.basePeriods2 && state.basePeriods2[grade];
    return state.basePeriods[grade].map(function (v, i) { return row && row[i] != null ? row[i] : v; });
  }

  function build(stateIn, H) {
    var state = normalize(stateIn);
    var Y = state.year, d = state.dates;
    var idx = holidayIndex(state, H);
    var closures = byDate(state.closures), events = byDate(state.events);
    var sDate = suneungDate(state, idx);
    var ready = !!(d.start && d.summerStart && d.summerEnd && d.end);
    var bases = { 1: {}, 2: {} };
    GRADES.forEach(function (g) { bases[1][g] = basePeriodsFor(state, g, 1); bases[2][g] = basePeriodsFor(state, g, 2); });
    var days = [];
    var from = Y + '-03-01', to = lastDayOfFeb(Y + 1);

    for (var cur = from; cur <= to; cur = addDays(cur, 1)) {
      var w = dow(cur), hol = idx.map[cur], cl = closures[cur], ev = events[cur];
      var isSuneung = cur === sDate;
      var labels = [];
      if (hol) hol.forEach(function (h) { labels.push(h.name); });
      if (isSuneung) labels.push('수능');
      if (cl) labels.push(cl.name || '자율휴업일');
      if (ev) labels.push(ev.name);

      var status, category = null;
      if (!ready || cur < d.start || cur > d.end) status = 'outside';
      else if (w === 0 || w === 6) status = 'weekend';
      else if (hol) { status = 'holiday'; category = hol.some(function (h) { return h.kind === 'temporary'; }) ? 'temporary' : 'holiday'; }
      else if (cl || (isSuneung && state.suneung.mode === 'closure')) { status = 'closure'; category = 'closure'; }
      else if ((cur > d.summerStart && cur < d.summerEnd) ||
               (d.winterStart && d.winterEnd && cur > d.winterStart && cur < d.winterEnd)) status = 'vacation';
      else status = 'school';

      var sem = ready ? (cur < d.summerEnd ? 1 : 2) : 0;
      var periods = null;
      if (status === 'school') {
        periods = {};
        GRADES.forEach(function (g) {
          var p = bases[sem][g][w - 1];
          if (isSuneung && state.suneung.mode === 'minus1') p = Math.max(0, p - 1);
          if (ev && ev.periods && ev.periods[g] != null) p = +ev.periods[g];
          periods[g] = p;
        });
        if (ev) category = ev.type || 'adjust';
        else if (isSuneung && state.suneung.mode === 'minus1') category = 'suneung';
      }
      days.push({
        date: cur, dow: w, weekday: WEEKDAY[w], status: status, category: category,
        off: w === 0 || w === 6 || !!hol || !!cl || (isSuneung && state.suneung.mode === 'closure'),
        sem: sem,
        labels: labels, periods: periods,
        estimated: (hol || []).some(function (h) { return h.sure === false; }) ||
                   (isSuneung && (idx.notes[cur] || []).some(function (n) { return n.sure === false; }))
      });
    }
    var result = { state: state, ready: ready, days: days, suneungDate: sDate };
    summarize(result);
    result.checks = check(result, H);
    return result;
  }

  // ---------- 합계 ----------
  function emptyHours() { var h = {}; GRADES.forEach(function (g) { h[g] = 0; }); return h; }

  // 방학은 달력상의 날짜 수(주말·공휴일 포함). 방학식·개학일은 제외한다.
  // 1학기: 여름방학, 2학기: 겨울방학 + 종업 다음 날부터 학년도 말까지.
  function vacationDays(state) {
    var d = state.dates, from = state.year + '-03-01', to = lastDayOfFeb(state.year + 1);
    var order = [d.start, d.summerStart, d.summerEnd];
    if (!!d.winterStart !== !!d.winterEnd) return null;
    if (d.winterStart) order.push(d.winterStart, d.winterEnd);
    order.push(d.end);
    if (order.some(function (date, i) {
      return !okDate(date) || !isFinite(toTime(date)) || toStr(toTime(date)) !== date || date < from || date > to || (i > 0 && date < order[i - 1]);
    })) return null;
    var sem1 = Math.max(0, (toTime(d.summerEnd) - toTime(d.summerStart)) / DAY_MS - 1);
    var winter = d.winterStart ? Math.max(0, (toTime(d.winterEnd) - toTime(d.winterStart)) / DAY_MS - 1) : 0;
    var sem2 = winter + (toTime(to) - toTime(d.end)) / DAY_MS;
    return { total: sem1 + sem2, sem1: sem1, sem2: sem2 };
  }

  function summarize(r) {
    var tot = { total: 0, sem1: 0, sem2: 0 };
    var hours = {}; GRADES.forEach(function (g) { hours[g] = { sem1: 0, sem2: 0, total: 0 }; });
    var months = {}, weeks = [], weekMap = {};
    r.days.forEach(function (day) {
      if (day.status !== 'school') return;
      tot.total++; tot['sem' + day.sem]++;
      var ym = day.date.slice(0, 7);
      var m = months[ym] = months[ym] || { ym: ym, days: 0, hours: emptyHours() };
      m.days++;
      var monday = addDays(day.date, 1 - day.dow), friday = addDays(monday, 4), key = monday + ':' + day.sem;
      var wk = weekMap[key];
      if (!wk) {
        // 주의 소속 월 = 금요일이 속한 달 (원본 엑셀 일별 시트 방식). 학기에 걸친 주는 학기별로 나눈다
        wk = weekMap[key] = { monday: monday, friday: friday, month: friday.slice(0, 7), sem: day.sem, days: 0, hours: emptyHours(), last: day.date };
        weeks.push(wk);
      }
      wk.days++; wk.last = day.date;
      GRADES.forEach(function (g) {
        var p = day.periods[g];
        hours[g]['sem' + day.sem] += p; hours[g].total += p;
        m.hours[g] += p; wk.hours[g] += p;
      });
    });
    r.totals = { days: tot, hours: hours, vacationDays: vacationDays(r.state) };
    r.months = Object.keys(months).sort().map(function (k) { return months[k]; });
    var dd = r.state.dates;
    weeks.forEach(function (w) {
      var lo = w.sem === 1 ? dd.start : dd.summerEnd, hi = w.sem === 1 ? dd.summerStart : dd.end;
      if (lo && hi && (w.month < lo.slice(0, 7) || w.month > hi.slice(0, 7))) w.month = w.last.slice(0, 7);
    });
    r.weeks = weeks;
    r.grades = GRADES.map(function (g) {
      var std = r.state.standards.groups[GROUP_OF[g]];
      var total = hours[g].total, row = { grade: g, group: GROUP_OF[g], standard: std, total: total };
      if (g % 2 === 0) { // 학년군 둘째 해: 작년 이수 + 올해 >= 기준
        var prev = r.state.prevYear[g];
        row.prev = prev == null ? null : +prev;
        row.required = prev == null ? null : std - prev;
        row.margin = prev == null ? null : total - row.required;
      } else {            // 학년군 첫해: 내년에 필요한 시수 안내
        row.target = r.state.targets[g] != null ? +r.state.targets[g] : Math.ceil(std / 2);
        row.nextYearNeed = std - total;
        row.margin = total - row.target;
      }
      return row;
    });
  }

  // ---------- 판정 ----------
  function check(r, H) {
    var out = [], s = r.state, d = s.dates;
    function add(level, code, msg, extra) { out.push(Object.assign({ level: level, code: code, msg: msg }, extra || {})); }
    if (!r.ready) { add('error', 'dates-missing', '시업일, 여름방학식, 2학기 개학일, 종업일을 입력하세요.'); return out; }
    if (!!d.winterStart !== !!d.winterEnd) add('error', 'winter-half', '겨울방학식과 겨울 개학일은 둘 다 넣거나 둘 다 비워야 합니다(12월·1월 종업으로 겨울 개학이 없으면 둘 다 비움). 지금은 겨울방학이 수업일로 계산됩니다.');
    var y0 = s.year + '-03-01', y1 = lastDayOfFeb(s.year + 1);
    [['start', '시업일'], ['summerStart', '여름방학식'], ['summerEnd', '2학기 개학일'], ['winterStart', '겨울방학식'], ['winterEnd', '겨울 개학일'], ['end', '종업일']].forEach(function (f) {
      var v = d[f[0]]; if (v && (v < y0 || v > y1)) add('error', 'date-range', f[1] + '(' + v + ')이 학년도(' + y0 + '~' + y1 + ') 밖입니다.', { date: v });
    });
    if (s.suneung.date && (s.suneung.date < y0 || s.suneung.date > y1)) add('warn', 'suneung-range', '직접 지정한 수능일이 학년도 밖이라 적용되지 않습니다.');
    var order = [d.start, d.summerStart, d.summerEnd];
    if (d.winterStart) order.push(d.winterStart);
    if (d.winterEnd) order.push(d.winterEnd);
    order.push(d.end);
    for (var i = 1; i < order.length; i++) if (order[i] < order[i - 1]) { add('error', 'dates-order', '날짜 순서가 맞지 않습니다. 시업 → 여름방학 → 개학 → 겨울방학 → 개학 → 종업 순이어야 합니다.'); break; }

    var dayMap = {}; r.days.forEach(function (x) { dayMap[x.date] = x; });
    [['start', '시업일'], ['summerStart', '여름방학식'], ['summerEnd', '2학기 개학일'], ['winterStart', '겨울방학식'], ['winterEnd', '겨울 개학일'], ['end', '종업일']].forEach(function (f) {
      var v = d[f[0]]; if (v && dayMap[v] && dayMap[v].status !== 'school') add('error', 'date-not-school', f[1] + '(' + v + ')이 수업일이 아닙니다(' + (dayMap[v].labels.join(', ') || dayMap[v].weekday + '요일') + ').', { date: v });
    });

    var min = s.standards.minDays, n = r.totals.days.total;
    if (n < min) add('error', 'days-short', '수업일수 ' + n + '일: 법정 ' + min + '일보다 ' + (min - n) + '일 부족합니다.', { short: min - n });
    else if (n === min) add('warn', 'days-zero-margin', '수업일수 ' + n + '일: 기준과 같아 여유가 없습니다. 하루만 빠져도 미달입니다.');
    else add('ok', 'days-ok', '수업일수 ' + n + '일 (여유 ' + (n - min) + '일)');

    r.grades.forEach(function (g) {
      if (g.grade % 2 === 0) {
        if (g.prev == null) add('warn', 'prev-missing', g.grade + '학년: 작년 이수 시수를 입력해야 학년군 판정을 할 수 있습니다.', { grade: g.grade });
        else if (g.margin < 0) add('error', 'hours-short', g.grade + '학년: ' + g.total + '시간, 최소 ' + g.required + '시간보다 ' + (-g.margin) + '시간 부족 (학년군 기준 ' + g.standard + ' − 작년 ' + g.prev + ')', { grade: g.grade, short: -g.margin });
        else if (g.margin === 0) add('warn', 'hours-zero-margin', g.grade + '학년: ' + g.total + '시간, 최소 시수와 같아 여유가 없습니다.', { grade: g.grade });
        else add('ok', 'hours-ok', g.grade + '학년: ' + g.total + '시간 (여유 ' + g.margin + '시간)', { grade: g.grade });
      } else {
        add(g.margin < 0 ? 'warn' : 'info', 'next-year', g.grade + '학년: ' + g.total + '시간 → 내년(' + (g.grade + 1) + '학년)에 최소 ' + g.nextYearNeed + '시간 필요', { grade: g.grade });
      }
    });

    (s.events || []).forEach(function (e) {
      var x = dayMap[e.date];
      if (!x || x.status !== 'school') add('warn', 'event-not-school', e.date + ' ' + (e.name || '') + ': 수업일이 아니라 시수 조정이 적용되지 않습니다.', { date: e.date });
      if (!e.reason) add('warn', 'event-no-reason', e.date + ' ' + (e.name || '') + ': 시수를 조정한 이유를 적어 주세요.', { date: e.date });
    });
    (s.closures || []).forEach(function (c) {
      var x = dayMap[c.date];
      if (x && (x.status === 'weekend' || x.status === 'holiday')) add('warn', 'closure-wasted', c.date + ': 이미 쉬는 날이라 자율휴업일로 지정할 필요가 없습니다.', { date: c.date });
    });
    r.days.forEach(function (x) {
      if (x.status !== 'outside' && x.estimated) add('info', 'estimated', x.date + ' ' + x.labels.join(', ') + ': 추정 날짜입니다. 발표 후 확인하세요.', { date: x.date });
    });
    return out;
  }

  // ---------- 비교·보충 제안 ----------
  function diff(a, b) {
    var h = {}; GRADES.forEach(function (g) { h[g] = b.totals.hours[g].total - a.totals.hours[g].total; });
    return { days: b.totals.days.total - a.totals.days.total, hours: h };
  }

  // 법정 기준 대비 부족분
  function shortfall(r) {
    var need = { days: Math.max(0, r.state.standards.minDays - r.totals.days.total), hours: emptyHours() };
    // 법정 판정은 학년군 둘째 해(2·4·6학년)만. 1·3·5학년은 목표 대비라 여기서 제외
    r.grades.forEach(function (g) { if (g.grade % 2 === 0 && g.margin != null && g.margin < 0) need.hours[g.grade] = -g.margin; });
    return need;
  }

  function apply(stateIn, action) {
    var s = clone(stateIn);
    if (action.type === 'setDate') {
      // 시업·방학식·개학·종업일을 옮기면 그날의 행사(단축 수업)도 함께 옮긴다
      var old = s.dates[action.field], nv = action.value || null;
      s.events = s.events || [];
      // 겨울 개학 전에 종업하면 별도의 겨울방학·개학 일정은 필요 없다.
      // 행사도 함께 정리해야 종업일이 방학으로 계산되거나 이전 행사와 겹치지 않는다.
      if (action.field === 'end' && nv &&
          ((s.dates.winterStart && nv <= s.dates.winterStart) || (s.dates.winterEnd && nv <= s.dates.winterEnd))) {
        var winterDates = [s.dates.winterStart, s.dates.winterEnd];
        s.events = s.events.filter(function (e) { return e.type !== 'ceremony' || winterDates.indexOf(e.date) < 0 || e.date === old; });
        s.dates.winterStart = null; s.dates.winterEnd = null;
      }
      var cer = s.events.filter(function (e) { return old && e.date === old && e.type === 'ceremony'; })[0];
      s.dates[action.field] = nv;
      if (cer && !nv) s.events = s.events.filter(function (e) { return e !== cer; });
      else if (nv) {
        if (!cer && !old) cer = ceremonyFor(s, action.field, nv);
        if (cer) {
          var other = s.events.filter(function (e) { return e !== cer && e.date === nv; })[0];
          if (other && other.type === 'ceremony') { cer = null; } // 이미 행사일이면 그대로 둔다
          else {
            if (other) { cer.name = cer.name + '·' + other.name; s.events = s.events.filter(function (e) { return e !== other; }); }
            cer.date = nv;
            if (s.events.indexOf(cer) < 0) s.events.push(cer);
          }
        }
      }
    }
    else if (action.type === 'removeClosure') s.closures = (s.closures || []).filter(function (c) { return c.date !== action.date; });
    else if (action.type === 'addPeriods') {
      s.events = s.events || [];
      action.items.forEach(function (it) {
        var e = s.events.filter(function (x) { return x.date === it.date; })[0];
        if (!e) { e = { date: it.date, type: 'adjust', name: '시수 보충', reason: action.reason || '시수 보충', periods: {} }; s.events.push(e); }
        e.periods[it.grade] = it.periods;
      });
    } else if (action.type === 'addHoliday') s.extraHolidays = (s.extraHolidays || []).concat([{ date: action.date, name: action.name || '임시공휴일', kind: 'temporary' }]);
    else if (action.type === 'setSuneung') s.suneung = Object.assign({}, s.suneung, { mode: action.mode });
    else if (action.type === 'multi') action.actions.forEach(function (a) { s = apply(s, a); });
    return s;
  }

  function schoolable(r, date) {
    var x = r.days.filter(function (d) { return d.date === date; })[0];
    return !!x && !x.off;
  }

  // need: {days, hours:{학년:시간}}, opts.after: 이 날짜 이후 날에서 교시를 늘림
  function suggest(stateIn, H, need, opts) {
    opts = opts || {};
    var base = build(stateIn, H), s = base.state, d = s.dates, cands = [];
    function tryAction(label, action) {
      var r2 = build(apply(s, action), H), eff = diff(base, r2);
      if (eff.days <= 0 && !GRADES.some(function (g) { return eff.hours[g] > 0; })) return;
      if (r2.checks.some(function (c) { return c.code === 'dates-order' || c.code === 'date-not-school'; })) return;
      cands.push({ label: label, action: action, effect: eff, covers: covers(eff, need) });
    }
    function step(date, dir, guard) {
      var x = addDays(date, dir), n = 0;
      while (!schoolable(base, x) && n++ < 20) x = addDays(x, dir);
      return guard(x) ? x : null;
    }
    var v;
    if ((v = step(d.end, 1, function (x) { return x <= lastDayOfFeb(s.year + 1); }))) tryAction('종업일을 ' + kdro(v) + ' 하루 늦추기', { type: 'setDate', field: 'end', value: v });
    if ((v = step(d.summerEnd, -1, function (x) { return x > d.summerStart; }))) tryAction('2학기 개학을 ' + kdro(v) + ' 하루 앞당기기', { type: 'setDate', field: 'summerEnd', value: v });
    if ((v = step(d.summerStart, 1, function (x) { return x < d.summerEnd; }))) tryAction('여름방학식을 ' + kdro(v) + ' 하루 늦추기', { type: 'setDate', field: 'summerStart', value: v });
    if (d.winterStart && d.winterEnd) {
      if ((v = step(d.winterStart, 1, function (x) { return x < d.winterEnd; }))) tryAction('겨울방학식을 ' + kdro(v) + ' 하루 늦추기', { type: 'setDate', field: 'winterStart', value: v });
      if ((v = step(d.winterEnd, -1, function (x) { return x > d.winterStart; }))) tryAction('겨울 개학을 ' + kdro(v) + ' 하루 앞당기기', { type: 'setDate', field: 'winterEnd', value: v });
    }
    (s.closures || []).forEach(function (c) { tryAction(kd(c.date) + ' ' + (c.name || '자율휴업일') + '을 수업일로 되돌리기', { type: 'removeClosure', date: c.date }); });
    if (s.suneung.mode !== 'normal' && base.suneungDate) tryAction('수능일(' + kd(base.suneungDate) + ')을 정상 수업으로', { type: 'setSuneung', mode: 'normal' });

    var after = opts.after || d.start, reason = opts.reason || '시수 보충';
    var periodsOnly = addPeriodsAction(base, need.hours, after, reason);
    if (periodsOnly) tryAction(periodsOnly.label, periodsOnly.action);

    // 하루 늘리기만으로 모자라면: 그 안 + 남은 시수만큼 교시 추가
    cands.filter(function (c) { return !c.covers && c.effect.days > 0; }).forEach(function (c) {
      var r1 = build(apply(s, c.action), H), rest = {}, any = false;
      GRADES.forEach(function (g) { rest[g] = Math.max(0, (need.hours[g] || 0) - c.effect.hours[g]); if (rest[g]) any = true; });
      if (!any) return;
      var p = addPeriodsAction(r1, rest, after, reason);
      if (p) tryAction(c.label + ' + ' + p.label, { type: 'multi', actions: [c.action, p.action] });
    });

    // 하나로 다 못 채우면(예: 2일 부족) 수업일을 늘리는 안부터 차례로 묶고, 남은 시수만 교시 추가
    if (!opts.noCombo && !cands.some(function (c) { return c.covers; })) {
      var acts = [], cur = s, left = clone(need);
      for (var k = 0; k < 6; k++) {
        var sub = suggest(cur, H, left, Object.assign({}, opts, { noCombo: true })).candidates
          .filter(function (c) { return c.action.type !== 'addPeriods' && c.action.type !== 'multi' && c.effect.days > 0; })
          .sort(function (a, b) { return b.effect.days - a.effect.days || sum(b.effect.hours) - sum(a.effect.hours); })[0];
        if (!sub || (left.days <= 0 && !GRADES.some(function (g) { return left.hours[g] > 0; }))) break;
        acts.push(sub.action); cur = apply(cur, sub.action);
        left.days = Math.max(0, left.days - sub.effect.days);
        GRADES.forEach(function (g) { left.hours[g] = Math.max(0, (left.hours[g] || 0) - sub.effect.hours[g]); });
        if (left.days <= 0) break;
      }
      if (GRADES.some(function (g) { return left.hours[g] > 0; })) {
        var pa = addPeriodsAction(build(cur, H), left.hours, after, reason);
        if (pa) acts.push(pa.action);
      }
      // 같은 날짜 항목을 여러 번 옮긴 경우 마지막 값 하나로
      var merged = [];
      acts.forEach(function (a) {
        if (a.type === 'setDate') { var j = -1; merged.forEach(function (m, i) { if (m.type === 'setDate' && m.field === a.field) j = i; }); if (j >= 0) { merged[j] = a; return; } }
        merged.push(a);
      });
      if (merged.length > 1) tryAction(merged.map(function (a) { return describe(s, a); }).join(' + '), { type: 'multi', actions: merged });
    }

    cands.sort(function (a, b) {
      return (b.covers ? 1 : 0) - (a.covers ? 1 : 0) || cost(a) - cost(b) || b.effect.days - a.effect.days;
    });
    return { before: base, need: need, candidates: cands };
  }

  var FIELD = { start: '시업일', summerStart: '여름방학식', summerEnd: '2학기 개학', winterStart: '겨울방학식', winterEnd: '겨울 개학', end: '종업일' };
  function describe(s, a) {
    if (a.type === 'setDate') return FIELD[a.field] + ' ' + kd(s.dates[a.field]) + ' → ' + kd(a.value);
    if (a.type === 'removeClosure') return kd(a.date) + ' 자율휴업일 되돌리기';
    if (a.type === 'setSuneung') return '수능일 정상 수업';
    if (a.type === 'addPeriods') { var per = {}; a.items.forEach(function (i) { per[i.grade] = (per[i.grade] || 0) + 1; }); return '교시 추가(' + Object.keys(per).map(function (g) { return g + '학년 ' + per[g] + '일'; }).join(', ') + ')'; }
    return '';
  }
  function sum(h) { return GRADES.reduce(function (n, g) { return n + (h[g] || 0); }, 0); }

  // 바꾸는 날이 적을수록 앞에
  function cost(c) {
    var a = c.action;
    if (a.type === 'multi') return a.actions.reduce(function (n, x) { return n + cost({ action: x }); }, 0);
    if (a.type === 'addPeriods') { var u = {}; a.items.forEach(function (i) { u[i.date] = 1; }); return Object.keys(u).length; }
    return 1;
  }

  // 수업일은 그대로 두고 교시만 늘리기: 학년마다 일주일에 하루씩, 하루 최대 교시 이하, 행사일 제외
  function addPeriodsAction(r, hoursNeed, after, reason) {
    var items = [], per = [], s = r.state;
    GRADES.forEach(function (g) {
      var left = hoursNeed[g] || 0, usedWeeks = {}, n = 0;
      r.days.forEach(function (x) {
        if (left <= 0 || x.status !== 'school' || x.date <= after || x.category) return;
        var wk = addDays(x.date, 1 - x.dow);
        if (usedWeeks[wk] || x.periods[g] >= s.maxPeriods[g]) return;
        usedWeeks[wk] = true; left--; n++;
        items.push({ date: x.date, grade: g, periods: x.periods[g] + 1 });
      });
      if (n) per.push(g + '학년 ' + n + '일');
    });
    if (!items.length) return null;
    return { label: '교시 추가(' + per.join(', ') + ')', action: { type: 'addPeriods', items: items, reason: reason } };
  }

  function covers(eff, need) {
    if (eff.days < need.days) return false;
    return GRADES.every(function (g) { return eff.hours[g] >= (need.hours[g] || 0); });
  }

  // 임시공휴일 지정 → 줄어든 양과 법정 부족분, 보충 후보
  function temporaryHoliday(stateIn, H, date, name) {
    var before = build(stateIn, H);
    var s2 = apply(stateIn, { type: 'addHoliday', date: date, name: name });
    var after = build(s2, H), lost = diff(after, before);
    var legal = shortfall(after);
    var restore = { days: lost.days, hours: lost.hours };
    return {
      state: s2, before: before, after: after, lost: lost, legalShortfall: legal,
      suggestions: suggest(s2, H, restore, { after: date, reason: date + ' ' + (name || '임시공휴일') + ' 보충' })
    };
  }

  // ---------- 초안 만들기 ----------
  function firstSchoolable(r, from, dir, limit) {
    var x = from, n = 0;
    while (!schoolable(r, x) && n++ < (limit || 30)) x = addDays(x, dir || 1);
    return x;
  }

  // 징검다리 평일: 앞뒤가 모두 쉬는 날인 평일 (자율휴업일 후보). 날짜가 정해졌으면 수업일만
  function bridgeDays(year, H, stateIn) {
    var s = normalize(stateIn || defaultState(year));
    var idx = holidayIndex(s, H), out = [];
    var r = build(s, H), status = {};
    r.days.forEach(function (x) { status[x.date] = x.status; });
    function off(x) { var w = dow(x); return w === 0 || w === 6 || !!idx.map[x]; }
    for (var cur = year + '-03-02'; cur <= lastDayOfFeb(year + 1); cur = addDays(cur, 1)) {
      if (r.ready && status[cur] !== 'school') continue;
      if (!off(cur) && off(addDays(cur, -1)) && off(addDays(cur, 1))) out.push({ date: cur, weekday: WEEKDAY[dow(cur)] });
    }
    return out;
  }

  // mode: 'feb'(2월 종업, 겨울 개학 있음) | 'jan' | 'dec'(12월 종업일 고정)
  function draft(year, H, opts) {
    opts = opts || {};
    var s = defaultState(year), keep = opts.keep ? sanitize(opts.keep) : null;
    if (keep) ['school', 'standards', 'basePeriods', 'basePeriods2', 'maxPeriods', 'suneung', 'closures', 'extraHolidays', 'removedHolidays', 'prevYear', 'targets', 'prevYearFrom'].forEach(function (k) { if (keep[k] !== undefined) s[k] = clone(keep[k]); });
    if (opts.closures) s.closures = clone(opts.closures);
    if (opts.basePeriods) s.basePeriods = clone(opts.basePeriods);
    var target = opts.targetDays || s.standards.minDays;
    var probe = build(s, H); // 휴일 판단용(날짜 미입력 상태)
    var d = s.dates;
    d.start = firstSchoolable(probe, year + '-03-02', 1);
    d.summerStart = firstSchoolable(probe, year + '-07-21', 1);
    d.summerEnd = firstSchoolable(probe, year + '-08-19', 1);
    var Y1 = year + 1, mode = opts.mode || 'feb';
    function days() { return build(s, H).totals.days.total; }
    if (mode === 'feb') {
      d.winterStart = firstSchoolable(probe, year + '-12-24', -1);
      d.end = firstSchoolable(probe, Y1 + '-02-10', 1);
      // 겨울 개학일을 가능한 늦게(방학을 길게) 하되 목표 일수는 채움
      var best = null;
      for (var c = Y1 + '-02-05'; c >= Y1 + '-01-02'; c = addDays(c, -1)) {
        if (!schoolable(probe, c) || c >= d.end) continue;
        d.winterEnd = c;
        if (days() >= target) { best = c; break; }
      }
      while (!best && d.end < lastDayOfFeb(Y1)) {
        d.end = firstSchoolable(probe, addDays(d.end, 1), 1);
        d.winterEnd = firstSchoolable(probe, Y1 + '-01-02', 1);
        if (days() >= target) best = d.winterEnd;
      }
    } else if (mode === 'dec') {
      d.winterStart = null; d.winterEnd = null;
      if (opts.endDate && !(new RegExp('^' + year + '-12-(0[1-9]|[12][0-9]|3[01])$')).test(opts.endDate)) {
        throw new RangeError('12월 종업일은 해당 학년도 12월 안에서 선택하세요.');
      }
      var decDays = probe.days.filter(function (day) { return day.date.slice(0, 7) === year + '-12' && !day.off; });
      d.end = opts.endDate || (decDays.length ? decDays[decDays.length - 1].date : year + '-12-31');
      // 공사 등으로 정한 종업일은 유지하고, 초안의 여름방학을 줄여 목표 일수를 맞춘다.
      // 여름방학을 모두 줄여도 부족하면 실제 부족분을 그대로 판정한다.
      for (var se = addDays(d.summerEnd, -1); days() < target && se > d.summerStart; se = addDays(se, -1)) {
        if (schoolable(probe, se)) d.summerEnd = se;
      }
    } else {
      d.winterStart = null; d.winterEnd = null;
      for (var e = year + '-12-20'; e <= Y1 + '-02-15'; e = addDays(e, 1)) {
        if (!schoolable(probe, e)) continue;
        d.end = e;
        if (days() >= target) break;
      }
    }
    s.events = ceremonies(s);
    // 기존 시수 조정·입학초기 적응은 새 행사일과 겹치지 않으면 유지
    if (keep) {
      var cd = {}; s.events.forEach(function (e) { cd[e.date] = 1; });
      keep.events.forEach(function (e) { if (e.type !== 'ceremony' && !cd[e.date]) s.events.push(clone(e)); });
    }
    var r = build(s, H);
    return { state: s, result: r, bridgeDays: bridgeDays(year, H, s) };
  }

  var CEREMONY = { start: ['시업식·입학식', { 1: 2 }], summerStart: ['여름방학식'], summerEnd: ['개학식'], winterStart: ['겨울방학식'], winterEnd: ['개학식'], end: ['종업식·졸업식', { 6: 2 }] };
  function ceremonyFor(s, field, date) {
    var c = CEREMONY[field]; if (!c) return null;
    if (field === 'winterStart' && date === s.dates.end) return null;
    var p = {}; GRADES.forEach(function (g) { p[g] = 4; }); Object.assign(p, c[1] || {});
    return { date: date, type: 'ceremony', name: c[0], reason: '학사 행사', periods: p };
  }
  // 시업·방학·개학·종업 행사일(전 학년 4교시, 시업일 1학년 입학식 2교시)
  function ceremonies(s) {
    var d = s.dates, out = [];
    function ev(date, name, periods) {
      if (!date) return;
      var p = {}; GRADES.forEach(function (g) { p[g] = 4; });
      Object.assign(p, periods || {});
      out.push({ date: date, type: 'ceremony', name: name, reason: '학사 행사', periods: p });
    }
    ev(d.start, '시업식·입학식', { 1: 2 });
    ev(d.summerStart, '여름방학식');
    ev(d.summerEnd, '개학식');
    if (d.winterStart && d.winterStart !== d.end) ev(d.winterStart, '겨울방학식');
    if (d.winterEnd) ev(d.winterEnd, '개학식');
    ev(d.end, '종업식·졸업식', { 6: 2 });
    return out;
  }

  return {
    GRADES: GRADES, GROUP_OF: GROUP_OF, CATEGORY: CATEGORY, WEEKDAY: WEEKDAY,
    defaultState: defaultState, basePeriodsFor: basePeriodsFor, build: build, diff: diff, shortfall: shortfall,
    apply: apply, suggest: suggest, temporaryHoliday: temporaryHoliday,
    draft: draft, bridgeDays: bridgeDays, ceremonies: ceremonies, addDays: addDays, dow: dow, sanitize: sanitize, lastDayOfFeb: lastDayOfFeb
  };
});
