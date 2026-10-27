/* 김해외동초 3단계 계산: 입학초기·행사 템플릿·내부 비교·홈페이지용 HTML
 * 화면은 extui.js. 공식 계산(engine.js)은 고치지 않고, state.ext 와 state.events 만 다룬다.
 *  state.ext.adapt = { from, to, periods:[월~금] }   1학년 입학초기 적응 기간과 요일별 교시
 *  행사 템플릿(학년도와 무관, 시트 '행사템플릿' 탭):
 *    [{ name, type:'ceremony'|'adjust', periods:{학년:교시}, reason, rule }]
 *    rule = { kind:'nth', month, nth(1~5), dow(1~5) }  그 달 n번째 ○요일(5번째가 없으면 마지막)
 *         | { kind:'fixed', month, day }               해마다 같은 날짜
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Ext = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var ADAPT_REASON = '입학초기 적응 기간';
  var WD = E.WEEKDAY;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function md(s) { return (+s.slice(5, 7)) + '.' + (+s.slice(8, 10)) + '.'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 학년도 y 의 m월(3~12월은 y년, 1~2월은 y+1년)
  function calYear(y, m) { return m <= 2 ? y + 1 : y; }

  // ---------- ② 입학초기 ----------
  function isAutoAdapt(e) { return e.type === 'adapt' && e.reason === ADAPT_REASON; }
  function defaultAdapt(state) {
    var s = state.dates && state.dates.start;
    return { from: s || null, to: s ? E.addDays(s, 11) : null, periods: [4, 4, 4, 4, 4] };
  }
  function adaptOf(state) {
    var a = state.ext && state.ext.adapt;
    return a && a.from ? a : null;
  }
  // 기간으로 만든 날(이전 자동분)을 지우고 다시 만든다. 다른 행사가 있는 날은 건드리지 않음.
  // 반환: { state, days:[날짜], skipped:[{date,name}] }
  function applyAdapt(stateIn, H, adapt) {
    var s = clone(stateIn);
    s.events = (s.events || []).filter(function (e) { return !isAutoAdapt(e); });
    s.ext = s.ext || {};
    if (!adapt) { delete s.ext.adapt; return { state: s, days: [], skipped: [] }; }
    s.ext.adapt = { from: adapt.from, to: adapt.to, periods: adapt.periods.map(function (v) { return Math.max(0, Math.min(12, Math.round(+v) || 0)); }) };
    var r = E.build(s, H), taken = {}, days = [], skipped = [];
    s.events.forEach(function (e) { taken[e.date] = e; });
    r.days.forEach(function (d) {
      if (d.date < adapt.from || d.date > adapt.to || d.status !== 'school') return;
      if (taken[d.date]) { skipped.push({ date: d.date, name: taken[d.date].name }); return; }
      s.events.push({ date: d.date, type: 'adapt', name: '입학초기 적응', reason: ADAPT_REASON, periods: { 1: s.ext.adapt.periods[d.dow - 1] } });
      days.push(d.date);
    });
    s.events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { state: s, days: days, skipped: skipped };
  }

  // ---------- ③ 행사 템플릿 ----------
  function ruleFromDate(date, kind) {
    var m = +date.slice(5, 7), day = +date.slice(8, 10);
    if (kind === 'fixed') return { kind: 'fixed', month: m, day: day };
    return { kind: 'nth', month: m, nth: Math.ceil(day / 7), dow: E.dow(date) };
  }
  // 학년도 y 에서 규칙이 가리키는 날짜(없으면 null)
  function dateFromRule(rule, y) {
    var cy = calYear(y, rule.month), first = cy + '-' + pad(rule.month) + '-01';
    if (rule.kind === 'fixed') {
      var d = cy + '-' + pad(rule.month) + '-' + pad(rule.day);
      return E.addDays(d, 0) === d ? d : null; // 2월 29일 같은 없는 날
    }
    var off = (rule.dow - E.dow(first) + 7) % 7, cur = E.addDays(first, off + 7 * (rule.nth - 1));
    while (+cur.slice(5, 7) !== rule.month) cur = E.addDays(cur, -7); // 5번째가 없으면 마지막
    return cur;
  }
  function ruleText(rule) {
    if (rule.kind === 'fixed') return rule.month + '월 ' + rule.day + '일';
    return rule.month + '월 ' + (rule.nth === 5 ? '마지막' : rule.nth + '번째') + ' ' + WD[rule.dow] + '요일';
  }
  function templateFromEvent(e, kind) {
    return { name: e.name, type: e.type === 'adjust' ? 'adjust' : 'ceremony', periods: clone(e.periods || {}), reason: e.reason || '', rule: ruleFromDate(e.date, kind) };
  }
  // 작년 학사일정의 행사로 템플릿 만들기(입학초기 자동분·학사 기본 행사(방학식 등)는 뺌)
  function templatesFromState(prev, keyDates) {
    var skip = {}; Object.keys(keyDates || {}).forEach(function (k) { if (keyDates[k]) skip[keyDates[k]] = 1; });
    return (prev.events || []).filter(function (e) { return e.type !== 'adapt' && !skip[e.date]; })
      .map(function (e) { return templateFromEvent(e, 'nth'); });
  }
  // 이름이 같은 것은 새 것으로 바꾸고 나머지는 덧붙인다
  function mergeTemplates(list, add) {
    var out = clone(list || []);
    add.forEach(function (t) {
      var i = -1; out.forEach(function (x, k) { if (x.name === t.name) i = k; });
      if (i >= 0) out[i] = clone(t); else out.push(clone(t));
    });
    return out.sort(function (a, b) { var x = (a.rule.month + 9) % 12, y = (b.rule.month + 9) % 12; return x - y || (a.rule.day || a.rule.nth * 7) - (b.rule.day || b.rule.nth * 7); });
  }
  // 올해 어디에 들어가는지 미리보기: [{ i, tpl, date, status:'ok'|'exists'|'same'|'notschool'|'none', why }]
  function previewTemplates(state, H, templates) {
    var r = E.build(state, H), dm = {}, ev = {};
    r.days.forEach(function (d) { dm[d.date] = d; });
    (state.events || []).forEach(function (e) { ev[e.date] = e; });
    return (templates || []).map(function (t, i) {
      var date = dateFromRule(t.rule, state.year), d = date && dm[date];
      var o = { i: i, tpl: t, date: date, status: 'ok', why: '' };
      if (!d) { o.status = 'none'; o.why = '올해 그런 날짜가 없음'; }
      else if (ev[date] && ev[date].name === t.name) { o.status = 'same'; o.why = '이미 들어 있음'; }
      else if (ev[date]) { o.status = 'exists'; o.why = '같은 날 「' + ev[date].name + '」'; }
      else if (d.status !== 'school') { o.status = 'notschool'; o.why = d.status === 'weekend' ? '주말' : d.status === 'vacation' ? '방학 중' : d.status === 'outside' ? '학년도 밖' : (d.labels[0] || '쉬는 날'); }
      return o;
    });
  }
  function applyTemplates(stateIn, rows) {
    var s = clone(stateIn);
    rows.forEach(function (x) {
      if (x.status !== 'ok') return;
      s.events.push({ date: x.date, type: x.tpl.type, name: x.tpl.name, reason: x.tpl.reason || '', periods: clone(x.tpl.periods || {}) });
    });
    s.events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return s;
  }
  function sanitizeTemplates(src) {
    function int(v, lo, hi) { v = Math.round(+v); return isFinite(v) && v >= lo && v <= hi ? v : null; }
    return (Array.isArray(src) ? src : []).map(function (t) {
      if (!t || typeof t.name !== 'string' || !t.name.trim() || !t.rule) return null;
      var r = t.rule, month = int(r.month, 1, 12), rule;
      if (!month) return null;
      if (r.kind === 'fixed') { var day = int(r.day, 1, 31); if (!day) return null; rule = { kind: 'fixed', month: month, day: day }; }
      else { var nth = int(r.nth, 1, 5), dw = int(r.dow, 1, 5); if (!nth || !dw) return null; rule = { kind: 'nth', month: month, nth: nth, dow: dw }; }
      var p = {}; E.GRADES.forEach(function (g) { var v = t.periods && int(t.periods[g], 0, 12); if (v !== null && v !== undefined) p[g] = v; });
      return { name: t.name.trim().slice(0, 60), type: t.type === 'adjust' ? 'adjust' : 'ceremony', periods: p, reason: typeof t.reason === 'string' ? t.reason.slice(0, 100) : '', rule: rule };
    }).filter(Boolean);
  }

  // ---------- ① 내부 비교(공식 시수 아님) ----------
  // 담임 부담 시수 = 담임 시수 − 스포츠강사 시수 × 0.5
  // out = Timetable.compute 결과. 반환: { classes:[{cls,grade,teacher,homeroom,sports,load,weekly}], grades:[{grade,n,avg,min,max,weekly,diff}], weeks, all }
  function compare(result, tt, out, key) {
    var weeks = (result.weeks || []).filter(function (w) { return w.days > 0 && (key === 'total' || 'sem' + w.sem === key); }).length;
    var classes = tt.classes.map(function (c) {
      var o = out.classes[c.cls], h = o.homeroom[key], sp = o.sports[key], load = h - sp * 0.5;
      return { cls: c.cls, grade: c.grade, teacher: c.teacher, homeroom: h, sports: sp, load: load, weekly: weeks ? load / weeks : 0 };
    });
    var allSum = 0, allN = 0;
    var grades = E.GRADES.map(function (g) {
      var cs = classes.filter(function (c) { return c.grade === g; });
      if (!cs.length) return null;
      var loads = cs.map(function (c) { return c.load; }), sum = loads.reduce(function (a, b) { return a + b; }, 0);
      allSum += sum; allN += cs.length;
      return { grade: g, n: cs.length, avg: sum / cs.length, min: Math.min.apply(null, loads), max: Math.max.apply(null, loads), weekly: weeks ? sum / cs.length / weeks : 0 };
    }).filter(Boolean);
    var all = allN ? allSum / allN : 0;
    grades.forEach(function (g) { g.diff = g.avg - all; });
    return { classes: classes, grades: grades, weeks: weeks, all: all };
  }

  // ---------- ④ 홈페이지용 HTML ----------
  // 월별: 행사·공휴일·휴업일·방학. 반환: [{ ym, items:[{ from, to, text, kind:'event'|'holiday'|'closure'|'vacation' }] }]
  function monthlyItems(result) {
    var st = result.state, d = st.dates, y = st.year, months = {};
    function put(date, item) { var k = date.slice(0, 7); (months[k] = months[k] || []).push(item); }
    var vac = [];
    if (d.summerStart && d.summerEnd) vac.push(['여름방학', E.addDays(d.summerStart, 1), E.addDays(d.summerEnd, -1)]);
    if (d.winterStart && d.winterEnd) vac.push(['겨울방학', E.addDays(d.winterStart, 1), E.addDays(d.winterEnd, -1)]);
    if (d.end && d.end < E.lastDayOfFeb(y + 1)) vac.push([d.winterStart ? '학년말 방학' : '겨울방학', E.addDays(d.end, 1), E.lastDayOfFeb(y + 1)]);
    vac.forEach(function (v) { if (v[1] <= v[2]) put(v[1], { from: v[1], to: v[2], text: v[0], kind: 'vacation' }); });
    var events = {}; (st.events || []).forEach(function (e) { events[e.date] = e; });
    var closures = {}; (st.closures || []).forEach(function (c) { closures[c.date] = c; });
    result.days.forEach(function (x) {
      if (x.status === 'outside') return;
      var e = events[x.date], c = closures[x.date];
      // labels 에서 행사·휴업일 이름과 수능을 빼면 공휴일 이름(주말·방학 중 공휴일도 보이게)
      var hol = x.labels.filter(function (l) { return l !== '수능' && !(e && l === e.name) && !(c && l === c.name); });
      if (hol.length) put(x.date, { from: x.date, to: x.date, text: hol.join('·'), kind: 'holiday' });
      if (x.status === 'closure') put(x.date, { from: x.date, to: x.date, text: c ? c.name : '휴업일', kind: 'closure' });
      else if (e && e.type !== 'adapt' && x.status === 'school') put(x.date, { from: x.date, to: x.date, text: e.name, kind: 'event' });
    });
    // 입학초기 적응 기간은 한 줄로(실제로 만든 첫날 ~ 마지막 날)
    var ad = (st.events || []).filter(isAutoAdapt).map(function (e) { return e.date; }).sort();
    if (ad.length) put(ad[0], { from: ad[0], to: ad[ad.length - 1], text: '1학년 입학초기 적응 기간', kind: 'event' });
    var order = []; for (var m = 3; m <= 14; m++) order.push(calYear(y, m > 12 ? m - 12 : m) + '-' + pad(m > 12 ? m - 12 : m));
    return order.filter(function (k) { return months[k]; }).map(function (k) {
      var items = months[k].sort(function (p, q) { return p.from < q.from ? -1 : p.from > q.from ? 1 : 0; }), merged = [];
      // 이어진 날의 같은 이름(추석 연휴 등)은 한 줄로
      items.forEach(function (it) {
        var last = merged[merged.length - 1];
        if (last && last.kind === it.kind && last.text === it.text && E.addDays(last.to, 1) === it.from) last.to = it.to;
        else merged.push(it);
      });
      return { ym: k, items: merged };
    });
  }
  function homepageHtml(result, schoolName) {
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function dl(s) { return md(s) + '(' + WD[E.dow(s)] + ')'; }
    var COLOR = { event: '#1f2937', holiday: '#c62828', closure: '#6a1b9a', vacation: '#1565c0' };
    var TAG = { holiday: '공휴일', closure: '휴업일', vacation: '방학' };
    var y = result.state.year, months = monthlyItems(result);
    var th = 'style="padding:6px 8px;border:1px solid #d0d7e2;background:#eef2f7;font-weight:bold;text-align:center"';
    var td = 'padding:6px 8px;border:1px solid #d0d7e2;vertical-align:top';
    var h = '<div style="font-family:\'Malgun Gothic\',\'맑은 고딕\',sans-serif;font-size:14px;color:#1f2937;line-height:1.5">\n' +
      '<h3 style="margin:0 0 8px;font-size:18px">' + esc((schoolName ? schoolName + ' ' : '') + y + '학년도 학사일정') + '</h3>\n' +
      '<table style="border-collapse:collapse;width:100%;max-width:720px">\n<tr><th ' + th + ' width="70">월</th><th ' + th + ' width="150">날짜</th><th ' + th + '>내용</th></tr>\n';
    months.forEach(function (m) {
      m.items.forEach(function (it, i) {
        h += '<tr>' + (i === 0 ? '<td rowspan="' + m.items.length + '" style="' + td + ';text-align:center;font-weight:bold;background:#f8fafc">' + (+m.ym.slice(5)) + '월</td>' : '') +
          '<td style="' + td + ';white-space:nowrap">' + dl(it.from) + (it.to !== it.from ? ' ~ ' + dl(it.to) : '') + '</td>' +
          '<td style="' + td + ';color:' + COLOR[it.kind] + '">' + esc(it.text) + (TAG[it.kind] ? ' <span style="font-size:12px;color:#6b7280">(' + TAG[it.kind] + ')</span>' : '') + '</td></tr>\n';
      });
    });
    return h + '</table>\n<p style="margin:6px 0 0;font-size:12px;color:#6b7280">학교 사정에 따라 일정이 바뀔 수 있습니다.</p>\n</div>';
  }

  return {
    ADAPT_REASON: ADAPT_REASON, isAutoAdapt: isAutoAdapt, defaultAdapt: defaultAdapt, adaptOf: adaptOf, applyAdapt: applyAdapt,
    ruleFromDate: ruleFromDate, dateFromRule: dateFromRule, ruleText: ruleText, templateFromEvent: templateFromEvent,
    templatesFromState: templatesFromState, mergeTemplates: mergeTemplates, previewTemplates: previewTemplates,
    applyTemplates: applyTemplates, sanitizeTemplates: sanitizeTemplates,
    compare: compare, monthlyItems: monthlyItems, homepageHtml: homepageHtml
  };
});
