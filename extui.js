/* 화면: 내부 비교 탭 + 학사 도구 탭(입학초기·행사 템플릿·홈페이지용 HTML) (김해외동초 3단계). 계산은 ext.js
 * 행사 템플릿은 학년도와 무관하게 시트 '행사템플릿' 탭(비밀번호로만 읽고 씀)과 이 브라우저(haksa:tpl)에 저장한다.
 */
(function () {
  'use strict';
  var E = window.Engine, H = window.HOLIDAY_DATA, ST = window.Store, X = window.Ext;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var api = null;
  var cmpKey = 'total';
  var adaptForm = null, adaptMsg = '';
  var tpl = [], tplBase = 0, tplInfo = '', tplConflict = null, tplLoaded = false, tplMsg = '', unchecked = {}, prevArmed = false;
  var copied = false;

  function esc(s) { return api.esc(s); }
  function fmt(n) { return api.fmt(n); }
  function one(n) { return (Math.round(n * 10) / 10).toLocaleString('ko-KR'); }
  function sgn(n) { var v = Math.round(n * 10) / 10; return v > 0 ? '+' + one(v) : v < 0 ? '−' + one(-v) : '0'; }
  function dl(s) { return api.md(s) + '(' + E.WEEKDAY[E.dow(s)] + ')'; }
  function hm(ms) { var t = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; }; return (t.getMonth() + 1) + '.' + t.getDate() + '. ' + p(t.getHours()) + ':' + p(t.getMinutes()); }

  // ---------- 행사 템플릿 저장 ----------
  var KEY = 'haksa:tpl';
  function localLoad() { try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o ? { data: X.sanitizeTemplates(o.data), base: o.base || 0, dirty: !!o.dirty } : null; } catch (e) { return null; } }
  function localSave(dirty) { try { localStorage.setItem(KEY, JSON.stringify({ data: tpl, base: tplBase, dirty: dirty })); } catch (e) { /* 막힘 */ } }
  function load() {
    var lp = localLoad();
    adaptForm = null; adaptMsg = ''; tplMsg = ''; unchecked = {}; // 학년도가 바뀌면 입력 중이던 것은 버림
    tpl = lp ? lp.data : []; tplBase = lp ? lp.base : 0; tplConflict = null; tplLoaded = true;
    if (!api.canWrite()) { tplInfo = api.cloudState() === 'off' ? '' : '담당자 비밀번호를 연결하면 시트에 저장합니다. 지금은 이 브라우저 자료입니다.'; render(); return; }
    tplInfo = '시트에서 행사 템플릿을 읽는 중…'; render();
    ST.tplGet().then(function (c) {
      tplInfo = '';
      if (c) tplBase = c.savedAt;
      if (lp && lp.dirty && c && c.savedAt > lp.base) tplConflict = c;
      else if (lp && lp.dirty) push(false);
      else if (c) { tpl = X.sanitizeTemplates(c.data); localSave(false); tplInfo = (c.savedBy ? '「' + c.savedBy + '」에서 ' : '') + hm(c.savedAt) + ' 저장본'; }
      render();
    }, function (e) {
      tplInfo = e && e.detail === '알 수 없는 요청' ? '시트 저장소(Apps Script)를 업데이트해야 시트에 저장됩니다(설치안내 「최종 업데이트」 참고). 지금은 이 브라우저에만 저장합니다.'
        : '시트에서 읽지 못했습니다' + (e && e.detail ? '(' + e.detail + ')' : '') + '. 이 브라우저 자료를 씁니다.';
      render();
    });
  }
  function saveTpl() {
    localSave(true);
    if (!api.canWrite()) { tplInfo = '이 브라우저에만 저장했습니다(시트는 비밀번호 연결 후).'; return; }
    if (!tplConflict) push(false);
  }
  function push(force) {
    tplInfo = '저장 중…'; updateInfo();
    return ST.tplSave(tpl, tplBase, force).then(function (res) {
      if (res.conflict) { tplConflict = res.remote; tplInfo = ''; render(); return; }
      tplBase = res.savedAt; tplConflict = null; localSave(false); tplInfo = '시트에 저장 ' + hm(res.savedAt); updateInfo();
    }, function (e) {
      tplInfo = (e && e.detail === '알 수 없는 요청' ? '시트 저장소 업데이트 전이라' : '시트 저장 실패' + (e && e.message === 'auth' ? '(비밀번호)' : '')) + ' · 이 브라우저에 저장됨'; updateInfo();
    });
  }
  function updateInfo() { var el = $('#tplInfo'); if (el) el.textContent = tplInfo; }

  // ---------- 그리기 ----------
  function render() {
    if (!api) return;
    if (!$('#tab-compare').hidden) renderCompare();
    if (!$('#tab-tools').hidden) renderTools();
  }

  // ① 내부 비교
  function renderCompare() {
    var el = $('#compare'), st = api.getState(), r = api.getResult();
    var tt = window.TTUI && TTUI.data();
    var h = '<div class="notice"><span><b>공식 시수가 아닙니다.</b> 학교 안에서 담임 부담을 견주어 보는 참고값입니다. 스포츠강사 수업은 공식적으로 담임 수업이지만, 여기서는 담임이 함께 있어 부담이 절반이라고 보고 <b>담임 부담 = 담임 시수 − 스포츠강사 시수 × 0.5</b> 로 셉니다.</span></div>';
    if (!tt) { el.innerHTML = h + '<section class="card"><p>' + st.year + '학년도 시간표가 없습니다. <b>담임·전담</b> 탭에서 게시판 시간표를 가져오면 여기에 나옵니다.</p></section>'; return; }
    if (!r.ready) { el.innerHTML = h + '<section class="card"><p>학사일정 날짜를 먼저 정하세요.</p></section>'; return; }
    var out = window.Timetable.compute(r, tt), c = X.compare(r, tt, out, cmpKey);
    var label = { total: '연간', sem1: '1학기', sem2: '2학기' }[cmpKey];
    h += '<section class="card"><div class="ttbar"><h2>학년별 담임 부담 <small class="muted">' + st.year + '학년도 · ' + label + ' · 수업 주 ' + c.weeks + '주</small></h2><div class="seg" role="group" aria-label="기간">' +
      [['sem1', '1학기'], ['sem2', '2학기'], ['total', '연간']].map(function (x) { return '<button data-cmp="' + x[0] + '" aria-pressed="' + (cmpKey === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<table class="data"><tr><th class="l">학년</th><th>학급 수</th><th>학급 평균</th><th>가장 적은 반</th><th>가장 많은 반</th><th>주당 평균</th><th>전체 평균과 차이</th></tr>' +
      c.grades.map(function (g) {
        return '<tr><td class="l">' + g.grade + '학년</td><td>' + g.n + '</td><td><b>' + one(g.avg) + '</b></td><td>' + one(g.min) + '</td><td>' + one(g.max) + '</td><td>' + one(g.weekly) + '</td><td>' + sgn(g.diff) + '</td></tr>';
      }).join('') + '<tr class="sum"><td class="l" colspan="2">전체 학급 평균</td><td>' + one(c.all) + '</td><td colspan="2"></td><td>' + (c.weeks ? one(c.all / c.weeks) : '') + '</td><td></td></tr></table>' +
      '<p>주당 = 그 기간 담임 부담 ÷ 수업이 하루라도 있는 주 수.</p></section>';
    h += '<section class="card"><h2>학급별</h2><div class="ttscroll"><table class="data"><tr><th class="l">학급</th><th class="l">담임</th><th>담임 시수<br><small>(공식)</small></th><th>스포츠강사</th><th>담임 부담</th><th>주당</th><th>학년 평균과 차이</th></tr>' +
      c.classes.map(function (k) {
        var g = c.grades.filter(function (x) { return x.grade === k.grade; })[0];
        return '<tr><td class="l">' + k.cls + '</td><td class="l">' + esc(k.teacher) + '</td><td>' + fmt(k.homeroom) + '</td><td class="muted">' + (k.sports ? fmt(k.sports) : '·') + '</td><td><b>' + one(k.load) + '</b></td><td>' + one(k.weekly) + '</td><td>' + sgn(k.load - g.avg) + '</td></tr>';
      }).join('') + '</table></div></section>';
    el.innerHTML = h;
  }

  // 학사 도구
  function renderTools() {
    var el = $('#tools'), st = api.getState();
    if (!tplLoaded) load();
    var focus = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset ? Object.assign({}, document.activeElement.dataset) : null;
    el.innerHTML = adaptCard(st) + tplCard(st) + homeCard(st);
    if (focus) { var k = Object.keys(focus)[0]; var again = k && el.querySelector('[data-' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }) + '="' + focus[k] + '"]'); if (again) again.focus(); }
  }

  // ② 입학초기
  function adaptCard(st) {
    var cur = X.adaptOf(st);
    if (!adaptForm) adaptForm = cur ? JSON.parse(JSON.stringify(cur)) : X.defaultAdapt(st);
    var autoDays = (st.events || []).filter(X.isAutoAdapt).length;
    var h = '<section class="card"><h2>1학년 입학초기 적응 기간</h2>' +
      '<p>기간과 요일별 1학년 교시를 정하면 그 기간의 수업일마다 「입학초기 적응」 날을 만듭니다. 다시 적용하면 <b>이 기능으로 만든 날만</b> 지우고 새로 만듭니다. 시업식처럼 다른 행사가 있는 날, 달력에서 직접 넣은 날은 건드리지 않습니다.</p>' +
      '<div class="ttbar"><label class="field">시작<input type="date" data-ad="from" value="' + (adaptForm.from || '') + '"></label>' +
      '<label class="field">끝<input type="date" data-ad="to" value="' + (adaptForm.to || '') + '"></label>' +
      E.WEEKDAY.slice(1, 6).map(function (w, i) { return '<label class="field">' + w + '<input type="number" min="0" max="8" style="width:4rem" data-ad="p' + i + '" value="' + adaptForm.periods[i] + '"></label>'; }).join('') + '</div>';
    var ok = adaptForm.from && adaptForm.to && adaptForm.from <= adaptForm.to;
    if (ok && api.getResult().ready) {
      var a = X.applyAdapt(st, H, adaptForm), r0 = api.getResult(), r1 = E.build(a.state, H);
      var d1 = r1.totals.hours[1].total - r0.totals.hours[1].total;
      h += '<p>적용하면 수업일 <b>' + a.days.length + '일</b>' + (a.days.length ? '(' + dl(a.days[0]) + ' ~ ' + dl(a.days[a.days.length - 1]) + ')' : '') + ' · 1학년 연간 ' + fmt(r0.totals.hours[1].total) + ' → <b>' + fmt(r1.totals.hours[1].total) + '</b>' + (d1 ? ' (' + (d1 > 0 ? '+' : '') + d1 + ')' : ' (변화 없음)') + '</p>' +
        (a.skipped.length ? '<p>건너뛰는 날: ' + a.skipped.map(function (x) { return dl(x.date) + ' ' + esc(x.name); }).join(', ') + '</p>' : '');
    } else if (!ok) h += '<p><b>시작과 끝 날짜를 확인하세요.</b></p>';
    h += '<div class="ttbar"><button class="btn primary" data-ext="adaptApply"' + (ok ? '' : ' disabled') + '>' + (autoDays ? '다시 만들기' : '적용') + '</button>' +
      (cur || autoDays ? '<button class="btn" data-ext="adaptClear">입학초기 날 지우기</button>' : '') +
      '<span class="muted">' + (adaptMsg || (autoDays ? '지금 ' + autoDays + '일 들어 있음' + (cur ? ' (' + dl(cur.from) + ' ~ ' + dl(cur.to) + ')' : '') : '')) + '</span></div></section>';
    return h;
  }

  // ③ 행사 템플릿
  function tplCard(st) {
    var rows = X.previewTemplates(st, H, tpl);
    var pick = rows.filter(function (x) { return x.status === 'ok' && !unchecked[x.i]; });
    var h = '<section class="card"><div class="ttbar"><h2>행사 템플릿 <small class="muted">해마다 되풀이하는 행사</small></h2>' +
      '<button class="btn' + (prevArmed ? ' danger' : '') + '" data-ext="fromPrev">' + (prevArmed ? '이름이 같은 템플릿은 바뀝니다. 한 번 더' : (st.year - 1) + '학년도 행사 가져오기') + '</button>' +
      '<button class="btn" data-ext="fromThis">올해 행사를 템플릿에 담기</button>' +
      '<span id="tplInfo" class="muted">' + esc(tplInfo) + '</span></div>' +
      '<p>규칙은 「작년과 같은 월·주차·요일」(예: 5월 2번째 금요일) 또는 「해마다 같은 날짜」입니다. 올해 날짜 칸을 고치면 규칙도 그 날에 맞춰 바뀝니다. 시업식·방학식·종업식은 학사 날짜에서 따로 정하므로 템플릿에 넣지 않습니다.</p>' +
      (tplMsg ? '<p><b>' + esc(tplMsg) + '</b></p>' : '');
    if (tplConflict) h += '<div class="notice bad"><span>' + (tplConflict.savedBy ? '「' + esc(tplConflict.savedBy) + '」에서 ' : '') + hm(tplConflict.savedAt) + '에 시트에 더 최근 템플릿을 저장했습니다.</span><button class="btn small primary" data-ext="tplRemote">시트 것 불러오기</button><button class="btn small danger" data-ext="tplMine">내 것으로 덮어쓰기</button></div>';
    if (!tpl.length) return h + '<p>아직 템플릿이 없습니다. 위 버튼으로 작년 또는 올해 행사를 가져오세요.</p></section>';
    var STATUS = { ok: '', same: '이미 들어 있음', exists: '', notschool: '', none: '' };
    h += '<div class="ttscroll"><table class="data"><tr><th></th><th class="l">행사</th><th class="l">규칙</th><th class="l">' + st.year + '학년도 날짜</th><th class="l">학년별 교시</th><th class="l">상태</th><th></th></tr>' +
      rows.map(function (x) {
        var t = x.tpl, can = x.status === 'ok';
        return '<tr><td><input type="checkbox" data-tpl-pick="' + x.i + '"' + (can && !unchecked[x.i] ? ' checked' : '') + (can ? '' : ' disabled') + ' aria-label="' + esc(t.name) + ' 넣기"></td>' +
          '<td class="l"><input data-tpl-name="' + x.i + '" value="' + esc(t.name) + '" aria-label="행사 이름" style="width:10rem"></td>' +
          '<td class="l"><select data-tpl-kind="' + x.i + '" aria-label="규칙"><option value="nth"' + (t.rule.kind === 'nth' ? ' selected' : '') + '>' + (t.rule.kind === 'nth' ? X.ruleText(t.rule) : '같은 월·주차·요일') + '</option><option value="fixed"' + (t.rule.kind === 'fixed' ? ' selected' : '') + '>' + (t.rule.kind === 'fixed' ? X.ruleText(t.rule) + ' (고정)' : '같은 날짜') + '</option></select></td>' +
          '<td class="l">' + (x.date ? '<input type="date" data-tpl-date="' + x.i + '" value="' + x.date + '" aria-label="올해 날짜"> ' + E.WEEKDAY[E.dow(x.date)] : '—') + '</td>' +
          '<td class="l muted">' + (Object.keys(t.periods).length ? E.GRADES.map(function (g) { return t.periods[g] == null ? '-' : t.periods[g]; }).join('/') : '기준') + '</td>' +
          '<td class="l">' + (x.status === 'ok' ? '<span class="chip ok">넣을 수 있음</span>' : x.status === 'same' ? '<span class="chip info">' + STATUS.same + '</span>' : '<span class="chip warn">' + esc(x.why) + '</span>') + '</td>' +
          '<td><button class="btn text" data-tpl-del="' + x.i + '">빼기</button></td></tr>';
      }).join('') + '</table></div>';
    if (pick.length) {
      var r0 = api.getResult(), r1 = E.build(X.applyTemplates(st, pick), H);
      h += '<p>선택한 ' + pick.length + '개를 넣으면 수업일수 ' + r0.totals.days.total + '일(그대로) · ' + E.GRADES.map(function (g) {
        var a = r0.totals.hours[g].total, b = r1.totals.hours[g].total; return g + '학년 ' + fmt(b) + (a !== b ? '(' + (b > a ? '+' : '') + (b - a) + ')' : '');
      }).join(' · ') + '</p>';
    }
    return h + '<div class="ttbar"><button class="btn primary" data-ext="tplApply"' + (pick.length ? '' : ' disabled') + '>선택한 ' + pick.length + '개 ' + st.year + '학년도에 넣기</button><span class="muted">넣은 뒤에는 달력에서 날짜를 눌러 고치거나 지웁니다.</span></div></section>';
  }

  // ④ 홈페이지용 HTML
  function homeCard(st) {
    var r = api.getResult();
    if (!r.ready) return '<section class="card"><h2>홈페이지용 학사일정</h2><p>학사일정 날짜를 먼저 정하세요.</p></section>';
    var html = X.homepageHtml(r, st.school.name);
    return '<section class="card"><div class="ttbar"><h2>홈페이지용 학사일정</h2><button class="btn primary" data-ext="copy">' + (copied ? '복사했습니다' : 'HTML 코드 복사') + '</button></div>' +
      '<p>월별 행사·공휴일·휴업일·방학을 표로 만듭니다. 스타일이 태그 안에 들어 있어 학교 홈페이지 편집기의 <b>HTML(소스) 보기</b>에 그대로 붙여 넣으면 됩니다. 입학초기 적응 날은 기간 한 줄로 나옵니다.</p>' +
      '<details><summary>코드 보기</summary><textarea id="homeCode" readonly rows="8" style="width:100%;font-family:monospace;font-size:.8rem">' + esc(html) + '</textarea></details>' +
      '<div class="ttscroll" style="padding:.8rem;background:#fff">' + html + '</div></section>';
  }

  // ---------- 동작 ----------
  function events() {
    $('#compare').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmp]'); if (b) { cmpKey = b.dataset.cmp; renderCompare(); }
    });
    var el = $('#tools');
    el.addEventListener('change', function (e) {
      var t = e.target, d = t.dataset, st = api.getState();
      if (d.ad) {
        if (d.ad === 'from' || d.ad === 'to') adaptForm[d.ad] = t.value || null;
        else adaptForm.periods[+d.ad.slice(1)] = Math.max(0, Math.min(8, +t.value || 0));
        adaptMsg = ''; renderTools(); return;
      }
      if (d.tplPick != null) { if (t.checked) delete unchecked[d.tplPick]; else unchecked[d.tplPick] = 1; renderTools(); return; }
      if (d.tplName != null) { var v = t.value.trim(); if (v) { tpl[+d.tplName].name = v.slice(0, 60); saveTpl(); } renderTools(); return; }
      if (d.tplKind != null) {
        var x = tpl[+d.tplKind], date = X.dateFromRule(x.rule, st.year);
        if (date) { x.rule = X.ruleFromDate(date, t.value); saveTpl(); }
        renderTools(); return;
      }
      if (d.tplDate != null && t.value) {
        var y = tpl[+d.tplDate]; y.rule = X.ruleFromDate(t.value, y.rule.kind); saveTpl(); renderTools();
      }
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var st = api.getState(), d = b.dataset;
      if (d.tplDel != null) { tpl.splice(+d.tplDel, 1); unchecked = {}; saveTpl(); renderTools(); return; }
      if (d.ext === 'adaptApply') {
        var a = X.applyAdapt(st, H, adaptForm);
        adaptMsg = a.days.length + '일 만들었습니다' + (a.skipped.length ? ' · ' + a.skipped.length + '일 건너뜀' : '');
        api.commit(a.state); return;
      }
      if (d.ext === 'adaptClear') {
        var n = (st.events || []).filter(X.isAutoAdapt).length;
        adaptMsg = n + '일 지웠습니다'; adaptForm = null; api.commit(X.applyAdapt(st, H, null).state); return;
      }
      if (d.ext === 'fromPrev') {
        if (tpl.length && !prevArmed) { prevArmed = true; renderTools(); setTimeout(function () { if (prevArmed) { prevArmed = false; render(); } }, 6000); return; }
        prevArmed = false; tplMsg = (st.year - 1) + '학년도 자료를 찾는 중…'; renderTools();
        api.otherYear(st.year - 1).then(function (p) {
          if (!p) { tplMsg = (st.year - 1) + '학년도 학사일정이 시트·이 브라우저 어디에도 없습니다.'; render(); return; }
          var add = X.templatesFromState(p, p.dates);
          tpl = X.mergeTemplates(tpl, add); unchecked = {};
          tplMsg = (st.year - 1) + '학년도 행사 ' + add.length + '개를 가져왔습니다. 날짜와 상태를 확인하고 넣으세요.';
          saveTpl(); render();
        });
        return;
      }
      if (d.ext === 'fromThis') {
        var add2 = X.templatesFromState(st, st.dates);
        tpl = X.mergeTemplates(tpl, add2); unchecked = {};
        tplMsg = add2.length ? st.year + '학년도 행사 ' + add2.length + '개를 템플릿에 담았습니다. 내년에 불러 쓸 수 있습니다.' : '담을 행사가 없습니다(시업식·방학식 등 학사 날짜 행사는 빼고 셉니다).';
        saveTpl(); renderTools(); return;
      }
      if (d.ext === 'tplApply') {
        var rows = X.previewTemplates(st, H, tpl).filter(function (x) { return x.status === 'ok' && !unchecked[x.i]; });
        tplMsg = rows.length + '개 행사를 ' + st.year + '학년도에 넣었습니다.'; unchecked = {};
        api.commit(X.applyTemplates(st, rows)); return;
      }
      if (d.ext === 'tplRemote') { tpl = X.sanitizeTemplates(tplConflict.data); tplBase = tplConflict.savedAt; tplConflict = null; localSave(false); renderTools(); return; }
      if (d.ext === 'tplMine') { tplConflict = null; push(true).then(renderTools); return; }
      if (d.ext === 'copy') {
        var code = X.homepageHtml(api.getResult(), st.school.name);
        var done = function () { copied = true; renderTools(); setTimeout(function () { copied = false; if (!$('#tab-tools').hidden) renderTools(); }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { selectCode(); });
        else selectCode();
      }
    });
  }
  // 클립보드가 막힌 브라우저: 코드 칸을 펼쳐 선택해 둔다(Ctrl+C)
  function selectCode() { var t = $('#homeCode'); if (!t) return; t.closest('details').open = true; t.focus(); t.select(); }

  window.ExtUI = {
    init: function (a) { api = a; events(); },
    load: load,
    render: render
  };
})();
