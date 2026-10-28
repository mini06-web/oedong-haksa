/* 화면: 연간 한눈에 / 주별 시수 / 설정 + 날짜 서랍. 계산은 전부 engine.js */
(function () {
  'use strict';
  var H = window.HOLIDAY_DATA, E = window.Engine;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var GR = E.GRADES;
  var state, result, dayMap = {}, selected = null;

  // ---------- 저장: 구글시트(GAS) + 브라우저 백업 ----------
  // VIEW: 교직원 보기 전용 페이지(view.html). 시트에서 읽기만 하고 아무것도 저장하지 않는다.
  var VIEW = !!window.HAKSA_VIEW;
  var undoState = null;
  // cloud: 'off'(주소 없음) | 'on' | 'offline'(연결 실패). canWrite: 담당자 비밀번호 확인됨
  var ST = window.Store, cloud = 'off', canWrite = false, cloudYears = [], writeTimer = null, firstRun = false;
  var base = {};       // 학년도별: 시트에서 마지막으로 받았거나 저장한 savedAt(충돌 판단 기준)
  var conflict = null; // { year, remote:{ state, savedAt, savedBy } } 다른 곳에서 더 최근에 저장함
  var lastCloudAt = 0;
  var KEY = function (y) { return 'haksa:' + y; };
  function store(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  // 브라우저 백업은 { savedAt, state, base, dirty } 형태. dirty: 시트에 아직 못 올린 수정이 있음
  function localLoad(year) {
    var raw = read(KEY(year)); if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      return o && o.state ? { state: E.sanitize(o.state), savedAt: o.savedAt || 0, base: o.base || 0, dirty: !!o.dirty } : { state: E.sanitize(o), savedAt: 0, base: 0, dirty: true };
    } catch (e) { return null; }
  }
  function localSave(y, st, dirty) { return store(KEY(y), JSON.stringify({ savedAt: Date.now(), state: st, base: base[y] || 0, dirty: dirty })); }
  function localMarkSynced(y) { var lp = localLoad(y); if (lp) store(KEY(y), JSON.stringify({ savedAt: lp.savedAt, state: lp.state, base: base[y] || 0, dirty: false })); }
  function now() { var t = new Date(); return pad(t.getHours()) + ':' + pad(t.getMinutes()); }
  function hm(ms) { var t = new Date(ms); return (t.getMonth() + 1) + '.' + t.getDate() + '. ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); }
  function setSaveText(t) { $('#saveState').textContent = t; }
  function whoText(r) { return r && r.savedBy ? '「' + r.savedBy + '」에서 ' : ''; }
  function cloudFail(e) {
    if (e && e.message === 'auth') { canWrite = false; ST.setPassword(null); }
    else if (e && e.message !== 'off') cloud = 'offline';
  }
  function cloudOk() { if (cloud !== 'on') cloud = 'on'; }

  // 시트와 브라우저 백업을 비교해 열 내용을 고른다
  // push: 브라우저 쪽이 더 새로워 시트에 올려야 함
  function loadYear(year, mode, endDate) {
    var lp = VIEW ? null : localLoad(year);
    var cp = cloud !== 'off' ? ST.get(year).then(function (c) { cloudOk(); return c; }, function (e) { cloudFail(e); return undefined; }) : Promise.resolve(undefined);
    return cp.then(function (c) {
      if (c) { base[year] = c.savedAt; lastCloudAt = c.savedAt; }
      if (c === undefined || (c === null && VIEW)) {
        if (lp) return { state: lp.state, fresh: false, from: 'local', push: lp.dirty };
        return { state: E.draft(year, H, { mode: mode || 'feb', endDate: endDate }).state, fresh: true, from: 'draft', push: !VIEW, empty: VIEW };
      }
      if (lp && lp.dirty && c && c.savedAt > (lp.base || 0)) {
        conflict = { year: year, remote: c };
        return { state: lp.state, fresh: false, from: 'local' };
      }
      if (lp && lp.dirty) return { state: lp.state, fresh: false, from: 'local', push: true };
      if (c) { var st = E.sanitize(c.state); if (!VIEW) { localSave(year, st, false); } return { state: st, fresh: false, from: 'cloud' }; }
      if (lp) return { state: lp.state, fresh: false, from: 'local', push: true };
      return { state: E.draft(year, H, { mode: mode || 'feb', endDate: endDate }).state, fresh: true, from: 'draft', push: true };
    });
  }
  function save() {
    if (VIEW) return;
    state.school.name = $('#schoolName').value.trim();
    store('haksa:school', state.school.name);
    var y = state.year;
    var ok = localSave(y, state, true) && store('haksa:last', String(y));
    if (conflict && conflict.year === y) { setSaveText('시트와 충돌 · 브라우저에만 저장 ' + now()); return; }
    if (cloud === 'off') { setSaveText(ok ? '브라우저에만 저장 ' + now() : '저장 실패 · 설정에서 파일로 내려받으세요'); return; }
    if (cloud === 'offline') { setSaveText('시트 연결 안 됨 · 브라우저에 저장 ' + now()); return; }
    if (!canWrite) { setSaveText('브라우저에만 저장 ' + now() + ' · 시트는 비밀번호 필요'); return; }
    pending[y] = clone(state);
    clearTimeout(writeTimer); setSaveText('저장 중…');
    writeTimer = setTimeout(flushSave, 800);
  }
  // 시트 쓰기는 한 번에 하나씩(앞 저장의 savedAt을 받아야 다음 저장의 base가 맞는다)
  var pending = {}, chain = Promise.resolve();
  function flushSave() {
    clearTimeout(writeTimer); writeTimer = null;
    if (cloud !== 'on' || !canWrite) return chain;
    Object.keys(pending).forEach(function (y) {
      chain = chain.then(function () {
        var st = pending[y]; if (!st) return;
        delete pending[y];
        return ST.save(+y, st, base[y] || 0, false).then(function (res) {
          if (res.conflict) {
            conflict = { year: +y, remote: res.remote };
            setSaveText('시트와 충돌 · 브라우저에만 저장'); renderNotice(); return;
          }
          base[y] = res.savedAt; lastCloudAt = res.savedAt;
          if (!pending[y]) localMarkSynced(+y);
          if (cloudYears.indexOf(+y) < 0) cloudYears.push(+y);
          setSaveText('시트에 저장 ' + now());
        }, function (e) {
          cloudFail(e);
          setSaveText(e && e.message === 'auth' ? '비밀번호가 바뀌어 시트 저장 실패 · 브라우저에 저장됨' : '시트 저장 실패 · 브라우저에 저장됨');
          renderNotice();
        });
      });
    });
    return chain;
  }
  // 충돌 해결: 'remote' 시트 것을 연다 | 'mine' 지금 화면 내용으로 시트를 덮어쓴다
  function resolveConflict(how) {
    var c = conflict; if (!c) return;
    conflict = null;
    if (how === 'remote') {
      base[c.year] = c.remote.savedAt; lastCloudAt = c.remote.savedAt;
      state = E.sanitize(c.remote.state); localSave(c.year, state, false);
      $('#schoolName').value = state.school.name || '';
      recompute(); setSaveText('시트의 최신 내용을 불러옴 ' + now()); renderNotice();
      return;
    }
    setSaveText('저장 중…');
    ST.save(c.year, state, base[c.year] || 0, true).then(function (res) {
      base[c.year] = res.savedAt; lastCloudAt = res.savedAt; localMarkSynced(c.year);
      setSaveText('시트를 내 내용으로 덮어씀 ' + now()); renderNotice();
    }, function (e) { cloudFail(e); conflict = c; setSaveText('시트 저장 실패 · 브라우저에 저장됨'); renderNotice(); });
  }
  // 창으로 돌아올 때: 다른 곳(집·학교)에서 그사이 저장했는지 확인
  var checking = false;
  function checkRemote() {
    if (checking || !state || !ST.configured() || conflict) return;
    var y = state.year; checking = true;
    ST.get(y).then(function (c) {
      var wasOffline = cloud === 'offline'; cloudOk();
      if (c && c.savedAt > (base[y] || 0) && y === state.year) {
        var lp = VIEW ? null : localLoad(y), mine = !VIEW && ((lp && lp.dirty) || pending[y]);
        if (mine) { conflict = { year: y, remote: c }; renderNotice(); }
        else {
          base[y] = c.savedAt; lastCloudAt = c.savedAt; state = E.sanitize(c.state);
          if (!VIEW) localSave(y, state, false);
          $('#schoolName').value = state.school.name || '';
          recompute(); setSaveText(VIEW ? viewSaveText() : whoText(c) + '저장한 최신 내용을 불러옴 ' + now());
        }
      } else if (wasOffline && !VIEW) { var l2 = localLoad(y); if (l2 && l2.dirty) save(); renderNotice(); }
    }, function (e) { cloudFail(e); }).then(function () { checking = false; });
  }
  function viewSaveText() { return lastCloudAt ? '보기 전용 · ' + hm(lastCloudAt) + ' 저장본' : '보기 전용'; }
  function refreshCloudYears() { return ST.list().then(function (ys) { cloudOk(); cloudYears = ys.map(function (x) { return +x.year; }).sort(); }, function (e) { cloudFail(e); }); }
  // 작년 시수가 비어 있으면 작년 자료(시트, 없으면 이 브라우저)에서 1·3·5학년 시수를 가져온다
  function linkPrevYear() {
    if (VIEW) return Promise.resolve(false);
    var need = [2, 4, 6].filter(function (g) { return state.prevYear[g] == null; });
    if (!need.length) return Promise.resolve(false);
    var y = state.year - 1;
    return (cloud === 'on' ? ST.get(y).catch(function () { return null; }) : Promise.resolve(null)).then(function (f) {
      var st = f ? E.sanitize(f.state) : (localLoad(y) || {}).state;
      if (!st) return false;
      var r = E.build(st, H);
      if (!r.ready) return false;
      var vals = {}; need.forEach(function (g) { vals[g] = r.totals.hours[g - 1].total; });
      var s2 = clone(state); Object.assign(s2.prevYear, vals);
      s2.prevYearFrom = { year: y, values: vals, confirmed: false };
      state = s2; return true;
    });
  }
  var emptyYear = false;
  function openYear(year, mode) {
    var push = false;
    return flushSave().then(function () { return loadYear(year, mode); }).then(function (o) {
      state = o.state; push = !!o.push; emptyYear = !!o.empty;
      draftModeSel = null; draftEndSel = null; redraftArmed = false;
      if (!state.school.name) state.school.name = read('haksa:school') || '';
      $('#schoolName').value = state.school.name;
      $('#yearSel').value = String(year);
      selected = null; $('#drawer').hidden = true;
      return linkPrevYear();
    }).then(function (linked) {
      recompute();
      // 시트 내용을 그대로 연 경우에는 다시 저장하지 않는다(다른 기기에 불필요한 '새 저장본'이 생기지 않게)
      if (push || linked) save();
      else setSaveText(VIEW ? viewSaveText() : cloud === 'on' ? '시트에서 불러옴 ' + now() : cloud === 'offline' ? '시트 연결 안 됨 · 브라우저 자료' : '브라우저 자료');
      if (!VIEW) store('haksa:last', String(year));
      renderNotice();
      if (!VIEW && window.TTUI) TTUI.load(year);
      if (!VIEW && window.ExtUI) ExtUI.load();
    });
  }
  // 다른 학년도 학사일정(행사 템플릿용): 시트 → 이 브라우저 순. 없으면 null
  function otherYear(y) {
    var cp = cloud === 'on' ? ST.get(y).catch(function () { return null; }) : Promise.resolve(null);
    return cp.then(function (c) { if (c) return E.sanitize(c.state); var lp = localLoad(y); return lp ? lp.state : null; });
  }
  // 비밀번호 확인 후 쓰기 가능 상태로 바꾸고, 브라우저에만 있던 수정이 있으면 올린다
  function connect(pw, remember) {
    return ST.check(pw).then(function (ok) {
      cloudOk();
      if (!ok) { canWrite = false; return false; }
      ST.setPassword(pw, remember); canWrite = true;
      return loadYear(state.year).then(function (o) {
        if (o.from === 'cloud') { state = o.state; recompute(); setSaveText('시트에서 불러옴 ' + now()); }
        else if (o.push) save();
        renderNotice();
        if (window.TTUI) TTUI.load(state.year);
        if (window.ExtUI) ExtUI.load();
        return true;
      });
    }, function (e) { cloudFail(e); renderNotice(); throw e; });
  }

  // ---------- 안내 띠 ----------
  function renderNotice() {
    var el = $('#notice'), h = '', pf = state && state.prevYearFrom, cls = '';
    var errs = result && result.checks ? result.checks.filter(function (c) { return c.level === 'error' && !/^(days-short|hours-short)$/.test(c.code); }) : [];
    if (VIEW) {
      if (cloud === 'off') h = '<span>시트 주소가 설정되지 않았습니다(config.js).</span>';
      else if (cloud === 'offline') { cls = 'bad'; h = '<span>학사일정 시트에 연결하지 못했습니다. 잠시 후 새로고침하세요.</span>'; }
      else if (emptyYear) h = '<span>' + state.year + '학년도 학사일정이 아직 저장되지 않았습니다. 아래는 공휴일만 반영한 예시 초안입니다.</span>';
      el.innerHTML = h; el.hidden = !h; el.className = 'notice' + (cls ? ' ' + cls : '');
      return;
    }
    if (errs.length) { cls = 'bad'; h = '<span>날짜 설정 오류: ' + esc(errs[0].msg) + (errs.length > 1 ? ' 외 ' + (errs.length - 1) + '건' : '') + ' 고치기 전까지 합계와 판정을 믿을 수 없고 엑셀도 만들지 않습니다.</span><button class="btn small primary" data-n="settings">설정 열기</button>'; }
    else if (conflict && state && conflict.year === state.year) { cls = 'bad'; h = '<span>' + whoText(conflict.remote) + hm(conflict.remote.savedAt) + '에 시트에 더 최근 내용을 저장했습니다. 지금 화면의 수정은 이 브라우저에만 저장되어 있습니다. 어느 쪽을 쓸지 고르세요.</span><button class="btn small" data-n="keepFile">내 내용 파일로 받아 두기</button><button class="btn small primary" data-n="takeRemote">시트 것 불러오기</button><button class="btn small danger" data-n="takeMine">내 것으로 시트 덮어쓰기</button>'; }
    else if (undoState) h = '<span>파일을 불러와 ' + state.year + '학년도 내용을 바꿨습니다.</span><button class="btn small" data-n="undo">되돌리기</button>';
    else if (cloud === 'offline') h = '<span>구글시트에 연결하지 못했습니다. 지금 내용은 이 브라우저에 저장되고, 연결되면 시트에 올립니다.</span><button class="btn small" data-n="retry">다시 연결</button>';
    else if (cloud === 'on' && !canWrite) h = '<span>시트에 저장하려면 담당자 비밀번호를 넣으세요. 지금은 이 브라우저에만 저장됩니다.</span><input id="noticePw" type="password" class="pw" placeholder="비밀번호" aria-label="담당자 비밀번호" autocomplete="current-password"><label class="opt"><input type="checkbox" id="noticeRemember" checked>이 브라우저에 기억</label><button class="btn small primary" data-n="connect">연결</button><span id="noticeMsg" class="muted"></span>';
    else if (pf && !pf.confirmed) h = '<span>' + pf.year + '학년도 자료에서 작년 시수를 가져왔습니다: ' + Object.keys(pf.values).map(function (g) { return g + '학년 ' + fmt(pf.values[g]); }).join(' · ') + ' (작년 ' + Object.keys(pf.values).map(function (g) { return g - 1; }).join('·') + '학년 계획값). 나이스의 실제 이수 시수와 다르면 고치세요.</span><button class="btn small" data-n="prevOk">맞습니다</button><button class="btn small text" data-n="prevEdit">고치기</button>';
    else if (cloud === 'off' && read('haksa:noCloudOk') !== '1') h = '<span>시트 주소(config.js)가 없어 이 브라우저에만 저장됩니다.</span><button class="btn small text" data-n="later">알겠습니다</button>';
    el.innerHTML = h; el.hidden = !h; el.className = 'notice' + (cls ? ' ' + cls : '');
  }
  function noticeEvents() {
    $('#notice').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'noticePw') { e.preventDefault(); $('[data-n="connect"]').click(); } });
    $('#notice').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var n = b.dataset.n;
      if (n === 'retry') { cloud = 'on'; refreshCloudYears().then(function () { if (cloud === 'on') checkRemote(); renderNotice(); }); }
      else if (n === 'connect') {
        var pw = $('#noticePw').value; if (!pw) { $('#noticePw').focus(); return; }
        b.disabled = true;
        connect(pw, $('#noticeRemember').checked).then(function (ok) { if (!ok) { b.disabled = false; $('#noticeMsg').textContent = '비밀번호가 맞지 않습니다'; $('#noticePw').select(); } }, function () { b.disabled = false; });
      }
      else if (n === 'takeRemote') resolveConflict('remote');
      else if (n === 'takeMine') resolveConflict('mine');
      else if (n === 'keepFile') ST.download(state.year, state);
      else if (n === 'undo' && undoState) { var u = undoState; undoState = null; state = u; $('#yearSel').value = String(u.year); $('#schoolName').value = u.school.name || ''; recompute(); save(); renderNotice(); }
      else if (n === 'settings') go('settings');
      else if (n === 'later') { store('haksa:noCloudOk', '1'); renderNotice(); }
      else if (n === 'prevOk') { var s2 = clone(state); s2.prevYearFrom.confirmed = true; commit(s2); renderNotice(); }
      else if (n === 'prevEdit') { var s3 = clone(state); s3.prevYearFrom.confirmed = true; commit(s3); renderNotice(); go('prev'); }
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
  function md(date) { return +date.slice(5, 7) + '.' + (+date.slice(8, 10)) + '.'; }
  function sign(n) { return n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0'; }

  function commit(next, keepSettings) { if (VIEW) return; state = next; recompute(keepSettings); save(); }
  function recompute(keepSettings) {
    result = E.build(state, H);
    dayMap = {}; result.days.forEach(function (d) { dayMap[d.date] = d; });
    renderSummary(); renderPlanner(); if ($('#notice')) renderNotice();
    if (!$('#tab-weeks').hidden) renderWeeks();
    if (!$('#tab-daily').hidden) renderDaily();
    if (!$('#tab-staff').hidden && window.TTUI) TTUI.render();
    if (window.ExtUI) ExtUI.render();
    if (window.StaffUI) StaffUI.render(); // 보기 페이지에서는 공개 여부로 탭을 보이고 숨김
    if (!$('#tab-settings').hidden && !keepSettings) renderSettings();
    if (selected) renderDrawer();
    else if (fixMode) renderFix();
  }

  // ---------- 판정 띠 ----------
  function daysChip(r) {
    var n = r.totals.days.total, min = r.state.standards.minDays;
    if (n < min) return '<button class="chip bad link-bad" data-fix="1" title="부족분 채우기 후보 보기">미달 ' + (min - n) + '일 →</button>';
    if (n === min) return '<span class="chip zero">여유 0일</span>';
    return '<span class="chip ok">여유 ' + (n - min) + '일</span>';
  }
  function gradeChip(g) {
    // 1·3·5학년: 2년 기준의 절반(목표) 대비
    if (g.grade % 2) return g.margin < 0 ? '<span class="chip warn">주의 ' + g.margin + '</span>' : '<span class="chip ok">충족 +' + g.margin + '</span>';
    if (g.prev == null) return '<button class="chip link" data-go="prev" title="설정의 작년 이수 시수 칸으로 이동">작년 시수 입력 →</button>';
    if (g.margin < 0) return '<button class="chip bad link-bad" data-fix="1" title="부족분 채우기 후보 보기">미달 ' + (-g.margin) + ' →</button>';
    if (g.margin === 0) return '<span class="chip zero">여유 0</span>';
    return '<span class="chip ok">충족 +' + g.margin + '</span>';
  }
  function renderSummary() {
    var r = result, t = r.totals.days, vacation = r.totals.vacationDays, html;
    var vacationHtml = '<div class="stat vacation" title="주말·공휴일 포함. 1학기: 여름방학. 2학기: 겨울방학 + 종업 다음 날부터 다음 해 2월 말까지. 방학식·개학일 제외."><span class="k">방학일수 <span class="vacation-note">(주말·공휴일 포함)</span></span>' +
      '<div class="row"><span class="v">' + (vacation ? vacation.total + '<small>일</small>' : '—') + '</span></div>' +
      '<span class="k">' + (vacation ? '1학기 ' + vacation.sem1 + '일 · 2학기 ' + vacation.sem2 + '일' : '학년도 날짜를 확인하세요') + '</span></div>';
    if (!r.ready) { $('#summary').innerHTML = '<div class="stat days"><span class="k">수업일수</span><span class="v">—</span><span class="k">설정에서 날짜를 입력하세요</span></div>' + vacationHtml; return; }
    html = '<div class="stat days"><span class="k">수업일수 (법정 ' + r.state.standards.minDays + '일 이상)</span>' +
      '<div class="row"><span class="v">' + t.total + '<small>일</small></span>' + daysChip(r) + '</div>' +
      '<span class="k">1학기 ' + t.sem1 + '일 · 2학기 ' + t.sem2 + '일</span></div>' + vacationHtml;
    r.grades.forEach(function (g) {
      var label = g.grade % 2 ? '목표 ' + fmt(g.target) : g.required == null ? '' : '최소 ' + fmt(g.required);
      html += '<div class="stat"><span class="k">' + g.grade + '학년 시수' + (label ? ' · ' + label : '') + '</span>' +
        '<div class="row"><span class="v">' + fmt(g.total) + '</span>' + gradeChip(g) + '</div>' +
        '<span class="k">' + (g.grade % 2 ? '내년 ' + fmt(g.nextYearNeed) + '시간 필요' : g.prev == null ? '작년 시수를 넣으면 판정' : '작년 ' + fmt(g.prev) + ' + 올해 ≥ ' + fmt(g.standard)) + '</span></div>';
    });
    $('#summary').innerHTML = html;
  }

  // ---------- 연간 계획표 ----------
  var SHORT = { '1월 1일': '신정', '설날': '설', '3·1절': '삼일절', '노동절': '노동절', '어린이날': '어린이', '부처님오신날': '석가', '현충일': '현충일',
    '제헌절': '제헌절', '광복절': '광복절', '추석': '추석', '개천절': '개천절', '한글날': '한글날', '기독탄신일': '성탄',
    '국회의원선거일': '선거', '대통령선거일': '선거', '전국동시지방선거일': '선거', '임시공휴일': '임시' };
  var EVS = { '시업식·입학식': '시업', '여름방학식': '방학식', '겨울방학식': '방학식', '개학식': '개학', '종업식·졸업식': '종업', '종업식': '종업', '졸업식': '졸업', '입학식': '입학', '입학초기 적응': '적응', '시수 보충': '보충', '시수 조정': '조정' };
  function shortName(n) {
    if (!n) return '';
    if (n.indexOf('대체') === 0) return '대체';
    return SHORT[n] || EVS[n] || n.slice(0, 3);
  }
  function short2(t) { return t.length <= 2 ? t : ({ '삼일절': '3·1', '방학식': '방학' }[t] || ''); }
  function inVacation(date) {
    var d = state.dates;
    return (d.summerStart && d.summerEnd && date > d.summerStart && date < d.summerEnd) ||
      (d.winterStart && d.winterEnd && date > d.winterStart && date < d.winterEnd);
  }
  // 칠하는 순서: 공휴일(임시 포함) > 자율휴업 > 방학 > 학교 행사·조정 > 주말 > 학년도 밖
  function cellView(d) {
    var cls = ['cell'], tag = '', we = d.dow === 0 || d.dow === 6;
    var holName = d.labels.filter(function (l) { return l !== '수능'; })[0];
    var hol = d.status === 'holiday' || (d.off && holName && d.status !== 'closure');
    if (we) { cls.push('we'); if (d.dow === 0) cls.push('sunday'); }
    if (d.status === 'outside' && !hol) cls.push('outside');
    if (hol) {
      var temp = (state.extraHolidays || []).some(function (h) { return h.date === d.date && h.kind === 'temporary'; });
      cls.push(temp ? 'temporary' : we ? 'wehol' : 'holiday'); tag = temp ? '임시' : shortName(holName);
      if (we && inVacation(d.date)) cls.push('vacation');
    } else if (d.status === 'closure') { cls.push('closure'); tag = d.labels.indexOf('수능') >= 0 ? '수능' : '자율'; }
    else if (d.status === 'vacation' || (we && inVacation(d.date))) cls.push('vacation');
    else if (d.status === 'school' && d.category) {
      cls.push(d.category);
      var ev = (state.events || []).filter(function (e) { return e.date === d.date; })[0];
      tag = d.category === 'suneung' ? '수능' : shortName(ev ? ev.name : '');
    }
    if (d.status === 'school' && d.periods && GR.some(function (g) { return d.periods[g] !== E.basePeriodsFor(state, g, d.sem)[d.dow - 1]; })) cls.push('pdiff');
    if (d.date === selected) cls.push('sel');
    return { cls: cls.join(' '), tag: tag };
  }
  function renderPlanner() {
    var y = state.year, out = [], WD = ['월', '화', '수', '목', '금', '토', '일'];
    out.push('<div class="ph"></div>');
    for (var i = 0; i < 37; i++) out.push('<div class="ph' + (i % 7 >= 5 ? ' we' : '') + (i % 7 === 6 ? ' sun' : '') + '">' + WD[i % 7] + '</div>');
    out.push('<div class="ph stathead">수업일</div>');
    GR.forEach(function (g) { out.push('<div class="ph stathead">' + g + '학년</div>'); });
    var months = {}; (result.months || []).forEach(function (m) { months[m.ym] = m; });
    for (var k = 0; k < 12; k++) {
      var yy = k < 10 ? y : y + 1, mm = (k + 2) % 12 + 1, ym = yy + '-' + pad(mm);
      var first = ym + '-01', off = (E.dow(first) + 6) % 7, dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      out.push('<div class="mlabel">' + mm + '월' + (mm <= 2 ? '<small>' + yy + '</small>' : '') + '</div>');
      for (var s = 0; s < 37; s++) {
        var dn = s - off + 1;
        if (dn < 1 || dn > dim) { out.push('<div class="cell blank' + (s % 7 >= 5 ? ' we' : '') + '" aria-hidden="true"></div>'); continue; }
        var date = ym + '-' + pad(dn), d = dayMap[date], v = cellView(d);
        var title = md(date) + '(' + d.weekday + ') ' + (d.labels.join(', ') || statusText(d)) + (d.periods ? ' · ' + GR.map(function (g) { return d.periods[g]; }).join('/') + '교시' : '') + (d.estimated ? ' · 추정' : '');
        out.push('<button class="' + v.cls + '" data-date="' + date + '" title="' + esc(title) + '" aria-label="' + esc(title) + '"><span class="n">' + dn + '</span>' + (v.tag ? '<span class="t"><span class="tl">' + esc(v.tag) + '</span>' + (short2(v.tag) ? '<span class="ts">' + esc(short2(v.tag)) + '</span>' : '') + '</span>' : '') + '</button>');
      }
      var m = months[ym];
      out.push('<div class="mstat days' + (m ? '' : ' zero') + '">' + (m ? m.days : 0) + '</div>');
      GR.forEach(function (g) { out.push('<div class="mstat h' + (m ? '' : ' zero') + '">' + (m ? m.hours[g] : 0) + '</div>'); });
    }
    $('#planner').innerHTML = out.join('');
    renderLegend();
  }
  function statusText(d) {
    return { school: '수업일', weekend: '주말', holiday: '공휴일', closure: '휴업일', vacation: '방학', outside: '학년도 수업 기간 밖' }[d.status];
  }
  function renderLegend() {
    var items = [
      ['holiday', '공휴일', 'background:var(--holiday-bg);box-shadow:inset 0 0 0 1px var(--holiday-fg)'],
      ['temporary', '임시공휴일', 'background:var(--holiday-bg);box-shadow:inset 0 0 0 2px var(--temp-line)'],
      ['closure', '자율휴업일', 'background:#fff;outline:2px dashed var(--closure-line);outline-offset:-3px'],
      ['vacation', '방학', 'background:repeating-linear-gradient(135deg,var(--vac-b) 0 3px,var(--vac-a) 3px 7px)'],
      ['ceremony', '행사(시업·방학·개학·종업)', 'background:var(--cer-bg)'],
      ['adapt', '입학초기 적응', 'background:var(--adapt-bg)'],
      ['adjust', '시수 증감', 'background:#fff;box-shadow:inset 0 -4px 0 var(--adjust-bar),inset 0 0 0 1px var(--line-strong)'],
      ['suneung', '수능', 'background:var(--sun-bg)'],
      ['we', '주말', 'background:var(--weekend-bg);box-shadow:inset 0 0 0 1px var(--line)'],
      ['pdiff', '기준과 다른 교시', 'background:linear-gradient(225deg,var(--adjust-bar) 0 5px,#fff 5px);box-shadow:inset 0 0 0 1px var(--line-strong)'],
      ['outside', '학년도 밖', 'background:#fff;opacity:.4;box-shadow:inset 0 0 0 1px var(--line-strong)']
    ];
    var used = { holiday: 1, vacation: 1, ceremony: 1, we: 1 };
    document.querySelectorAll('#planner .cell').forEach(function (c) { ['temporary', 'closure', 'adapt', 'adjust', 'suneung', 'pdiff', 'outside'].forEach(function (k) { if (c.classList.contains(k)) used[k] = 1; }); });
    $('#legend').innerHTML = items.filter(function (i) { return used[i[0]]; }).map(function (i) { return '<span><i class="sw" style="' + i[2] + '"></i>' + i[1] + '</span>'; }).join('') +
      '<span class="hint">' + (VIEW ? '날짜를 누르면 그날 내용 · ' : '날짜를 누르면 휴업·임시공휴일·시수 조정 · ') + '오른쪽 숫자는 그달 학년별 시수</span><span class="credit">원작: 서울신답초등학교 정용석</span>';
  }

  // ---------- 부족분 채우기 서랍(판정 띠의 '미달'에서 열림) ----------
  var fixMode = false, fixList = [];
  function openFix() { if (selected) closeDrawer(); fixMode = true; renderFix(); var b = $('#drawer [data-fixi]'); if (b) b.focus(); }
  function renderFix() {
    var el = $('#drawer'), need = E.shortfall(result);
    var short = [];
    if (need.days) short.push('수업일수 ' + need.days + '일');
    GR.forEach(function (g) { if (need.hours[g]) short.push(g + '학년 ' + need.hours[g] + '시간'); });
    if (!short.length) { fixMode = false; el.hidden = true; document.body.classList.remove('drawer-open'); return; }
    el.hidden = false; document.body.classList.add('drawer-open');
    el.style.top = $('#summary').getBoundingClientRect().bottom + 'px';
    var sg = E.suggest(state, H, need, { reason: '법정 기준 부족분 보충' }).candidates;
    var full = sg.filter(function (c) { return c.covers; });
    fixList = (full.length ? full : sg).slice(0, 5);
    var h = '<button class="btn text close" data-act="close" aria-label="닫기">닫기</button>' +
      '<div><h2>부족분 채우기</h2><div class="muted">법정 기준까지 모자란 양: ' + short.join(' · ') + '</div></div>' +
      '<p class="muted">' + (full.length ? '아래 안 중 하나를 고르면 바로 적용됩니다. 위에 있을수록 바꾸는 날이 적습니다.' : '한 번에 다 채우는 안이 없습니다. 효과가 큰 안부터 적용하고 다시 확인하세요.') + '</p>' +
      '<div class="sugg">' + (fixList.length ? fixList.map(function (c, i) {
        var rr = E.build(E.apply(state, c.action), H);
        return '<div class="s"><span>' + esc(c.label) + '<br><span class="muted">적용 후 ' + rr.totals.days.total + '일 · ' + GR.map(function (g) { return g + '학년 ' + fmt(rr.totals.hours[g].total); }).join(' · ') + '</span></span><button class="btn small" data-fixi="' + i + '">이 안 적용</button></div>';
      }).join('') : '<p class="muted">자동으로 찾은 안이 없습니다. 설정에서 방학 날짜를 조정하거나 일별 시수 표에서 교시를 늘리세요.</p>') + '</div>';
    el.innerHTML = h;
  }

  // ---------- 날짜 서랍 ----------
  var form = null;
  function openDrawer(date) {
    fixMode = false;
    selected = date;
    var d = dayMap[date], ev = (state.events || []).filter(function (e) { return e.date === date; })[0];
    var cl = (state.closures || []).filter(function (c) { return c.date === date; })[0];
    var tmp = (state.extraHolidays || []).filter(function (h) { return h.date === date; })[0];
    form = {
      choice: tmp ? 'temporary' : cl ? 'closure' : ev ? 'adjust' : 'school',
      name: (ev && ev.name) || (cl && cl.name) || (tmp && tmp.name) || '',
      reason: (ev && ev.reason) || (cl && cl.reason) || '',
      type: (ev && ev.type) || 'adjust',
      periods: d.periods ? clone(d.periods) : basePeriods(d)
    };
    if (!$('#tab-year').hidden) renderPlanner();
    renderDrawer();
    var first = $('#drawer input, #drawer button.primary'); if (first) first.focus();
  }
  function basePeriods(d) { var p = {}; GR.forEach(function (g) { p[g] = d.dow >= 1 && d.dow <= 5 ? E.basePeriodsFor(state, g, d.sem)[d.dow - 1] : 0; }); return p; }
  // 보기 전용: 그날의 처리 내용과 학년별 교시만 보여 준다
  function viewDrawerBody(date, d) {
    var ev = (state.events || []).filter(function (e) { return e.date === date; })[0];
    var cl = (state.closures || []).filter(function (c) { return c.date === date; })[0];
    var h = '';
    if (ev) h += '<p><b>' + esc(ev.name) + '</b>' + (ev.reason ? ' · ' + esc(ev.reason) : '') + '</p>';
    if (cl) h += '<p><b>' + esc(cl.name || '자율휴업일') + '</b>' + (cl.reason ? ' · ' + esc(cl.reason) : '') + '</p>';
    if (d.periods) h += '<table class="base" aria-label="학년별 교시"><tr>' + GR.map(function (g) { return '<th>' + g + '학년</th>'; }).join('') + '</tr><tr>' +
      GR.map(function (g) { var b = E.basePeriodsFor(state, g, d.sem)[d.dow - 1], p = d.periods[g]; return '<td>' + p + (p !== b ? ' <span class="muted">(기준 ' + b + ')</span>' : '') + '</td>'; }).join('') + '</tr></table>';
    return h || '<p class="muted">' + esc(statusText(d)) + '</p>';
  }
  function closeDrawer() { fixMode = false; var was = selected; selected = null; form = null; $('#drawer').hidden = true; document.body.classList.remove('drawer-open'); renderPlanner(); var c = was && $('.cell[data-date="' + was + '"]'); if (c) c.focus(); }

  function candidate(date) {
    var s = clone(state);
    s.closures = (s.closures || []).filter(function (c) { return c.date !== date; });
    s.extraHolidays = (s.extraHolidays || []).filter(function (h) { return h.date !== date; });
    s.events = (s.events || []).filter(function (e) { return e.date !== date; });
    if (form.choice === 'closure') s.closures.push({ date: date, name: form.name || '자율휴업일', reason: form.reason });
    if (form.choice === 'temporary') s.extraHolidays.push({ date: date, name: form.name || '임시공휴일', kind: 'temporary' });
    if (form.choice === 'adjust') s.events.push({ date: date, type: form.type, name: form.name || { ceremony: '행사', adapt: '입학초기 적응', adjust: '시수 조정' }[form.type], reason: form.reason, periods: clone(form.periods) });
    return s;
  }

  function impactHtml(before, after, date) {
    var df = E.diff(before, after), rows = '', ym = date.slice(0, 7);
    var mb = (before.months || []).filter(function (m) { return m.ym === ym; })[0], ma = (after.months || []).filter(function (m) { return m.ym === ym; })[0];
    var bd = mb ? mb.days : 0, ad = ma ? ma.days : 0;
    rows += '<tr><td>' + (+ym.slice(5)) + '월 수업일</td><td>' + bd + ' → ' + ad + '</td><td class="' + (ad < bd ? 'neg' : ad > bd ? 'pos' : '') + '">' + sign(ad - bd) + '</td></tr>';
    rows += '<tr><td>수업일수</td><td>' + before.totals.days.total + ' → ' + after.totals.days.total + '</td><td class="' + (df.days < 0 ? 'neg' : df.days > 0 ? 'pos' : '') + '">' + sign(df.days) + '</td></tr>';
    GR.forEach(function (g) {
      var h = df.hours[g];
      rows += '<tr><td>' + g + '학년</td><td>' + fmt(before.totals.hours[g].total) + ' → ' + fmt(after.totals.hours[g].total) + '</td><td class="' + (h < 0 ? 'neg' : h > 0 ? 'pos' : '') + '">' + sign(h) + '</td></tr>';
    });
    var msgs = after.checks.filter(function (c) { return c.level === 'error' || (c.level === 'warn' && /zero-margin|event-no-reason/.test(c.code)); });
    return '<div class="impact"><h3>적용하면</h3><table><tr><th></th><th>지금 → 적용 후</th><th>변화</th></tr>' + rows + '</table>' +
      (msgs.length ? '<ul class="msgs">' + msgs.map(function (m) { return '<li class="' + m.level + '">' + esc(m.msg) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  function renderDrawer() {
    var date = selected, d = dayMap[date], el = $('#drawer');
    if (!d) return closeDrawer();
    el.hidden = false; document.body.classList.add('drawer-open');
    el.style.top = $('#summary').getBoundingClientRect().bottom + 'px';
    var head = '<button class="btn text close" data-act="close" aria-label="닫기">닫기</button>' +
      '<div><h2>' + date.slice(0, 4) + '. ' + md(date) + ' (' + d.weekday + ')</h2><div class="muted">' + esc(d.labels.join(', ') || statusText(d)) +
      (d.periods ? ' · 학년별 ' + GR.map(function (g) { return d.periods[g]; }).join('/') + '교시' : '') + (d.estimated ? ' · 추정 날짜' : '') + '</div></div>';
    if (VIEW) { el.innerHTML = head + viewDrawerBody(date, d); return; }
    var baseHol = (H.items || []).some(function (i) { return i.date === date && i.kind !== 'event'; });
    var removed = (state.removedHolidays || []).indexOf(date) >= 0;
    var body = '';

    if (d.status === 'outside' && !removed) body = '<p class="muted">시업일 전이거나 종업일 뒤의 날입니다. 학년도 날짜는 설정에서 바꿉니다.</p>';
    else if (d.status === 'vacation') body = '<p class="muted">방학 기간입니다. 방학식·개학일은 설정에서 바꿉니다.</p><button class="btn" data-go="settings">설정 열기</button>';
    else if (d.status === 'holiday' && baseHol && !form.choice.match(/temporary/)) {
      body = '<p>' + (removed ? '기본 공휴일이지만 이 학교 설정에서 뺀 날입니다.' : '기본 공휴일 데이터에 있는 날입니다. 법 개정 등으로 바뀌었다면 뺄 수 있습니다.') + '</p>' +
        '<button class="btn" data-act="toggleHoliday">' + (removed ? '공휴일로 되돌리기' : '이 공휴일 빼기(수업일로)') + '</button>';
    } else if (d.dow === 0 || d.dow === 6) body = '<p class="muted">주말입니다.</p>';
    else {
      if (removed) body += '<p class="muted">기본 공휴일이지만 이 학교 설정에서 뺀 날입니다. <button class="btn small" data-act="toggleHoliday">공휴일로 되돌리기</button></p>';
      var opts = [['school', '수업일'], ['closure', '자율휴업일'], ['temporary', '임시공휴일'], ['adjust', '시수 조정·행사']];
      body += '<div><h3>이 날 처리</h3><div class="opts" role="radiogroup">' + opts.map(function (o) {
        return '<label class="opt"><input type="radio" name="choice" value="' + o[0] + '"' + (form.choice === o[0] ? ' checked' : '') + '>' + o[1] + '</label>';
      }).join('') + '</div></div>';
      if (form.choice === 'adjust') {
        body += '<div class="grid2"><label class="field">종류<select data-f="type">' +
          [['ceremony', '행사'], ['adapt', '입학초기 적응'], ['adjust', '시수 증감']].map(function (t) { return '<option value="' + t[0] + '"' + (form.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') +
          '</select></label><label class="field">이름<input data-f="name" value="' + esc(form.name) + '" placeholder="예: 현장체험학습"></label></div>' +
          '<div><h3>학년별 교시</h3><div class="pgrid">' + GR.map(function (g) { return '<label>' + g + '학년<input type="number" min="0" max="8" data-p="' + g + '" value="' + form.periods[g] + '"></label>'; }).join('') + '</div></div>';
      }
      if (form.choice === 'closure' || form.choice === 'temporary') body += '<label class="field">이름<input data-f="name" value="' + esc(form.name) + '" placeholder="' + (form.choice === 'closure' ? '자율휴업일' : '임시공휴일') + '"></label>';
      if (form.choice === 'closure' || form.choice === 'adjust') body += '<label class="field">사유<input data-f="reason" value="' + esc(form.reason) + '" placeholder="예: 어린이날 사이 징검다리"></label>';

      var cand = candidate(date), after = E.build(cand, H);
      body += impactHtml(result, after, date);
      var need = E.shortfall(after), lost = E.diff(after, result);
      if (form.choice === 'temporary') { need.days = Math.max(need.days, lost.days); GR.forEach(function (g) { need.hours[g] = Math.max(need.hours[g], lost.hours[g]); }); }
      var needAny = need.days > 0 || GR.some(function (g) { return need.hours[g] > 0; });
      if (needAny) {
        var sg = E.suggest(cand, H, need, { after: date, reason: md(date) + ' ' + (form.name || '') + ' 보충' }).candidates.filter(function (c) { return c.covers; }).slice(0, 4);
        body += '<div><h3>부족분 채우기' + (form.choice === 'temporary' ? ' (줄어든 만큼)' : '') + '</h3><div class="sugg">' +
          (sg.length ? sg.map(function (c, i) {
            var rr = E.build(E.apply(cand, c.action), H);
            return '<div class="s"><span>' + esc(c.label) + '<br><span class="muted">적용 후 ' + rr.totals.days.total + '일 · ' + GR.map(function (g) { return g + '학년 ' + fmt(rr.totals.hours[g].total); }).join(' · ') + '</span></span><button class="btn small" data-sug="' + i + '">보충안까지 적용</button></div>';
          }).join('')
            : '<p class="muted">자동으로 찾은 안이 없습니다. 방학 날짜를 설정에서 조정하세요.</p>') + '</div></div>';
        form._sugg = sg; form._cand = cand;
      } else { form._sugg = []; form._cand = cand; }
    }
    var canApply = !!form._cand && d.status !== 'outside' && d.status !== 'vacation' && !(d.dow === 0 || d.dow === 6);
    el.innerHTML = head + body + '<div class="foot">' + (canApply ? '<button class="btn primary" data-act="apply">' + (form._sugg && form._sugg.length ? '이것만 적용 (Enter)' : '적용 (Enter)') + '</button>' : '') + '</div>';
  }

  function drawerEvents() {
    var el = $('#drawer');
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'choice') { form.choice = t.value; if (t.value === 'adjust' && !form.name) form.name = ''; refreshDrawer(t); }
      else if (t.dataset.f === 'type') { form.type = t.value; refreshDrawer(t); }
    });
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.f === 'name' || t.dataset.f === 'reason') form[t.dataset.f] = t.value;
      if (t.dataset.p) { form.periods[t.dataset.p] = Math.max(0, +t.value || 0); refreshDrawer(t); }
    });
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.fixi != null) { var fc = fixList[+t.dataset.fixi], bf = clone(dayMap); commit(E.apply(state, fc.action)); var ch = changedDates(bf); if (fixMode) renderFix(); if (!$('#tab-year').hidden) flash(ch); return; }
      if (t.dataset.act === 'close') closeDrawer();
      else if (t.dataset.act === 'apply') { var at = selected; form._cand = candidate(selected); commit(form._cand); closeDrawer(); flash([at]); }
      else if (t.dataset.act === 'toggleHoliday') {
        var s = clone(state), i = (s.removedHolidays || []).indexOf(selected);
        s.removedHolidays = s.removedHolidays || [];
        if (i >= 0) s.removedHolidays.splice(i, 1); else s.removedHolidays.push(selected);
        commit(s);
      } else if (t.dataset.sug != null) { var c = form._sugg[+t.dataset.sug], at2 = selected, before = clone(dayMap); commit(E.apply(candidate(selected), c.action)); closeDrawer(); flash([at2].concat(changedDates(before))); }
      else if (t.dataset.go) go(t.dataset.go);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') { var a = $('[data-act="apply"]', el); if (a) a.click(); }
    });
  }
  // 입력 중 다시 그려도 커서가 남도록
  function refreshDrawer(t) {
    var key = t && (t.dataset.p ? '[data-p="' + t.dataset.p + '"]' : t.dataset.f ? '[data-f="' + t.dataset.f + '"]' : t.name ? 'input[value="' + t.value + '"]' : null);
    renderDrawer();
    var n = key && $('#drawer ' + key); if (n) n.focus();
  }

  function changedDates(before) {
    return Object.keys(dayMap).filter(function (k) { var a = before[k], b = dayMap[k]; return a && (a.status !== b.status || JSON.stringify(a.periods) !== JSON.stringify(b.periods)); });
  }
  function flash(dates) {
    dates.forEach(function (d) { var c = $('.cell[data-date="' + d + '"]'); if (c) c.classList.add('flash'); });
    setTimeout(function () { document.querySelectorAll('.cell.flash').forEach(function (c) { c.classList.remove('flash'); }); }, 1800);
  }

  // ---------- 일별 시수 (원본 엑셀 일별 시트 방식, 칸을 눌러 바로 수정) ----------
  var dailySem = 1, editing = null;
  function hideDailyDate() { $('#dailyDateTip').hidden = true; }
  function dailyDateEvents() {
    var table = $('#dailyTable'), tip = $('#dailyDateTip');
    function show(e) {
      var cell = e.target.closest('td.dc');
      if (!cell) return;
      tip.textContent = cell.dataset.dateLabel; tip.hidden = false;
      var rect = cell.getBoundingClientRect(), width = tip.offsetWidth, height = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)) + 'px';
      tip.style.top = (rect.top >= height + 8 ? rect.top - height - 6 : rect.bottom + 6) + 'px';
    }
    function leave(e) {
      var cell = e.target.closest('td.dc');
      if (cell && (!e.relatedTarget || !cell.contains(e.relatedTarget))) hideDailyDate();
    }
    table.addEventListener('mousemove', show);
    table.addEventListener('mouseout', leave);
    table.addEventListener('focusin', show);
    table.addEventListener('focusout', leave);
    table.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideDailyDate(); });
    table.closest('.scroll').addEventListener('scroll', hideDailyDate);
    window.addEventListener('resize', hideDailyDate);
    window.addEventListener('blur', hideDailyDate);
  }
  function naturalPeriods(d, g) {
    var p = E.basePeriodsFor(state, g, d.sem)[d.dow - 1];
    if (d.date === result.suneungDate && state.suneung.mode === 'minus1') p = Math.max(0, p - 1);
    return p;
  }
  function dailyCell(d, g) {
    if (!d || d.status === 'outside' || d.status === 'weekend' || d.status === 'vacation') return { cls: 'c-off', v: '' };
    if (d.status === 'holiday') return { cls: d.category === 'temporary' ? 'c-temp' : 'c-hol', v: '' };
    if (d.status === 'closure') return { cls: 'c-clo', v: '' };
    var v = d.periods[g], nat = naturalPeriods(d, g), cls = 'c-sch';
    if (d.category === 'ceremony') cls = 'c-cer';
    else if (d.category === 'adapt') cls = 'c-adapt';
    else if (d.category === 'suneung' && v === nat) cls = 'c-sun';
    else if (v > nat) cls = 'c-up';
    else if (v < nat) cls = 'c-down';
    return { cls: cls, v: v, edit: true };
  }
  function renderDaily() {
    hideDailyDate();
    var r = result, WD = ['월', '화', '수', '목', '금'];
    if (!r.ready) { $('#dailyTable').innerHTML = '<tbody><tr><td>설정에서 날짜를 입력하세요.</td></tr></tbody>'; return; }
    var weeks = (r.weeks || []).filter(function (w) { return w.sem === dailySem; });
    var monthsIn = []; weeks.forEach(function (w) { var m = +w.month.slice(5); if (monthsIn.indexOf(m) < 0) monthsIn.push(m); });
    var groups = []; monthsIn.forEach(function (m, i) { var k = Math.min(i, 4); (groups[k] = groups[k] || [[], []])[1].push(m); });
    groups.forEach(function (gr) { gr[0] = gr[1].map(function (m) { return m + '월'; }).join('·'); });
    while (groups.length < 5) groups.push(['', []]);
    var h = '<colgroup><col class="cw"><col class="cd"><col class="cn">' + GR.map(function () { return '<col class="cp"><col class="cp"><col class="cp"><col class="cp"><col class="cp"><col class="cs">'; }).join('') + '</colgroup>';
    h += '<thead><tr><th rowspan="2">주</th><th rowspan="2">월요일</th><th rowspan="2">수업일</th>' + GR.map(function (g) { return '<th colspan="6" class="gh">' + g + '학년</th>'; }).join('') + '</tr><tr>' +
      GR.map(function () { return WD.map(function (w) { return '<th>' + w + '</th>'; }).join('') + '<th class="sumh">합계</th>'; }).join('') + '</tr></thead><tbody>';
    var colSum = {}; GR.forEach(function (g) { colSum[g] = [0, 0, 0, 0, 0]; });
    var mSum = {}; GR.forEach(function (g) { mSum[g] = {}; });
    weeks.forEach(function (w, i) {
      var note = weekNote(w.monday), mo = +w.month.slice(5);
      h += '<tr' + (i && +weeks[i - 1].month.slice(5) !== mo ? ' class="mstart"' : '') + '><td class="wk">' + (i + 1) + '</td><td class="wd" title="' + esc(md(w.monday) + ' ~ ' + md(w.friday) + (note ? ' · ' + note : '')) + '">' + md(w.monday) + '</td><td class="wn">' + w.days + '</td>';
      GR.forEach(function (g) {
        var tot = 0;
        for (var k = 0; k < 5; k++) {
          var date = E.addDays(w.monday, k), d = dayMap[date], c = d && d.sem !== w.sem && d.status === 'school' ? { cls: 'c-off', v: '' } : dailyCell(d, g);
          if (c.edit) { tot += c.v; colSum[g][k] += c.v; }
          var dateLabel = (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일 (' + E.WEEKDAY[E.dow(date)] + ')';
          var t = dateLabel + ' ' + g + '학년' + (d ? ' ' + (c.edit ? c.v + '교시' : (d.labels.join(', ') || statusText(d))) : '');
          h += '<td class="dc ' + c.cls + '" data-date="' + date + '" data-date-label="' + esc(dateLabel) + '" data-g="' + g + '"' + (c.edit ? ' tabindex="0"' : '') + ' aria-label="' + esc(t) + '">' + c.v + '</td>';
        }
        mSum[g][mo] = (mSum[g][mo] || 0) + tot;
        h += '<td class="ws">' + tot + '</td>';
      });
      h += '</tr>';
    });
    // 학기 계: 요일별 합계 + 학기 합계
    h += '<tr class="sum"><td colspan="3">' + dailySem + '학기 계 · ' + r.totals.days['sem' + dailySem] + '일</td>' + GR.map(function (g) {
      return colSum[g].map(function (v) { return '<td>' + v + '</td>'; }).join('') + '<td class="ws big">' + fmt(r.totals.hours[g]['sem' + dailySem]) + '</td>';
    }).join('') + '</tr>';
    // 월별 합계(주의 소속 월 = 금요일이 속한 달)
    h += '<tr class="mlab"><td colspan="3">월별</td>' + GR.map(function () { return groups.map(function (m) { return '<td>' + m[0] + '</td>'; }).join('') + '<td></td>'; }).join('') + '</tr>';
    h += '<tr class="msum"><td colspan="3">시수</td>' + GR.map(function (g) {
      return groups.map(function (m) { return '<td>' + m[1].reduce(function (a, k) { return a + (mSum[g][k] || 0); }, 0) + '</td>'; }).join('') + '<td class="ws">' + fmt(r.totals.hours[g].total) + '<small>연간</small></td>';
    }).join('') + '</tr></tbody>';
    $('#dailyTable').innerHTML = h;
    document.querySelectorAll('#semTabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.sem === dailySem)); });
    if (editing) startEdit(editing.date, editing.g);
  }
  function setPeriod(date, g, val) {
    var s = clone(state), d = dayMap[date];
    s.events = s.events || [];
    var ev = s.events.filter(function (e) { return e.date === date; })[0];
    if (!ev) { ev = { date: date, type: 'adjust', name: '시수 조정', reason: '일별 시수 표에서 직접 조정', periods: {} }; s.events.push(ev); }
    ev.periods[g] = val;
    // 모든 학년이 기준과 같아진 조정일은 지운다(행사일은 유지)
    if (ev.type === 'adjust' && GR.every(function (k) { return ev.periods[k] == null || +ev.periods[k] === naturalPeriods(d, k); })) s.events = s.events.filter(function (e) { return e !== ev; });
    commit(s);
  }
  function startEdit(date, g) {
    var td = $('#dailyTable td.dc[data-date="' + date + '"][data-g="' + g + '"]');
    if (!td || !td.hasAttribute('tabindex')) { editing = null; return; }
    editing = { date: date, g: g };
    var old = td.textContent;
    td.innerHTML = '<input type="number" min="0" max="8" value="' + old + '" aria-label="' + esc(td.getAttribute('aria-label')) + '">';
    var inp = td.firstChild; inp.focus(); inp.select();
    function done(move) {
      var v = inp.value === '' ? +old : Math.max(0, Math.min(8, Math.round(+inp.value)));
      editing = null;
      var next = move ? neighbor(date, g, move) : null;
      if (v !== +old) setPeriod(date, g, v); else renderDaily();
      if (next) startEdit(next.date, next.g);
      else { var c = $('#dailyTable td.dc[data-date="' + date + '"][data-g="' + g + '"]'); if (c) c.focus(); }
    }
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(e.shiftKey ? 'up' : 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); done(e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') { inp.value = old; done(null); }
    });
    inp.addEventListener('blur', function () { if (editing && editing.date === date && editing.g === g) done(null); });
  }
  // 수정 가능한 이웃 칸(아래=다음 주 같은 요일, 오른쪽=다음 칸)
  function neighbor(date, g, dir) {
    var cells = Array.prototype.slice.call(document.querySelectorAll('#dailyTable td.dc[tabindex]'));
    var rows = {}, order = [];
    cells.forEach(function (c) { var tr = c.parentNode; if (!rows[tr.rowIndex]) { rows[tr.rowIndex] = []; order.push(tr.rowIndex); } rows[tr.rowIndex].push(c); });
    var cur = cells.filter(function (c) { return c.dataset.date === date && c.dataset.g === String(g); })[0];
    if (!cur) return null;
    var pick = null;
    if (dir === 'right' || dir === 'left') { var i = cells.indexOf(cur) + (dir === 'right' ? 1 : -1); pick = cells[i]; }
    else {
      var col = cur.cellIndex, ri = order.indexOf(cur.parentNode.rowIndex);
      for (var j = ri + (dir === 'down' ? 1 : -1); j >= 0 && j < order.length && !pick; j += dir === 'down' ? 1 : -1) {
        pick = rows[order[j]].filter(function (c) { return c.cellIndex === col; })[0] || null;
      }
    }
    return pick ? { date: pick.dataset.date, g: +pick.dataset.g } : null;
  }

  // ---------- 주별 시수 ----------
  function renderWeeks() {
    var r = result, h = '<thead><tr><th class="l">주</th><th class="l">기간</th><th class="l">소속 월</th><th>수업일</th>' + GR.map(function (g) { return '<th>' + g + '학년</th>'; }).join('') + '<th class="l">비고(쉬는 평일)</th></tr></thead><tbody>';
    var sem = 0, n = 0, sub = null, lastMonth = null;
    function subRow() { if (!sub) return ''; return '<tr class="sum"><td class="l" colspan="3">' + sem + '학기 계</td><td>' + sub.days + '</td>' + GR.map(function (g) { return '<td>' + fmt(sub.h[g]) + '</td>'; }).join('') + '<td></td></tr>'; }
    (r.weeks || []).forEach(function (w) {
      if (w.sem !== sem) { h += subRow(); sem = w.sem; n = 0; sub = { days: 0, h: {} }; GR.forEach(function (g) { sub.h[g] = 0; }); lastMonth = null; }
      n++; sub.days += w.days; GR.forEach(function (g) { sub.h[g] += w.hours[g]; });
      var mstart = lastMonth !== null && lastMonth !== w.month; lastMonth = w.month;
      h += '<tr' + (mstart ? ' class="mstart"' : '') + '><td class="l">' + n + '</td><td class="l">' + md(w.monday) + ' ~ ' + md(w.friday) + '</td><td class="l">' + (+w.month.slice(5)) + '월</td><td>' + w.days + '</td>' + GR.map(function (g) { return '<td>' + w.hours[g] + '</td>'; }).join('') + '<td class="l muted">' + esc(weekNote(w.monday)) + '</td></tr>';
    });
    h += subRow();
    if (r.ready) h += '<tr class="sum"><td class="l" colspan="3">연간 합계</td><td>' + r.totals.days.total + '</td>' + GR.map(function (g) { return '<td>' + fmt(r.totals.hours[g].total) + '</td>'; }).join('') + '<td></td></tr>';
    $('#weekTable').innerHTML = h + '</tbody>';
  }

  function weekNote(monday) {
    var out = [];
    for (var i = 0; i < 5; i++) { var d = dayMap[E.addDays(monday, i)]; if (d && d.off && d.status !== 'outside') out.push(md(d.date) + ' ' + (d.labels.filter(function (l) { return l !== '수능'; })[0] || d.labels[0] || '휴업')); }
    return out.join(', ');
  }

  // ---------- 설정 ----------
  var DATE_FIELDS = [['start', '시업일'], ['summerStart', '여름방학식'], ['summerEnd', '2학기 개학일'], ['winterStart', '겨울방학식'], ['winterEnd', '겨울 개학일'], ['end', '종업일']];
  var redraftArmed = false, resetArmed = false, draftModeSel = null, draftEndSel = null, draftTarget = 190;
  function decemberEnd(year, keep) {
    var end = keep && keep.dates.end;
    return end && end.slice(0, 7) === year + '-12' ? end : E.draft(year, H, { mode: 'dec', keep: keep }).state.dates.end;
  }
  function validDecemberEnd(input, year, keep) {
    input.setCustomValidity('');
    if (!input.reportValidity()) return false;
    var day = E.build(keep || E.defaultState(year), H).days.filter(function (d) { return d.date === input.value; })[0];
    if (!day || day.off) input.setCustomValidity('종업일은 주말·공휴일·자율휴업일을 제외한 수업 가능한 날짜로 선택하세요.');
    return input.reportValidity();
  }
  function renderSettings() {
    var s = state, r = result, y = s.year;
    var baseDetails = $('#semesterBase'), baseOpen = baseDetails && baseDetails.open;
    var hasBase2 = GR.some(function (g) { return s.basePeriods2 && s.basePeriods2[g] && s.basePeriods2[g].some(function (v) { return v != null; }); });
    var mode = draftModeSel || (s.dates.end && s.dates.end.slice(0, 7) === y + '-12' ? 'dec' : s.dates.winterEnd ? 'feb' : 'jan');
    var decEnd = draftEndSel || (mode === 'dec' ? decemberEnd(y, s) : '');
    var stTxt = cloud === 'off' ? '시트 주소(config.js)가 없어 이 브라우저에만 저장됩니다.'
      : cloud === 'offline' ? '구글시트에 연결하지 못했습니다. 이 브라우저에 저장해 두었다가 연결되면 올립니다.'
      : canWrite ? '구글시트에 학년도별로 자동 저장됩니다. 이 브라우저에도 백업합니다.'
      : '시트에서 읽기만 합니다. 담당자 비밀번호를 넣으면 시트에 저장됩니다.';
    if (cloudYears.length) stTxt += ' 시트에 있는 학년도: ' + cloudYears.map(function (k) { return '<button class="btn small" data-open-year="' + k + '">' + k + '</button>'; }).join(' ');
    var pwRow = cloud === 'off' ? '' : canWrite
      ? '<div class="grid2"><span class="muted">담당자 비밀번호 확인됨</span><button class="btn" data-act="pwForget">이 브라우저에서 비밀번호 지우기</button></div>'
      : '<div class="grid2"><input type="password" id="pwIn" placeholder="담당자 비밀번호" aria-label="담당자 비밀번호" autocomplete="current-password"><button class="btn primary" data-act="pwConnect">시트 저장 연결</button></div>' +
        '<label class="opt"><input type="checkbox" id="pwRemember" checked>이 브라우저에 비밀번호 기억 (공용 컴퓨터에서는 끄세요)</label><span id="pwMsg" class="muted"></span>';
    var c0 = '<section class="card" id="storeCard"><h2>저장</h2><p>' + stTxt + '</p>' + pwRow +
      '<label class="field">이 기기 이름 <span class="muted">(충돌 안내에 "「학교」에서 저장"처럼 표시)</span><input id="devName" maxlength="30" placeholder="예: 학교 교무실, 집" value="' + esc(ST.device()) + '"></label>' +
      '<div class="grid2"><button class="btn" data-act="download">' + esc(ST.fileName(y)) + ' 내려받기</button>' +
      '<label class="btn" style="text-align:center">파일 불러오기<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>' +
      '<div class="reset"><button class="btn danger" data-act="reset">' + (resetArmed ? '한 번 더 누르면 모두 지웁니다' : '완전 초기화') + '</button>' +
      '<span class="muted">이 브라우저의 모든 학년도 백업·학교 이름·비밀번호를 지우고 처음 화면으로 돌아갑니다. 구글시트의 자료는 지우지 않습니다.</span></div></section>';
    var c1 = c0 + '<section class="card"><h2>학년도 날짜</h2><p>방학식·종업일 당일은 수업일입니다. 12월·1월 종업으로 겨울 개학이 없으면 겨울방학식과 겨울 개학일을 비웁니다. 종업일을 겨울 개학 전으로 앞당기면 두 날짜를 자동으로 비웁니다.</p><div class="grid2">' +
      DATE_FIELDS.map(function (f) { return '<label class="field">' + f[1] + '<input type="date" data-date-field="' + f[0] + '" value="' + (s.dates[f[0]] || '') + '" min="' + y + '-03-01" max="' + E.lastDayOfFeb(y + 1) + '"></label>'; }).join('') +
      '</div><div class="grid2"><select id="draftMode" aria-label="초안 종업 방식"><option value="dec">12월 종업 초안</option><option value="jan">1월 종업 초안</option><option value="feb">2월 종업 초안</option></select>' +
      '<button class="btn' + (redraftArmed ? ' danger' : '') + '" data-act="redraft">' + (redraftArmed ? '한 번 더 누르면 날짜·행사일을 새로 계산' : '초안 다시 만들기') + '</button></div>' +
      '<div id="draftDecember"' + (mode === 'dec' ? '' : ' hidden') + '><label class="field">12월 종업일<input id="draftEndDate" type="date" required min="' + y + '-12-01" max="' + y + '-12-31" value="' + decEnd + '" aria-describedby="draftDecemberHint"></label><p id="draftDecemberHint">선택한 종업일은 고정하고, 목표 수업일수에 맞춰 초안의 여름방학 기간을 조정합니다. 그래도 부족한 일수·시수는 판정에 표시합니다.</p></div>' +
      '<label class="field">초안 목표 수업일수<input type="number" id="draftTarget" min="190" max="220" value="' + draftTarget + '"></label>' +
      '<p>초안을 다시 만들면 학년도 날짜와 시업·방학·개학·종업 행사일이 새로 정해집니다. 자율휴업일, 공휴일 편집, 수능 처리, 기준 시수, 작년 시수, 다른 시수 조정은 그대로 둡니다.</p></section>';
    var sd = r.suneungDate;
    var sItem = (H.items || []).filter(function (i) { return i.date === sd && i.kind === 'event'; })[0];
    c1 += '<section class="card"><h2>수능일 처리</h2><p>' + (sd ? md(sd) + ' (' + E.WEEKDAY[E.dow(sd)] + ')' + (sItem && !sItem.sure ? ' · 추정 날짜, 발표 후 확인' : '') : '수능일 없음') + '</p>' +
      '<div class="opts">' + [['normal', '정상 수업'], ['minus1', '1교시 빼기'], ['closure', '자율휴업일']].map(function (o) { return '<label class="opt"><input type="radio" name="suneung" value="' + o[0] + '"' + (s.suneung.mode === o[0] ? ' checked' : '') + '>' + o[1] + '</label>'; }).join('') +
      '</div><label class="field">수능일 직접 지정<input type="date" data-suneung-date value="' + (s.suneung.date || '') + '" min="' + y + '-09-01" max="' + y + '-12-31"></label></section>';
    c1 += '<section class="card" id="prevCard"><h2>작년 이수 시수</h2><p>2·4·6학년은 작년(1·3·5학년 때) 실제 이수 시수가 있어야 학년군 판정을 합니다. 나이스 기록 기준으로 넣으세요.</p><div class="grid2">' +
      [2, 4, 6].map(function (g) { return '<label class="field">' + g + '학년 (작년 ' + (g - 1) + '학년)<input type="number" min="0" data-prev="' + g + '" value="' + (s.prevYear[g] == null ? '' : s.prevYear[g]) + '" placeholder="예: ' + (g === 2 ? 870 : g === 4 ? 986 : 1088) + '"></label>'; }).join('') +
      '</div></section>';

    var c2 = '<section class="card"><h2>요일별 기준 시수</h2><p>기본은 1·2학기 동일합니다. 2학기만 다른 경우 아래 꺾쇠를 펼쳐 바꾸세요.</p><table class="base" aria-label="공통 기준 시수"><tr><th></th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>주</th><th>최대</th></tr>' +
      GR.map(function (g) { var b = s.basePeriods[g]; return '<tr><th>' + g + '학년</th>' + b.map(function (v, i) { return '<td><input type="number" min="0" max="12" data-base="' + g + ':' + i + '" aria-label="공통 ' + g + '학년 ' + E.WEEKDAY[i + 1] + '요일" value="' + v + '"></td>'; }).join('') + '<td>' + b.reduce(function (a, c) { return a + c; }, 0) + '</td><td><input type="number" min="1" max="12" data-max="' + g + '" aria-label="' + g + '학년 하루 최대 교시" value="' + s.maxPeriods[g] + '"></td></tr>'; }).join('') +
      '</table><p>최대: 자동 보충 제안의 하루 상한. 체험학습 등은 일별 시수에서 8교시로 직접 조정할 수 있습니다.</p>' +
      '<details id="semesterBase" class="semester-base"' + (baseOpen ? ' open' : '') + '><summary>2학기 기준 시수가 다를 때 <span class="tag">' + (hasBase2 ? '별도 설정 중' : '현재 동일') + '</span></summary>' +
      '<p id="semesterBaseHint">다른 칸만 입력하세요. 빈칸은 위의 공통 기준을 따릅니다. 접어도 입력한 값은 유지됩니다.</p><table class="base" aria-label="2학기 기준 시수"><tr><th></th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>주</th></tr>' +
      GR.map(function (g) { var b = E.basePeriodsFor(s, g, 2), overrides = s.basePeriods2 && s.basePeriods2[g] || []; return '<tr><th>' + g + '학년</th>' + b.map(function (v, i) { return '<td><input type="number" min="0" max="12" data-base2="' + g + ':' + i + '" aria-label="2학기 ' + g + '학년 ' + E.WEEKDAY[i + 1] + '요일" aria-describedby="semesterBaseHint" placeholder="' + s.basePeriods[g][i] + '" value="' + (overrides[i] == null ? '' : overrides[i]) + '"></td>'; }).join('') + '<td>' + b.reduce(function (a, c) { return a + c; }, 0) + '</td></tr>'; }).join('') +
      '</table><button class="btn small" data-act="resetBase2"' + (hasBase2 ? '' : ' disabled') + '>2학기도 공통 기준으로 되돌리기</button></details></section>';
    var bridges = E.bridgeDays(y, H, s).filter(function (b) { return !(s.closures || []).some(function (c) { return c.date === b.date; }); });
    c2 += '<section class="card"><h2>자율휴업일</h2><div class="hlist">' + ((s.closures || []).length ? s.closures.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (c) {
      return '<div class="h"><span>' + md(c.date) + ' ' + esc(c.name || '자율휴업일') + '<span class="tag">' + esc(c.reason || '사유 없음') + '</span></span><button class="btn text" data-del-closure="' + c.date + '">빼기</button></div>';
    }).join('') : '<div class="h muted">없음</div>') + '</div>' +
      (bridges.length ? '<p>징검다리 평일(앞뒤가 쉬는 날): ' + bridges.map(function (b) { return '<button class="btn small" data-add-closure="' + b.date + '">' + md(b.date) + '(' + b.weekday + ') 추가</button>'; }).join(' ') + '</p>' : '') + '</section>';

    var from = y + '-03-01', to = E.lastDayOfFeb(y + 1);
    var hol = (H.items || []).filter(function (i) { return i.kind !== 'event' && i.date >= from && i.date <= to; });
    var c3 = '<section class="card"><h2>공휴일 목록</h2><p>기본 데이터는 2026년 개정 공휴일 규정 기준입니다. 바뀐 공휴일은 빼거나 더하세요.</p><div class="hlist">' +
      hol.map(function (i) { var off = (s.removedHolidays || []).indexOf(i.date) >= 0; return '<div class="h' + (off ? ' off' : '') + '"><span>' + md(i.date) + '(' + dayMap[i.date].weekday + ') ' + esc(i.name) + (i.sure === false ? '<span class="tag">추정</span>' : '') + '</span><button class="btn text" data-toggle-hol="' + i.date + '">' + (off ? '되돌리기' : '빼기') + '</button></div>'; }).join('') +
      (s.extraHolidays || []).map(function (h) { return '<div class="h"><span>' + md(h.date) + ' ' + esc(h.name) + '<span class="tag">추가</span></span><button class="btn text" data-del-extra="' + h.date + '">빼기</button></div>'; }).join('') +
      '</div><div class="grid2"><input type="date" id="newHolDate" min="' + from + '" max="' + to + '" aria-label="추가할 공휴일 날짜"><input id="newHolName" placeholder="이름 (예: 임시공휴일)" aria-label="추가할 공휴일 이름"></div><button class="btn" data-act="addHol">공휴일 추가</button></section>';
    var evs = (s.events || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    c3 += '<section class="card"><h2>행사·시수 조정 (' + evs.length + ')</h2><div class="hlist">' + (evs.length ? evs.map(function (e) {
      return '<div class="h"><span>' + md(e.date) + ' ' + esc(e.name) + '<span class="tag">' + GR.map(function (g) { return e.periods[g] == null ? '-' : e.periods[g]; }).join('/') + '</span></span><button class="btn text" data-open="' + e.date + '">보기</button></div>';
    }).join('') : '<div class="h muted">없음</div>') + '</div></section>';

    $('#settings').innerHTML = '<div class="col">' + c1 + '</div><div class="col">' + c2 + '</div><div class="col">' + c3 + '</div>';
    $('#draftMode').value = mode;
  }
  // 기준 표는 입력 요소를 유지해 Tab·클릭 이동과 꺾쇠 조작을 끊지 않는다.
  function refreshBaseSettings() {
    GR.forEach(function (g) {
      var common = state.basePeriods[g], second = E.basePeriodsFor(state, g, 2);
      var overrides = state.basePeriods2 && state.basePeriods2[g] || [];
      common.forEach(function (v, i) {
        var firstInput = $('[data-base="' + g + ':' + i + '"]');
        var secondInput = $('[data-base2="' + g + ':' + i + '"]');
        firstInput.value = v;
        secondInput.value = overrides[i] == null ? '' : overrides[i];
        secondInput.placeholder = v;
        if (i === 0) {
          firstInput.closest('tr').cells[6].textContent = common.reduce(function (a, b) { return a + b; }, 0);
          secondInput.closest('tr').cells[6].textContent = second.reduce(function (a, b) { return a + b; }, 0);
        }
      });
      $('[data-max="' + g + '"]').value = state.maxPeriods[g];
    });
    var hasBase2 = Object.keys(state.basePeriods2 || {}).length > 0;
    $('#semesterBase summary .tag').textContent = hasBase2 ? '별도 설정 중' : '현재 동일';
    $('[data-act="resetBase2"]').disabled = !hasBase2;
  }
  function settingsEvents() {
    var el = $('#settings');
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.id === 'pwIn') { e.preventDefault(); $('[data-act="pwConnect"]').click(); return; }
      if (e.key !== 'Enter' || !e.target.matches('[data-base], [data-base2], [data-max]')) return;
      e.preventDefault();
      var inputs = Array.prototype.slice.call(el.querySelectorAll('[data-base], [data-base2], [data-max]')).filter(function (input) { return input.offsetParent; });
      var next = inputs[inputs.indexOf(e.target) + 1];
      e.target.blur();
      if (next) { next.focus(); next.select(); }
    });
    el.addEventListener('change', function (e) {
      var t = e.target, s = clone(state);
      if (t.id === 'draftMode' || t.id === 'draftEndDate' || t.id === 'draftTarget') {
        draftModeSel = $('#draftMode').value; draftEndSel = $('#draftEndDate').value || null;
        draftTarget = Math.max(190, +$('#draftTarget').value || 190);
        redraftArmed = false;
        if (t.id === 'draftMode') renderSettings();
        else { var b = $('[data-act="redraft"]', el); b.textContent = '초안 다시 만들기'; b.classList.remove('danger'); }
        return;
      }
      if (t.id === 'devName') { ST.setDevice(t.value.trim()); return; }
      if (t.id === 'pwIn' || t.id === 'pwRemember') return;
      if (t.dataset.act === 'import' && t.files && t.files[0]) {
        ST.readFile(t.files[0]).then(function (st) {
          if (!st || !st.year || !st.dates) { setSaveText('불러올 수 없는 파일입니다'); return; }
          st = E.sanitize(st);
          return flushSave().then(function () {
            var prev = localLoad(st.year);
            undoState = prev ? prev.state : (st.year === state.year ? clone(state) : null);
            state = st; $('#yearSel').value = String(st.year); $('#schoolName').value = st.school.name || '';
            recompute(); save(); renderNotice();
          });
        }).catch(function () { setSaveText('불러올 수 없는 파일입니다'); });
        return;
      }
      if (t.dataset.dateField) { s.dates[t.dataset.dateField] = t.value || null; commitMoveCeremony(t.dataset.dateField, t.value || null); return; }
      if (t.name === 'suneung') s.suneung.mode = t.value;
      else if (t.hasAttribute('data-suneung-date')) s.suneung.date = t.value || null;
      else if (t.dataset.prev) { if (t.value === '') delete s.prevYear[t.dataset.prev]; else s.prevYear[t.dataset.prev] = +t.value; }
      else if (t.dataset.base) { var p = t.dataset.base.split(':'); s.basePeriods[p[0]][+p[1]] = Math.min(12, Math.max(0, Math.round(+t.value) || 0)); }
      else if (t.dataset.base2) {
        var p2 = t.dataset.base2.split(':');
        s.basePeriods2 = s.basePeriods2 || {};
        var row = s.basePeriods2[p2[0]] || [null, null, null, null, null];
        row[+p2[1]] = t.value === '' ? null : Math.min(12, Math.max(0, Math.round(+t.value) || 0));
        if (row.some(function (v) { return v != null; })) s.basePeriods2[p2[0]] = row;
        else delete s.basePeriods2[p2[0]];
      }
      else if (t.dataset.max) s.maxPeriods[t.dataset.max] = Math.min(12, Math.max(1, Math.round(+t.value) || 1));
      else return;
      var keepSettings = t.matches('[data-base], [data-base2], [data-max]');
      commit(s, keepSettings);
      if (keepSettings) refreshBaseSettings();
    });
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var s = clone(state);
      if (t.dataset.act === 'reset') {
        if (!resetArmed) { resetArmed = true; renderSettings(); setTimeout(function () { if (resetArmed) { resetArmed = false; if (!$('#tab-settings').hidden) renderSettings(); } }, 6000); return; }
        clearTimeout(writeTimer); writeTimer = null;
        try { Object.keys(localStorage).filter(function (k) { return k.indexOf('haksa:') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (err) { /* 저장소 막힘 */ }
        try { sessionStorage.removeItem('haksa:pw'); } catch (err) { /* 막힘 */ }
        location.reload();
        return;
      }
      if (t.dataset.act === 'pwConnect') {
        var pw = $('#pwIn').value; if (!pw) { $('#pwIn').focus(); return; }
        t.disabled = true;
        connect(pw, $('#pwRemember').checked).then(function (ok) {
          if (ok) renderSettings(); else { t.disabled = false; $('#pwMsg').textContent = '비밀번호가 맞지 않습니다'; $('#pwIn').select(); }
        }, function () { t.disabled = false; $('#pwMsg').textContent = '시트에 연결하지 못했습니다'; });
        return;
      }
      if (t.dataset.act === 'pwForget') { ST.setPassword(null); canWrite = false; renderSettings(); renderNotice(); return; }
      if (t.dataset.act === 'download') { ST.download(state.year, state); return; }
      if (t.dataset.openYear) { openYear(+t.dataset.openYear); return; }
      if (t.dataset.act === 'redraft') {
        draftModeSel = $('#draftMode').value; draftTarget = Math.max(190, +$('#draftTarget').value || 190);
        draftEndSel = $('#draftEndDate').value || null;
        if (draftModeSel === 'dec' && !validDecemberEnd($('#draftEndDate'), s.year, s)) return;
        if (!redraftArmed) { redraftArmed = true; renderSettings(); setTimeout(function () { if (redraftArmed) { redraftArmed = false; if (!$('#tab-settings').hidden) renderSettings(); } }, 6000); return; }
        redraftArmed = false;
        var d = E.draft(s.year, H, { mode: draftModeSel, endDate: draftEndSel, keep: s, targetDays: draftTarget });
        draftModeSel = null; draftEndSel = null; commit(d.state); return;
      }
      if (t.dataset.act === 'resetBase2') {
        s.basePeriods2 = {}; commit(s, true); refreshBaseSettings();
        $('#semesterBase summary').focus(); return;
      }
      if (t.dataset.delClosure) s.closures = s.closures.filter(function (c) { return c.date !== t.dataset.delClosure; });
      else if (t.dataset.addClosure) { s.closures = (s.closures || []).concat([{ date: t.dataset.addClosure, name: '자율휴업일', reason: '징검다리 평일' }]); }
      else if (t.dataset.toggleHol) { s.removedHolidays = s.removedHolidays || []; var i = s.removedHolidays.indexOf(t.dataset.toggleHol); if (i >= 0) s.removedHolidays.splice(i, 1); else s.removedHolidays.push(t.dataset.toggleHol); }
      else if (t.dataset.delExtra) s.extraHolidays = s.extraHolidays.filter(function (h) { return h.date !== t.dataset.delExtra; });
      else if (t.dataset.act === 'addHol') {
        var dt = $('#newHolDate').value, nm = $('#newHolName').value.trim() || '임시공휴일';
        if (!dt) { $('#newHolDate').focus(); return; }
        s.extraHolidays = (s.extraHolidays || []).concat([{ date: dt, name: nm, kind: 'temporary' }]);
      } else if (t.dataset.open) { go('year'); openDrawer(t.dataset.open); return; }
      else return;
      commit(s);
    });
  }
  // 날짜를 바꾸면 그날 행사(방학식 등)도 함께 옮긴다
  function commitMoveCeremony(field, value) {
    draftModeSel = null; draftEndSel = null; redraftArmed = false;
    commit(E.apply(state, { type: 'setDate', field: field, value: value || null }));
  }

  // ---------- 탭 ----------
  function go(tab) {
    hideDailyDate();
    if (tab === 'prev') { go('settings'); var p = $('[data-prev="2"]'); if (p) p.focus(); return; }
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    ['year', 'daily', 'weeks', 'staff', 'assign', 'compare', 'tools', 'settings'].forEach(function (k) { var t = $('#tab-' + k); if (t) t.hidden = k !== tab; });
    if (selected) closeDrawer();
    if (tab === 'weeks') renderWeeks();
    if (tab === 'daily') renderDaily();
    if (tab === 'staff' && window.TTUI) TTUI.render();
    if ((tab === 'compare' || tab === 'tools') && window.ExtUI) ExtUI.render();
    if (tab === 'assign' && window.StaffUI) StaffUI.render();
    if (tab === 'settings') renderSettings();
  }

  // ---------- 엑셀 내보내기 ----------
  var EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (window.ExcelJS) return res();
      var sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = function () { rej(new Error('load')); };
      document.head.appendChild(sc);
    });
  }
  function exportXlsx() {
    var btn = $('#btnExport');
    if (!result.ready) { setSaveText('날짜를 먼저 입력하세요'); return; }
    if (result.checks.some(function (c) { return c.level === 'error' && !/^(days-short|hours-short)$/.test(c.code); })) { setSaveText('날짜 설정 오류를 먼저 고치세요'); renderNotice(); return; }
    btn.disabled = true; btn.textContent = '만드는 중…';
    var name = window.ExportXlsx.fileName(state);
    loadScript(EXCELJS).then(function () { return window.ExportXlsx.build(result, H); }).then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      ST.downloadBlob(name, blob); setSaveText('엑셀 내려받기 ' + now());
    }).catch(function () { setSaveText('엑셀을 만들지 못했습니다(인터넷 연결 확인)'); })
      .then(function () { btn.disabled = false; btn.textContent = '엑셀 내보내기'; });
  }

  // ---------- 사용법 ----------
  var helpReturn = null;
  function openHelp(sec) {
    helpReturn = document.activeElement;
    $('#help').hidden = false; showHelp(sec || 'start');
    var b = $('#help .help-nav button[aria-current="true"]'); if (b) b.focus();
  }
  function closeHelp() { $('#help').hidden = true; if (helpReturn && helpReturn.focus) helpReturn.focus(); }
  function showHelp(k) {
    document.querySelectorAll('#help .help-nav button').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.h === k)); });
    document.querySelectorAll('#help [data-hs]').forEach(function (s) { s.hidden = s.dataset.hs !== k; });
  }
  function helpEvents() {
    $('#btnHelp').addEventListener('click', function () { openHelp(); });
    $('#help').addEventListener('click', function (e) {
      if (e.target.id === 'help' || e.target.closest('[data-help-close]')) { closeHelp(); return; }
      var b = e.target.closest('.help-nav button'); if (b) showHelp(b.dataset.h);
    });
    $('#help').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeHelp(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest('.help-nav')) {
        var bs = Array.prototype.slice.call(document.querySelectorAll('#help .help-nav button')), i = bs.indexOf(e.target);
        var n = bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]; n.focus(); showHelp(n.dataset.h); e.preventDefault();
      }
      if (e.key === 'Tab') { // 창 안에서만 이동
        var f = Array.prototype.slice.call($('#help').querySelectorAll('button')).filter(function (x) { return x.offsetParent; });
        if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
      }
    });
  }

  // ---------- 첫 실행 ----------
  function onboard() {
    var el = $('#onboard'); el.hidden = false;
    var ny = Math.min(2040, Math.max(2026, new Date().getFullYear() + 1));
    $('#obYear').innerHTML = '';
    for (var y = 2026; y <= 2040; y++) $('#obYear').insertAdjacentHTML('beforeend', '<option value="' + y + '"' + (y === ny ? ' selected' : '') + '>' + y + '학년도</option>');
    function syncDecember() {
      var year = +$('#obYear').value, input = $('#obEndDate');
      var dec = el.querySelector('input[name=obMode]:checked').value === 'dec';
      $('#obDecember').hidden = !dec; input.disabled = !dec;
      input.min = year + '-12-01'; input.max = year + '-12-31'; input.setCustomValidity('');
      if (!input.value || input.value.slice(0, 4) !== String(year)) input.value = decemberEnd(year);
    }
    $('#obYear').addEventListener('change', syncDecember);
    el.querySelectorAll('input[name=obMode]').forEach(function (input) { input.addEventListener('change', syncDecember); });
    syncDecember();
    if (cloud === 'off') { $('#obPw').disabled = true; $('#obCloud').textContent = '시트 주소(config.js)가 없어 이 브라우저에만 저장됩니다.'; }
    $('#obSchool').focus();
    function start() {
      var year = +$('#obYear').value, mode = el.querySelector('input[name=obMode]:checked').value;
      if (mode === 'dec' && !validDecemberEnd($('#obEndDate'), year)) return;
      var prev = {}; [2, 4, 6].forEach(function (g) { var v = $('#obPrev' + g).value; if (v !== '') prev[g] = +v; });
      store('haksa:school', $('#obSchool').value.trim());
      var pw = $('#obPw').value;
      var auth = pw && cloud === 'on' ? ST.check(pw).then(function (ok) { if (ok) { ST.setPassword(pw, true); canWrite = true; } return ok; }, function () { return true; }) : Promise.resolve(true);
      auth.then(function (ok) {
        if (!ok) { $('#obCloud').textContent = '비밀번호가 맞지 않습니다. 비워 두면 이 브라우저에만 저장합니다.'; $('#obPw').select(); return; }
        return loadYear(year, mode, mode === 'dec' ? $('#obEndDate').value : null).then(function (o) {
          state = o.state;
          state.school.name = $('#obSchool').value.trim() || state.school.name || '';
          Object.keys(prev).forEach(function (g) { state.prevYear[g] = prev[g]; });
          $('#schoolName').value = state.school.name; $('#yearSel').value = String(year);
          return linkPrevYear();
        }).then(function () {
          el.hidden = true; firstRun = false; recompute(); save(); renderNotice();
          if (window.TTUI) TTUI.load(state.year); // 처음 시작에서도 시간표 모듈에 학년도를 알려 줌(없으면 가져온 시간표가 연도 없이 저장됨)
          if (window.ExtUI) ExtUI.load();
        });
      });
    }
    $('#obStart').onclick = start;
    var hl = $('#obHelp'); if (hl) hl.onclick = function () { openHelp(); };
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); start(); } });
  }

  // ---------- 시작 ----------
  function init() {
    var sel = $('#yearSel'), last = +read('haksa:last') || new Date().getFullYear() + 1;
    if (last < 2026 || last > 2040) last = 2027;
    for (var y = 2026; y <= 2040; y++) sel.insertAdjacentHTML('beforeend', '<option value="' + y + '">' + y + '학년도</option>');
    sel.value = String(last);
    if (VIEW) viewOnly();
    else if (window.TTUI) TTUI.init({
      getState: function () { return state; }, getResult: function () { return result; }, commit: commit,
      canWrite: function () { return canWrite && cloud === 'on'; }, cloudState: function () { return cloud; },
      esc: esc, fmt: fmt, md: md
    });
    if (!VIEW && window.ExtUI) ExtUI.init({
      getState: function () { return state; }, getResult: function () { return result; }, commit: commit,
      canWrite: function () { return canWrite && cloud === 'on'; }, cloudState: function () { return cloud; },
      otherYear: otherYear, esc: esc, fmt: fmt, md: md
    });
    if (window.StaffUI) StaffUI.init({
      getState: function () { return state; }, commit: commit,
      canWrite: function () { return canWrite && cloud === 'on'; }, esc: esc
    });
    sel.addEventListener('change', function () { undoState = null; if (VIEW) store('haksa:viewYear', sel.value); openYear(+sel.value); });
    $('#schoolName').addEventListener('change', save);
    $('#schoolName').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
    $('#btnExport').addEventListener('click', exportXlsx);
    $('#saveState').addEventListener('click', function () { if (VIEW) { checkRemote(); return; } go('settings'); var c = $('#storeCard'); if (c) c.scrollIntoView({ block: 'nearest' }); });
    document.querySelector('.tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(b.dataset.tab); });
    $('#planner').addEventListener('click', function (e) { var c = e.target.closest('.cell[data-date]'); if (c) openDrawer(c.dataset.date); });
    $('#summary').addEventListener('click', function (e) {
      if (VIEW) return;
      var f = e.target.closest('[data-fix]'); if (f) { openFix(); return; }
      var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go);
    });
    drawerEvents(); settingsEvents(); noticeEvents(); helpEvents(); dailyDateEvents();
    $('#dailyTable').addEventListener('click', function (e) {
      var td = e.target.closest('td.dc'); if (!td || e.target.tagName === 'INPUT') return;
      hideDailyDate();
      if (td.hasAttribute('tabindex')) startEdit(td.dataset.date, +td.dataset.g);
      else if (dayMap[td.dataset.date] && dayMap[td.dataset.date].status !== 'outside') openDrawer(td.dataset.date);
    });
    $('#dailyTable').addEventListener('keydown', function (e) {
      var td = e.target.closest && e.target.closest('td.dc[tabindex]');
      if (td && e.target === td && (e.key === 'Enter' || /^[0-9]$/.test(e.key))) { e.preventDefault(); startEdit(td.dataset.date, +td.dataset.g); if (/^[0-9]$/.test(e.key)) { var i = td.querySelector('input'); if (i) i.value = e.key; } }
    });
    $('#semTabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { dailySem = +b.dataset.sem; editing = null; renderDaily(); } });

    // 다른 곳(집·학교)에서 저장했는지 창으로 돌아올 때 확인
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkRemote(); });
    window.addEventListener('focus', checkRemote);
    setInterval(function () { if (document.visibilityState === 'visible') checkRemote(); }, 120000);

    // 화면을 먼저 그리고(브라우저 백업 또는 초안), 시트를 확인해 바꾼다
    state = (!VIEW && (localLoad(last) || {}).state) || E.draft(last, H, { mode: 'feb' }).state;
    $('#schoolName').value = state.school.name || read('haksa:school') || '';
    cloud = ST.configured() ? 'on' : 'off';
    recompute();
    setSaveText(ST.configured() ? '시트 확인 중…' : '브라우저 자료');
    var pw = VIEW ? '' : ST.password();
    refreshCloudYears().then(function () {
      if (!pw || cloud !== 'on') return;
      return ST.check(pw).then(function (ok) { canWrite = ok; if (!ok) ST.setPassword(null); }, function (e) { cloudFail(e); });
    }).then(function () {
      if (VIEW) {
        // 보기 전용: 시트에 있는 학년도만 고를 수 있다
        if (cloudYears.length) {
          sel.innerHTML = cloudYears.map(function (k) { return '<option value="' + k + '">' + k + '학년도</option>'; }).join('');
          var vy = +read('haksa:viewYear');
          last = cloudYears.indexOf(vy) >= 0 ? vy : cloudYears.indexOf(new Date().getFullYear()) >= 0 ? new Date().getFullYear() : cloudYears[cloudYears.length - 1];
        }
        return openYear(last);
      }
      // 처음 쓰는 브라우저라도 시트에 자료가 있으면 시작 화면 없이 바로 연다
      firstRun = !read('haksa:last') && !cloudYears.length;
      if (firstRun) { onboard(); return; }
      if (!read('haksa:last') && cloudYears.length) last = cloudYears[cloudYears.length - 1];
      return openYear(last);
    });
  }
  // 보기 전용 페이지: 편집 탭·사용법·보충 서랍을 숨기고 학교 이름을 읽기 전용으로
  function viewOnly() {
    document.body.classList.add('view-only');
    ['daily', 'staff', 'compare', 'tools', 'settings'].forEach(function (k) { var b = $('.tabs [data-tab="' + k + '"]'); if (b) b.remove(); });
    $('#btnHelp').hidden = true;
    $('#schoolName').readOnly = true;
    $('#saveState').title = '시트에 저장된 학사일정을 보여 줍니다';
    $('#btnExport').title = '달력·일별·주별 3개 시트 엑셀 내려받기';
  }
  init();
})();
