/* 화면: 전담 배정 탭 (김해외동초 ⑤). 계산은 staff.js
 * 자료는 학사일정의 state.ext.staff 라서 학사일정과 함께 시트·브라우저에 저장된다.
 * 보기 페이지(HAKSA_VIEW)에서는 「보기 페이지에 공개」를 켠 경우에만 탭이 보이고 고칠 수 없다.
 */
(function () {
  'use strict';
  var S = window.Staff, T = window.Timetable, ST = window.Store;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var VIEW = !!window.HAKSA_VIEW;
  var api = null, msg = '', seedArmed = false, delArmed = null;

  function esc(s) { return api.esc(s); }
  function one(n) { return (Math.round(n * 10) / 10).toLocaleString('ko-KR'); }
  function ttNow() { var st = api.getState(); return window.TTUI && TTUI.year && TTUI.year() === st.year ? TTUI.data() : null; }
  function cur() { return S.of(api.getState()); }
  function commit(staff) { api.commit(S.put(api.getState(), staff)); }

  // ---------- 그리기 ----------
  function render() {
    if (!api) return;
    var st = api.getState(), staff = cur();
    var btn = $('.tabs [data-tab="assign"]');
    if (VIEW && btn) {
      var show = !!(staff && staff.published && staff.teachers.length);
      btn.hidden = !show;
      if (!show && !$('#tab-assign').hidden) { var y = $('.tabs [data-tab="year"]'); if (y) y.click(); }
    }
    var el = $('#assign'); if (!el || $('#tab-assign').hidden) return;
    if (VIEW) { el.innerHTML = staff ? summaryCard(st, staff) + gradeCard(staff) : ''; return; }
    var focus = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset ? Object.assign({}, document.activeElement.dataset) : null;
    el.innerHTML = headCard(st, staff) + (staff ? teacherCard(staff) + checkCard(staff) + gradeCard(staff) : '');
    if (focus) { var k = Object.keys(focus)[0]; var again = k && el.querySelector('[data-' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }) + '="' + focus[k] + '"]'); if (again) again.focus(); }
  }

  function headCard(st, staff) {
    var tt = ttNow();
    var h = '<section class="card"><div class="ttbar"><h2>전담 배정 짜기 <small class="muted">' + st.year + '학년도</small></h2>' +
      '<button class="btn' + (seedArmed ? ' danger' : staff ? '' : ' primary') + '" data-sa="seed">' + (seedArmed ? '한 번 더 누르면 지금 배정을 덮어씁니다' : '시간표에서 불러오기') + '</button>' +
      (staff ? '<button class="btn" data-sa="newTeacher">교사 추가</button>' +
        '<button class="btn primary" data-sa="apply"' + (tt ? '' : ' disabled title="이 학년도 시간표가 아직 없습니다"') + '>담임·전담 탭에 반영</button>' +
        '<label class="chkline"><input type="checkbox" data-sa="published"' + (staff.published ? ' checked' : '') + '> 보기 페이지에 공개</label>' : '') +
      '</div><p>교사마다 맡을 학년·과목·학급 수와 <b>학급당 주당 시간</b>을 정하면 교사별 합계와 목표 범위, 학년별 학급당 전담 시간, 과학 학기 교차 편성을 바로 점검합니다. ' +
      '요일·교시 칸은 여기서 놓지 않습니다. <b>담임·전담 탭에 반영</b>하면 그 학년도 시간표의 전담 교사 목록(이름·맡은 것)이 바뀌고, 칸은 담임·전담 탭의 편집에서 놓습니다. 공식 시수와는 관계없습니다.</p>' +
      (staff ? '' : '<p><b>시간표에서 불러오기</b>를 누르면 ' + st.year + '학년도(없으면 ' + (st.year - 1) + '학년도) 시간표의 전담 배정을 기본값으로 깝니다. 학급 수만 바꿔 고쳐 쓰면 됩니다.</p>');
    if (msg) h += '<p><b>' + esc(msg) + '</b></p>';
    if (staff) {
      h += '<div class="ttbar">' + S.GRADES.map(function (g) {
        return '<label class="field">' + g + '학년 학급<input type="number" min="0" max="20" style="width:4.5rem" data-sc="' + g + '" value="' + staff.classes[g] + '"></label>';
      }).join('') + '<span class="muted">모두 ' + S.GRADES.reduce(function (a, g) { return a + staff.classes[g]; }, 0) + '학급</span></div>';
    }
    return h + '</section>';
  }

  function teacherCard(staff) {
    var tt = ttNow(), vs = tt ? S.versus(staff, tt) : null;
    function tot(t, sem) {
      var r = S.range(t, sem), cls = { low: 'warn', high: 'warn', ok: 'ok', none: 'info' }[r];
      var a = vs && vs[t.id] ? vs[t.id][sem].actual : null;
      return '<span class="chip ' + cls + '">' + S.load(t, sem) + '</span>' + (a != null && a !== S.load(t, sem) ? '<br><small class="muted" title="시간표에 놓은 칸">칸 ' + a + '</small>' : '');
    }
    var h = '<section class="card"><h2>교사별 배정</h2><div class="ttscroll"><table class="data staffplan"><tr><th class="l">교사</th><th>학년</th><th class="l">과목</th><th>학급 수</th><th>1학기<br><small>학급당</small></th><th>2학기<br><small>학급당</small></th><th>1학기 계</th><th>2학기 계</th><th></th></tr>';
    staff.teachers.forEach(function (t, ti) {
      h += '<tr class="thead"><td class="l" colspan="4"><input data-st="' + ti + ':name" value="' + esc(t.name) + '" aria-label="교사 이름" style="width:7rem"> ' +
        '<select data-st="' + ti + ':kind" aria-label="종류"><option value="specialist"' + (t.kind === 'specialist' ? ' selected' : '') + '>전담</option><option value="sports"' + (t.kind === 'sports' ? ' selected' : '') + '>스포츠강사</option></select> ' +
        '<input data-st="' + ti + ':note" value="' + esc(t.note) + '" placeholder="메모(예: 영어회화전문강사)" aria-label="메모" style="width:11rem"> ' +
        '<span class="muted">목표</span> <input type="number" min="0" max="60" data-st="' + ti + ':min" value="' + (t.min == null ? '' : t.min) + '" aria-label="목표 최소" style="width:3.5rem">~<input type="number" min="0" max="60" data-st="' + ti + ':max" value="' + (t.max == null ? '' : t.max) + '" aria-label="목표 최대" style="width:3.5rem"></td>' +
        '<td colspan="2"><button class="btn small" data-sa="addItem" data-ti="' + ti + '">줄 추가</button></td><td>' + tot(t, 1) + '</td><td>' + tot(t, 2) + '</td>' +
        '<td><button class="btn small' + (delArmed === 't' + ti ? ' danger' : '') + '" data-sa="delTeacher" data-ti="' + ti + '">' + (delArmed === 't' + ti ? '한 번 더' : '교사 빼기') + '</button></td></tr>';
      t.items.forEach(function (x, ii) {
        var k = ti + ':' + ii + ':';
        h += '<tr><td></td><td><select data-si="' + k + 'grade" aria-label="학년">' + S.GRADES.map(function (g) { return '<option value="' + g + '"' + (x.grade === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></td>' +
          '<td class="l"><input data-si="' + k + 'subject" value="' + esc(x.subject) + '" aria-label="과목" style="width:5rem"></td>' +
          '<td><input type="number" min="0" max="20" data-si="' + k + 'n" value="' + x.n + '" aria-label="학급 수" style="width:3.5rem"><small class="muted">/' + staff.classes[x.grade] + '</small></td>' +
          '<td><input type="number" min="0" max="10" data-si="' + k + 'h1" value="' + x.h1 + '" aria-label="1학기 학급당 주당 시간" style="width:3.5rem"></td>' +
          '<td><input type="number" min="0" max="10" data-si="' + k + 'h2" value="' + x.h2 + '" aria-label="2학기 학급당 주당 시간" style="width:3.5rem"></td>' +
          '<td class="muted">' + x.n * x.h1 + '</td><td class="muted">' + x.n * x.h2 + '</td>' +
          '<td><button class="btn small" data-sa="delItem" data-ti="' + ti + '" data-ii="' + ii + '" aria-label="줄 빼기">빼기</button></td></tr>';
      });
    });
    return h + '</table></div><p class="muted">계 = 학급 수 × 학급당 주당 시간. 색: 초록 목표 안 · 주황 목표 밖 · 회색 목표 없음.' + (tt ? ' 「칸」은 담임·전담 탭 시간표에 실제로 놓인 주당 칸 수(계획과 다를 때만).' : '') + '</p></section>';
  }

  function checkCard(staff) {
    var list = S.checks(staff), lv = { bad: 0, warn: 1, info: 2 };
    list.sort(function (a, b) { return lv[a.level] - lv[b.level]; });
    return '<section class="card"><h2>점검</h2>' + (list.length ? '<ul class="ttwarn">' + list.map(function (c) {
      return '<li><span class="chip ' + c.level + '">' + { bad: '오류', warn: '확인', info: '참고' }[c.level] + '</span> ' + esc(c.msg) + '</li>';
    }).join('') + '</ul>' : '<p>걸리는 것이 없습니다.</p>') + '</section>';
  }

  function gradeCard(staff) {
    return '<section class="card"><h2>학년별 전담 수업</h2><div class="ttscroll"><table class="data"><tr><th class="l">학년</th><th>학급 수</th><th class="l">과목 · 교사 · 학급 수 · 학급당 주당(1학기/2학기)</th><th>학급당 전담<br><small>1학기</small></th><th>학급당 전담<br><small>2학기</small></th></tr>' +
      S.grades(staff).map(function (g) {
        return '<tr><td class="l">' + g.grade + '학년</td><td>' + g.classes + '</td><td class="l">' + (g.subjects.map(function (x) {
          return esc(x.subject) + ' <span class="muted">' + esc(x.teacher) + (x.kind === 'sports' ? '(강사)' : '') + ' · ' + x.n + '학급 · ' + (x.h1 === x.h2 ? x.h1 : x.h1 + '/' + x.h2) + '</span>';
        }).join('<br>') || '<span class="muted">·</span>') + '</td><td>' + one(g.avg1) + '</td><td>' + one(g.avg2) + '</td></tr>';
      }).join('') + '</table></div><p class="muted">학급당 전담 = 전담 교사 수업 합계 ÷ 학급 수(평균). 스포츠강사 수업은 담임 수업이라 빼고 셉니다.</p></section>';
  }

  // 보기 페이지: 교사별 맡은 것과 주당 합계만
  function summaryCard(st, staff) {
    return '<section class="card"><h2>전담 배정 <small class="muted">' + st.year + '학년도</small></h2><div class="ttscroll"><table class="data"><tr><th class="l">교사</th><th class="l">맡은 수업</th><th>1학기 주당</th><th>2학기 주당</th></tr>' +
      staff.teachers.map(function (t) {
        return '<tr><td class="l">' + esc(t.name) + (t.kind === 'sports' ? ' <small class="muted">스포츠강사</small>' : '') + '</td><td class="l">' + esc(S.describe(t)) + '</td><td>' + S.load(t, 1) + '</td><td>' + S.load(t, 2) + '</td></tr>';
      }).join('') + '</table></div></section>';
  }

  // ---------- 동작 ----------
  function seedSource(y) {
    var tt = ttNow();
    if (tt) return Promise.resolve({ tt: tt, year: y });
    function local() {
      try { var o = JSON.parse(localStorage.getItem('haksa:tt:' + (y - 1)) || 'null'); var d = o && o.data && T.sanitize(o.data); return d ? { tt: d, year: y - 1 } : null; } catch (e) { return null; }
    }
    if (!api.canWrite()) return Promise.resolve(local());
    return ST.ttGet(y - 1).then(function (d) { d = T.sanitize(d); return d ? { tt: d, year: y - 1 } : local(); }, local);
  }
  function arm(set, ms) { setTimeout(function () { set(); render(); }, ms || 6000); }

  function events() {
    var el = $('#assign'); if (!el || VIEW) return;
    el.addEventListener('change', function (e) {
      var t = e.target, d = t.dataset, staff = cur(); if (!staff) return;
      msg = '';
      if (d.sa === 'published') { staff.published = t.checked; commit(staff); return; }
      if (d.sc) { staff.classes[d.sc] = +t.value || 0; commit(staff); return; }
      if (d.st) {
        var a = d.st.split(':'), th = staff.teachers[+a[0]], f = a[1];
        if (f === 'name') {
          var v = t.value.trim(); if (!v) { render(); return; }
          if (staff.teachers.some(function (o) { return o !== th && (o.name === v || o.id === v); })) { msg = '「' + v + '」은 이미 있는 이름입니다.'; render(); return; }
          // 아직 시간표에 없는 교사는 id 도 이름으로(게시판에서 다시 가져와도 같은 사람으로 맞게)
          var tt = ttNow();
          if (!tt || !tt.teachers.some(function (o) { return o.id === th.id; })) th.id = v;
          th.name = v;
        } else if (f === 'min' || f === 'max') th[f] = t.value === '' ? null : +t.value;
        else th[f] = t.value;
        commit(staff); return;
      }
      if (d.si) {
        var b = d.si.split(':'), x = staff.teachers[+b[0]].items[+b[1]], g = b[2];
        x[g] = g === 'subject' ? t.value : +t.value || 0;
        commit(staff);
      }
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var d = b.dataset, st = api.getState(), staff = cur();
      if (d.sa === 'seed') {
        if (staff && !seedArmed) { seedArmed = true; render(); arm(function () { seedArmed = false; }); return; }
        seedArmed = false; msg = '시간표를 찾는 중…'; render();
        seedSource(st.year).then(function (src) {
          if (!src) { msg = st.year + '·' + (st.year - 1) + '학년도 시간표가 시트·이 브라우저 어디에도 없습니다. 빈 표로 시작합니다.'; commit(S.empty()); return; }
          var s = S.fromTimetable(src.tt); if (staff) s.published = staff.published;
          msg = src.year + '학년도 시간표에서 교사 ' + s.teachers.length + '명의 배정을 불러왔습니다. 학급 수와 시간을 고쳐 쓰세요.';
          commit(s);
        });
        return;
      }
      if (!staff) return;
      if (d.sa === 'newTeacher') { staff.teachers.push(S.newTeacher(staff)); msg = ''; commit(staff); return; }
      if (d.sa === 'addItem') {
        var th = staff.teachers[+d.ti], last = th.items[th.items.length - 1];
        th.items.push({ grade: last ? last.grade : 3, subject: last ? last.subject : '', n: 0, h1: 0, h2: 0 }); commit(staff); return;
      }
      if (d.sa === 'delItem') { staff.teachers[+d.ti].items.splice(+d.ii, 1); commit(staff); return; }
      if (d.sa === 'delTeacher') {
        if (delArmed !== 't' + d.ti) { delArmed = 't' + d.ti; render(); arm(function () { delArmed = null; }); return; }
        delArmed = null; staff.teachers.splice(+d.ti, 1); commit(staff); return;
      }
      if (d.sa === 'apply') {
        var tt = ttNow(); if (!tt) return;
        var r = S.applyToTimetable(tt, staff);
        TTUI.setData(r.tt);
        msg = '담임·전담 탭에 반영했습니다: ' + [r.added.length ? '새 교사 ' + r.added.join('·') : '', r.updated.length ? '바뀜 ' + r.updated.join('·') : '', r.kept.length ? '계획에 없어 그대로 둠 ' + r.kept.join('·') : ''].filter(Boolean).join(' / ') +
          (r.added.length || r.updated.length ? '' : '바뀐 것 없음') + (r.classDiff.length ? '. 학급 수가 시간표와 다릅니다(' + r.classDiff.join(', ') + ') — 학급은 게시판에서 다시 가져와야 바뀝니다.' : '.');
        render();
      }
    });
  }

  window.StaffUI = {
    init: function (a) { api = a; events(); },
    render: render
  };
})();
