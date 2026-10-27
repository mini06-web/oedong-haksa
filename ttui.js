/* 화면: 담임·전담 탭 (김해외동초 2단계). 계산은 timetable.js, 공식 시수는 engine.js
 * 시간표는 학년도별로 시트 '시간표' 탭(비밀번호로만 읽고 씀)과 이 브라우저(haksa:tt:연도)에 저장한다.
 */
(function () {
  'use strict';
  var E = window.Engine, H = window.HOLIDAY_DATA, ST = window.Store, T = window.Timetable;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var api = null;
  var year = null, tt = null, base = 0, conflict = null, info = '', importMsg = '', importWarn = [];
  var view = 'year', editSem = 1, editCls = null, importArmed = false, copyArmed = null, filterTeacher = '';
  var pending = false, timer = null, chain = Promise.resolve();
  var DAYS = T.DAYS;

  function esc(s) { return api.esc(s); }
  function fmt(n) { return api.fmt(n); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hm(ms) { var t = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; }; return (t.getMonth() + 1) + '.' + t.getDate() + '. ' + p(t.getHours()) + ':' + p(t.getMinutes()); }

  // ---------- 저장 ----------
  function key(y) { return 'haksa:tt:' + y; }
  function localLoad(y) {
    try { var o = JSON.parse(localStorage.getItem(key(y)) || 'null'); return o && o.data ? { data: T.sanitize(o.data), base: o.base || 0, dirty: !!o.dirty } : null; } catch (e) { return null; }
  }
  function localSave(y, data, dirty) { try { localStorage.setItem(key(y), JSON.stringify({ savedAt: Date.now(), data: data, base: base, dirty: dirty })); } catch (e) { /* 막힘 */ } }

  // 시트와 브라우저 백업 중 고른다(학사일정과 같은 규칙)
  function load(y) {
    year = y; tt = null; base = 0; conflict = null; info = ''; importMsg = ''; importWarn = []; editCls = null;
    var lp = localLoad(y);
    if (!api.canWrite()) {
      if (lp) { tt = lp.data; base = lp.base; }
      info = api.cloudState() === 'off' ? '' : '시간표는 담당자 비밀번호를 연결해야 시트에서 읽고 저장합니다.' + (lp ? ' 지금은 이 브라우저 자료입니다.' : '');
      render(); return Promise.resolve();
    }
    info = '시트에서 시간표를 읽는 중…'; render();
    return ST.ttGet(y).then(function (c) {
      if (y !== year) return;
      info = '';
      if (c) base = c.savedAt;
      if (lp && lp.dirty && c && c.savedAt > lp.base) { tt = lp.data; conflict = c; }
      else if (lp && lp.dirty) { tt = lp.data; push(false); }
      else if (c) { tt = T.sanitize(c.data); localSave(y, tt, false); info = (c.savedBy ? '「' + c.savedBy + '」에서 ' : '') + hm(c.savedAt) + ' 저장본'; }
      else if (lp) { tt = lp.data; push(false); }
      render();
    }, function (e) {
      if (y !== year) return;
      if (lp) { tt = lp.data; base = lp.base; }
      info = '시트에서 시간표를 읽지 못했습니다' + (e && e.detail ? '(' + e.detail + ')' : '') + '. 이 브라우저 자료를 씁니다.';
      render();
    });
  }
  function save() {
    localSave(year, tt, true);
    if (!api.canWrite()) { info = '이 브라우저에만 저장했습니다(시트는 비밀번호 연결 후).'; return; }
    if (conflict) return;
    pending = true; clearTimeout(timer); info = '저장 중…';
    timer = setTimeout(function () { push(false); }, 800);
  }
  // retry: 연결 문제로 실패하면 몇 초 뒤 한 번 더 시도(GAS가 잠깐 느리거나 끊길 때)
  function push(force, retry) {
    var y = year;
    chain = chain.then(function () {
      pending = false;
      var data = clone(tt);
      return ST.ttSave(y, data, base, force).then(function (res) {
        if (y !== year) return;
        if (res.conflict) { conflict = res.remote; info = ''; render(); return; }
        base = res.savedAt; if (!pending) localSave(y, tt, false);
        info = '시트에 저장 ' + hm(res.savedAt); updateInfo();
      }, function (e) {
        if (y !== year) return;
        var auth = e && e.message === 'auth';
        if (!auth && !retry) { info = '시트 저장 재시도 중…'; updateInfo(); setTimeout(function () { if (y === year && !pending) push(force, true); }, 3000); return; }
        info = '시트 저장 실패' + (auth ? '(비밀번호)' : e && e.detail ? '(' + e.detail + ')' : '(연결)') + ' · 이 브라우저에 저장됨'; updateInfo(true);
      });
    });
    return chain;
  }
  function updateInfo(failed) {
    var el = $('#ttInfo'); if (!el) return;
    el.textContent = info;
    if (failed && api.canWrite()) el.insertAdjacentHTML('beforeend', ' <button class="btn small" data-tt="retry">다시 저장</button>');
  }

  // ---------- 게시판에서 가져오기 ----------
  function importBoard(which) {
    importMsg = '게시판을 읽는 중…'; importWarn = []; render();
    ST.board().then(function (b) {
      var parsed = T.parseBoard(b.values);
      tt = T.fromBoard(parsed, tt, which);
      importWarn = parsed.warnings;
      importMsg = '「' + b.title + '」 ' + b.sheet + ' 탭에서 ' + (which === 'both' ? '1·2학기' : which + '학기') + ' 시간표를 가져왔습니다: 학급 ' + parsed.classes.length + '개, 전담·강사 ' + parsed.teachers.length + '명.';
      save(); render();
    }, function (e) {
      importMsg = '가져오지 못했습니다: ' + (e && e.detail ? e.detail : e && e.message === 'auth' ? '비밀번호를 다시 연결하세요' : '시트 연결 실패');
      render();
    }).catch(function (e) { importMsg = '게시판 시간표를 해석하지 못했습니다: ' + e.message; render(); });
  }

  // ---------- 그리기 ----------
  function render() {
    if (window.ExtUI) ExtUI.render(); // 내부 비교 탭도 이 시간표를 씀
    var el = $('#staff'); if (!el || $('#tab-staff').hidden) return;
    var st = api.getState(), r = api.getResult(), h = '';
    var canImport = api.canWrite();
    var which = tt ? '2' : 'both';
    h += '<section class="card"><div class="ttbar"><h2>학급별 담임·전담 시수 <small class="muted">' + st.year + '학년도</small></h2>' +
      '<select id="ttWhich" aria-label="가져올 학기"><option value="both">1·2학기 모두</option><option value="1">1학기만</option><option value="2">2학기만</option></select>' +
      '<button class="btn' + (importArmed ? ' danger' : ' primary') + '" data-tt="import"' + (canImport ? '' : ' disabled title="담당자 비밀번호를 연결하세요"') + '>' + (importArmed ? '한 번 더 누르면 덮어씁니다' : '게시판에서 가져오기') + '</button>' +
      '<span id="ttInfo" class="muted">' + esc(info) + '</span></div>' +
      '<p>「외동 게시판」의 기초시간표·전담시간표를 읽어 날짜마다 요일·교시 담당자를 대입합니다. 공식 판정(수업일수·학년군 시수)은 학년 단위 그대로이고, 여기서는 그 시수를 학급별로 담임·전담으로 나눕니다.' +
      (tt && tt.importedAt && isFinite(Date.parse(tt.importedAt)) ? ' 게시판에서 가져온 시각: ' + hm(Date.parse(tt.importedAt)) : '') + '</p>' +
      (importMsg ? '<p><b>' + esc(importMsg) + '</b></p>' : '') +
      (importWarn.length ? '<details><summary>가져오며 확인할 점 ' + importWarn.length + '건</summary><ul class="ttwarn">' + importWarn.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></details>' : '') +
      '</section>';
    if (conflict) h += '<div class="notice bad"><span>' + (conflict.savedBy ? '「' + esc(conflict.savedBy) + '」에서 ' : '') + hm(conflict.savedAt) + '에 시트에 더 최근 시간표를 저장했습니다. 지금 화면의 수정은 이 브라우저에만 있습니다.</span><button class="btn small primary" data-tt="takeRemote">시트 것 불러오기</button><button class="btn small danger" data-tt="takeMine">내 것으로 시트 덮어쓰기</button></div>';
    if (!tt) {
      h += '<section class="card"><p>아직 ' + st.year + '학년도 시간표가 없습니다. ' + (canImport ? '위의 <b>게시판에서 가져오기</b>를 누르세요. 지금 게시판 시간표는 2학기용이라, 처음에는 1·2학기 모두에 넣고 1학기는 아래 편집에서 과학 전담 칸 등을 고칩니다.' : '설정에서 담당자 비밀번호를 연결한 뒤 가져올 수 있습니다.') + '</p></section>';
      el.innerHTML = h; $('#ttWhich').value = which; return;
    }
    var out = T.compute(r, tt);
    h += baseCard(st, out) + resultCard(r, out) + droppedCard(out) + editorCard();
    el.innerHTML = h;
    $('#ttWhich').value = importArmed ? importArmed : which;
  }

  // 요일별 기준 교시: 시간표와 설정이 다르면 반영 안내
  function proposal(st) {
    var gp1 = T.gradePeriods(tt, 1), gp2 = T.gradePeriods(tt, 2), s2 = clone(st), changed = false;
    s2.basePeriods2 = s2.basePeriods2 || {};
    E.GRADES.forEach(function (g) {
      var a = gp1.periods[g], b = gp2.periods[g]; if (!a || !b) return;
      var row2 = b.map(function (v, i) { return v === a[i] ? null : v; });
      var cur1 = E.basePeriodsFor(st, g, 1), cur2 = E.basePeriodsFor(st, g, 2);
      if (cur1.join() !== a.join() || cur2.join() !== b.join()) changed = true;
      s2.basePeriods[g] = a.slice();
      if (row2.some(function (v) { return v != null; })) s2.basePeriods2[g] = row2; else delete s2.basePeriods2[g];
    });
    return { state: s2, changed: changed, gp1: gp1, gp2: gp2 };
  }
  function baseCard(st, out) {
    var p = proposal(st), warn = p.gp1.mismatch.concat(p.gp2.mismatch);
    if (!p.changed && !warn.length) return '';
    var h = '<section class="card"><h2>요일별 기준 교시</h2>';
    if (p.changed) {
      var r1 = api.getResult(), r2 = E.build(p.state, H);
      h += '<p>시간표의 요일별 교시가 설정의 기준 시수와 다릅니다. 반영하면 공식 시수가 아래처럼 바뀝니다(수업일수는 그대로). 바꾸기 전 값은 설정에서 다시 고칠 수 있습니다.</p>' +
        '<table class="data"><tr><th class="l">학년</th><th>1학기 시간표 (월~금)</th><th>지금 설정</th><th>2학기 시간표</th><th>지금 설정</th><th>연간 시수</th></tr>' +
        E.GRADES.map(function (g) {
          var a = p.gp1.periods[g], b = p.gp2.periods[g]; if (!a) return '';
          var c1 = E.basePeriodsFor(st, g, 1), c2 = E.basePeriodsFor(st, g, 2), t1 = r1.totals.hours[g].total, t2 = r2.totals.hours[g].total;
          var cellA = function (x, y) { return '<td' + (x.join() !== y.join() ? ' class="ttdiff"' : '') + '>' + x.join(' · ') + '</td>'; };
          return '<tr><td class="l">' + g + '학년</td>' + cellA(a, c1) + '<td class="muted">' + c1.join(' · ') + '</td>' + cellA(b, c2) + '<td class="muted">' + c2.join(' · ') + '</td><td>' + fmt(t1) + (t1 !== t2 ? ' → <b>' + fmt(t2) + '</b> (' + (t2 > t1 ? '+' : '') + (t2 - t1) + ')' : '') + '</td></tr>';
        }).join('') + '</table><div><button class="btn primary" data-tt="applyBase">시간표 교시를 기준 시수에 반영</button></div>';
    }
    if (warn.length) h += '<ul class="ttwarn">' + warn.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    return h + '</section>';
  }

  function resultCard(r, out) {
    var specs = tt.teachers.filter(function (t) { return t.kind === 'specialist'; });
    var sports = tt.teachers.filter(function (t) { return t.kind === 'sports'; });
    var k = view === 'year' ? 'total' : 'sem' + view;
    var tot = { home: 0, sports: 0, spec: {}, specSum: 0, all: 0 };
    var rows = tt.classes.map(function (c) {
      var o = out.classes[c.cls], cells = specs.map(function (t) {
        var v = o.specialist[t.id] ? o.specialist[t.id][k] : 0; tot.spec[t.id] = (tot.spec[t.id] || 0) + v;
        return '<td>' + (v ? fmt(v) : '<span class="muted">·</span>') + '</td>';
      }).join('');
      tot.home += o.homeroom[k]; tot.sports += o.sports[k]; tot.specSum += o.specialistSum[k]; tot.all += o.total[k];
      var extra = o.extra[k] ? ' <span class="tag" title="시간표보다 교시를 늘린 날의 추가 교시(담임)">+' + o.extra[k] + '</span>' : '';
      return '<tr><td class="l">' + c.cls + '</td><td class="l">' + esc(c.teacher) + '</td><td><b>' + fmt(o.homeroom[k]) + '</b>' + extra + '</td>' +
        (sports.length ? '<td class="muted">' + (o.sports[k] ? fmt(o.sports[k]) : '·') + '</td>' : '') + cells + '<td>' + fmt(o.specialistSum[k]) + '</td><td>' + fmt(o.total[k]) + '</td></tr>';
    }).join('');
    var mm = out.mismatch.length ? '<p class="ttnote">기준 교시와 시간표 교시가 다른 요일이 있어(위 카드), 그 요일은 짧은 쪽에 맞춰 계산합니다. 시간표보다 많은 교시는 담임 수업(+표시), 적은 교시는 뒤쪽부터 빠진 것으로 셉니다.</p>' : '';
    return '<section class="card"><div class="ttbar"><h2>학급별 시수</h2><div class="seg" role="group" aria-label="기간">' +
      [['1', '1학기'], ['2', '2학기'], ['year', '연간']].map(function (x) { return '<button data-tt-view="' + x[0] + '" aria-pressed="' + (String(view) === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="ttscroll"><table class="data"><tr><th class="l">학급</th><th class="l">담임</th><th>담임 시수</th>' +
      (sports.length ? '<th title="공식적으로 담임 수업. 담임 시수에 포함">스포츠강사<br><small>(담임에 포함)</small></th>' : '') +
      specs.map(function (t) { return '<th title="' + esc(t.desc) + '">' + esc(t.name) + '<br><small>' + esc(t.desc) + '</small></th>'; }).join('') +
      '<th>전담 계</th><th>합계<br><small>(공식 시수)</small></th></tr>' + rows +
      '<tr class="sum"><td class="l" colspan="2">합계</td><td>' + fmt(tot.home) + '</td>' + (sports.length ? '<td>' + fmt(tot.sports) + '</td>' : '') +
      specs.map(function (t) { return '<td>' + fmt(tot.spec[t.id] || 0) + '</td>'; }).join('') + '<td>' + fmt(tot.specSum) + '</td><td>' + fmt(tot.all) + '</td></tr></table></div>' +
      '<p>합계(공식 시수)는 판정 띠의 학년 시수와 같습니다. 스포츠강사 수업은 강사에게 수업권이 없어 공식적으로 담임 수업으로 셉니다. 학년별 비교용 0.5시간 계산은 3단계 「내부 비교」 화면에서만 합니다.</p>' + mm + '</section>';
  }

  function droppedCard(out) {
    var list = out.dropped.filter(function (x) { return x.kind === 'specialist' && (!filterTeacher || x.teacher === filterTeacher); });
    var all = out.dropped.filter(function (x) { return x.kind === 'specialist'; });
    var by = {}; all.forEach(function (x) { by[x.teacher] = (by[x.teacher] || 0) + 1; });
    var specs = tt.teachers.filter(function (t) { return t.kind === 'specialist'; });
    return '<section class="card"><details' + (filterTeacher ? ' open' : '') + '><summary><b>공휴일·행사로 빠진 전담 수업 ' + all.length + '건</b> <span class="muted">' +
      specs.filter(function (t) { return by[t.id]; }).map(function (t) { return esc(t.name) + ' ' + by[t.id]; }).join(' · ') + '</span></summary>' +
      '<p>공휴일·자율휴업일(방학 중 제외)에는 그날 전담 수업이 모두, 행사로 교시가 줄어든 날에는 뒤쪽 교시의 전담 수업이 빠진 것으로 셉니다.</p>' +
      '<select id="ttFilter" aria-label="전담 교사 고르기"><option value="">전담 교사 모두</option>' + specs.map(function (t) { return '<option value="' + esc(t.id) + '"' + (filterTeacher === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' +
      '<div class="ttscroll short"><table class="data"><tr><th class="l">날짜</th><th class="l">학급</th><th>교시</th><th class="l">교사</th><th class="l">사유</th></tr>' +
      list.map(function (x) {
        return '<tr><td class="l">' + api.md(x.date) + '(' + E.WEEKDAY[E.dow(x.date)] + ')</td><td class="l">' + x.cls + '</td><td>' + x.period + '</td><td class="l">' + esc(x.teacher) + '</td><td class="l">' + (x.why === 'holiday' ? '' : '<span class="tag">단축</span> ') + esc(x.reason) + '</td></tr>';
      }).join('') + '</table></div></details></section>';
  }

  function editorCard() {
    var sd = tt.sem[editSem];
    if (!editCls || !sd.subjects[editCls]) editCls = tt.classes.length ? tt.classes[0].cls : null;
    var h = '<section class="card"><details id="ttEditor"' + (editorOpen ? ' open' : '') + '><summary><b>학기별 시간표 보기·고치기</b> <span class="muted">전담 배정을 칸마다 바꿀 수 있습니다(1학기 과학 교차 편성 등)</span></summary>';
    h += '<div class="ttbar"><div class="seg" role="group" aria-label="학기">' + [1, 2].map(function (s) { return '<button data-tt-sem="' + s + '" aria-pressed="' + (editSem === s) + '">' + s + '학기</button>'; }).join('') + '</div>' +
      '<select id="ttCls" aria-label="학급">' + tt.classes.map(function (c) { return '<option' + (c.cls === editCls ? ' selected' : '') + '>' + c.cls + '</option>'; }).join('') + '</select>' +
      '<button class="btn small' + (copyArmed === '2to1' ? ' danger' : '') + '" data-tt="copy2to1">' + (copyArmed === '2to1' ? '한 번 더: 1학기를 2학기 표로 덮어씀' : '2학기 표를 1학기로 복사') + '</button>' +
      '<button class="btn small' + (copyArmed === '1to2' ? ' danger' : '') + '" data-tt="copy1to2">' + (copyArmed === '1to2' ? '한 번 더: 2학기를 1학기 표로 덮어씀' : '1학기 표를 2학기로 복사') + '</button></div>';
    if (editCls) {
      var subj = sd.subjects[editCls], asg = sd.assign[editCls], opts = function (v) {
        return '<option value="">담임</option>' + tt.teachers.map(function (t) { return '<option value="' + esc(t.id) + '"' + (v === t.id ? ' selected' : '') + '>' + esc(t.name) + (t.kind === 'sports' ? '(강사)' : '') + '</option>'; }).join('');
      };
      h += '<table class="data ttgrid" aria-label="' + editSem + '학기 ' + editCls + ' 시간표"><tr><th>교시</th>' + DAYS.map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr>';
      for (var p = 0; p < T.MAXP; p++) {
        h += '<tr><th>' + (p + 1) + '</th>' + DAYS.map(function (_, d) {
          if (p >= subj[d].length) return '<td class="muted">·</td>';
          var v = asg[d][p];
          return '<td class="' + (v ? 'ttspec' : '') + '"><div>' + esc(subj[d][p]) + '</div><select data-slot="' + d + ':' + p + '" aria-label="' + DAYS[d] + ' ' + (p + 1) + '교시 담당">' + opts(v) + '</select></td>';
        }).join('') + '</tr>';
      }
      h += '</table>';
    }
    // 주간 점검: 과학 교차 편성, 같은 시간 겹침, 교사별 주당 시간
    var sc = T.scienceCheck(tt).filter(function (x) { return x.sem === editSem; });
    var cf = T.conflicts(tt, editSem), wk = T.weekly(tt, editSem);
    h += '<h3>' + editSem + '학기 점검</h3>';
    if (sc.length) h += '<p>과학 전담 주당 시간(규칙: 1학기 3·5학년 3, 4·6학년 2 / 2학기 반대): ' + sc.map(function (x) {
      return '<span class="chip ' + (x.ok ? 'ok' : 'bad') + '" title="' + esc(x.teacher) + '">' + x.cls + ' ' + x.hours + (x.ok ? '' : '/' + x.expected) + '</span>';
    }).join(' ') + '</p>';
    h += cf.length ? '<ul class="ttwarn">' + cf.map(function (x) { return '<li>' + esc(x.teacher) + ' ' + x.day + ' ' + x.period + '교시에 ' + x.classes.join(', ') + ' 겹침</li>'; }).join('') + '</ul>' : '<p>같은 시간에 두 반에 배정된 전담 교사는 없습니다.</p>';
    h += '<table class="data"><tr><th class="l">교사</th><th>주당</th><th class="l">학급별</th></tr>' + tt.teachers.map(function (t) {
      var m = wk[t.id] || {}, ks = Object.keys(m).sort(), n = ks.reduce(function (a, c) { return a + m[c]; }, 0);
      return '<tr><td class="l">' + esc(t.name) + ' <small class="muted">' + esc(t.desc) + '</small></td><td>' + n + '</td><td class="l">' + ks.map(function (c) { return c + ' ' + m[c]; }).join(' · ') + '</td></tr>';
    }).join('') + '</table>';
    return h + '</details></section>';
  }
  var editorOpen = false;

  // ---------- 이벤트 ----------
  function events() {
    var el = $('#staff');
    el.addEventListener('toggle', function (e) { if (e.target.id === 'ttEditor') editorOpen = e.target.open; }, true);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ttView) { view = b.dataset.ttView === 'year' ? 'year' : +b.dataset.ttView; render(); return; }
      if (b.dataset.ttSem) { editSem = +b.dataset.ttSem; copyArmed = null; render(); return; }
      var a = b.dataset.tt;
      if (a === 'import') {
        var which = $('#ttWhich').value;
        if (tt && importArmed !== which) { importArmed = which; render(); setTimeout(function () { if (importArmed) { importArmed = false; render(); } }, 6000); return; }
        importArmed = false; importBoard(which === 'both' ? 'both' : +which);
      } else if (a === 'applyBase') {
        api.commit(proposal(api.getState()).state);
        render();
      } else if (a === 'copy2to1' || a === 'copy1to2') {
        var k = a === 'copy2to1' ? '2to1' : '1to2';
        if (copyArmed !== k) { copyArmed = k; render(); return; }
        copyArmed = null;
        if (k === '2to1') tt.sem[1] = clone(tt.sem[2]); else tt.sem[2] = clone(tt.sem[1]);
        save(); render();
      } else if (a === 'retry') {
        info = '저장 중…'; updateInfo(); push(false, true);
      } else if (a === 'takeRemote' && conflict) {
        tt = T.sanitize(conflict.data); base = conflict.savedAt; conflict = null; localSave(year, tt, false); info = '시트의 시간표를 불러옴'; render();
      } else if (a === 'takeMine' && conflict) {
        conflict = null; push(true); render();
      }
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.slot) {
        var x = t.dataset.slot.split(':');
        tt.sem[editSem].assign[editCls][+x[0]][+x[1]] = t.value;
        save(); render();
        var again = $('#staff [data-slot="' + t.dataset.slot + '"]'); if (again) again.focus();
      } else if (t.id === 'ttCls') { editCls = t.value; render(); var c = $('#ttCls'); if (c) c.focus(); }
      else if (t.id === 'ttFilter') { filterTeacher = t.value; render(); }
      else if (t.id === 'ttWhich') { importArmed = false; }
    });
  }

  window.TTUI = {
    init: function (a) { api = a; events(); },
    load: load,
    render: render,
    data: function () { return tt; }
  };
})();
