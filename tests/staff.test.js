/* ⑤ 전담 배정 짜기(staff.js) 테스트: node tests/staff.test.js  (교사 이름은 가명 자료) */
'use strict';
var path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
var root = path.join(__dirname, '..');
var ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'holidays.js'), 'utf8'), ctx);
var H = ctx.window.HOLIDAY_DATA, E = require(path.join(root, 'engine.js'));
var T = require(path.join(root, 'timetable.js')), S = require(path.join(root, 'staff.js'));

var failed = 0;
function check(name, fn) { try { fn(); console.log('  통과  ' + name); } catch (e) { failed++; console.log('  실패  ' + name + '\n        ' + (e.stack || e.message)); } }

var tt = T.fromBoard(T.parseBoard(require('./board-sample.js')), null, 'both', '2026-10-28T00:00:00Z');
var s0 = S.fromTimetable(tt);
function byName(s, n) { return s.teachers.filter(function (t) { return t.name === n; })[0]; }

console.log('시간표에서 불러오기');
check('학급 수·교사·학년별 과목 줄을 만들고, 계획 합계 = 시간표 주당 시간', function () {
  assert.deepStrictEqual(s0.classes, { 1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 4 }); // 게시판 표본은 18학급
  assert.strictEqual(s0.teachers.length, tt.teachers.length);
  var w = T.weekly(tt, 2);
  s0.teachers.forEach(function (t) {
    var actual = Object.keys(w[t.id] || {}).reduce(function (a, c) { return a + w[t.id][c]; }, 0);
    assert.strictEqual(S.load(t, 2), actual, t.name);
  });
  var b = byName(s0, '전담B');
  assert.deepStrictEqual(b.items.map(function (x) { return x.grade + x.subject; }), ['3체육', '4체육', '5실과', '6도덕']);
});
check('설명: 과목별로 학년을 모으고, 역할 메모(영어회화전문강사)는 뒤에 붙임', function () {
  assert.strictEqual(S.describe(byName(s0, '전담B')), '3,4체육 + 5실과 + 6도덕');
  var f = byName(s0, '전담F');
  assert.strictEqual(f.note, '영어회화전문강사');
  assert.ok(/ · 영어회화전문강사$/.test(S.describe(f)));
  assert.strictEqual(byName(s0, '전담C').note, '');
});

console.log('점검');
check('목표 범위: 적음·많음·맞음·범위 없음', function () {
  var t = JSON.parse(JSON.stringify(byName(s0, '전담B'))), v = S.load(t, 1);
  assert.strictEqual(S.range(t, 1), 'none');
  t.min = v + 1; assert.strictEqual(S.range(t, 1), 'low');
  t.min = null; t.max = v - 1; assert.strictEqual(S.range(t, 1), 'high');
  t.min = v; t.max = v; assert.strictEqual(S.range(t, 1), 'ok');
});
check('과학 교차 편성이 틀리면 경고, 맞게 고치면 사라짐', function () {
  var s = JSON.parse(JSON.stringify(s0));
  var sci = function (x) { return /과학/.test(x.subject) && x.grade >= 3; };
  // 게시판(2학기 표)을 두 학기에 넣었으니 1학기는 규칙과 다름
  assert.ok(S.checks(s).some(function (c) { return /과학/.test(c.msg) && c.level === 'warn'; }));
  s.teachers.forEach(function (t) { t.items.filter(sci).forEach(function (x) { x.h1 = T.SCIENCE_RULE[1][x.grade]; x.h2 = T.SCIENCE_RULE[2][x.grade]; }); });
  assert.ok(!S.checks(s).some(function (c) { return /교차/.test(c.msg); }));
});
check('한 줄의 학급 수가 그 학년 학급 수보다 많으면 오류(나눠 맡기는 괜찮음), 학급 수 0인 학년 배정도 오류', function () {
  var s = JSON.parse(JSON.stringify(s0));
  s.classes[3] = 2;
  assert.ok(S.checks(s).some(function (c) { return c.level === 'bad' && /^전담B 3학년 체육: 3학급 배정/.test(c.msg); }));
  // 두 사람이 시간을 나눠 같은 학급을 맡는 것(6학년 영어 전담A+전담F)은 오류가 아님
  assert.ok(!S.checks(s0).some(function (c) { return c.level === 'bad'; }));
  s.classes[5] = 0;
  assert.ok(S.checks(s).some(function (c) { return c.level === 'bad' && /5학년 실과: 이 학년 학급 수가 0/.test(c.msg); }));
});
check('학년별 학급당 평균 전담 시간(스포츠강사는 빼고 셈)', function () {
  var g = S.grades(s0), w = T.weekly(tt, 2), spec = {};
  tt.teachers.forEach(function (t) { spec[t.id] = t.kind === 'specialist'; });
  [1, 2, 3, 4, 5, 6].forEach(function (gr) {
    var sum = 0; Object.keys(w).forEach(function (id) { if (!spec[id]) return; Object.keys(w[id]).forEach(function (c) { if (+c[0] === gr) sum += w[id][c]; }); });
    assert.strictEqual(g[gr - 1].avg2, sum / s0.classes[gr], gr + '학년');
  });
});

console.log('담임·전담 탭에 반영');
check('같은 교사는 설명을 고치고, 새 교사는 더하고, 계획에 없는 교사는 그대로 둠', function () {
  var s = JSON.parse(JSON.stringify(s0));
  byName(s, '전담B').items = byName(s, '전담B').items.filter(function (x) { return x.subject !== '도덕'; });
  var nt = S.newTeacher(s); nt.id = nt.name = '전담G'; nt.items.push({ grade: 6, subject: '도덕', n: 3, h1: 2, h2: 2 }); s.teachers.push(nt);
  s.teachers = s.teachers.filter(function (t) { return t.name !== '강사E'; });
  s.classes[1] = 4;
  var r = S.applyToTimetable(tt, s);
  assert.deepStrictEqual(r.added, ['전담G']);
  assert.deepStrictEqual(r.updated.indexOf('전담B') >= 0, true);
  assert.deepStrictEqual(r.kept, ['강사E']);
  assert.deepStrictEqual(r.classDiff, ['1학년 계획 4학급 · 시간표 3학급']);
  var b = r.tt.teachers.filter(function (t) { return t.id === '전담B'; })[0];
  assert.strictEqual(b.desc, '3,4체육 + 5실과');
  assert.deepStrictEqual(r.tt.sem, tt.sem, '칸 배정은 건드리지 않음');
  assert.ok(T.sanitize(r.tt).teachers.some(function (t) { return t.id === '전담G'; }));
});
check('계획 대 시간표 칸 배치 비교', function () {
  var v = S.versus(s0, tt);
  assert.deepStrictEqual(v['전담B'][2].plan, v['전담B'][2].actual);
});

console.log('저장');
check('state.ext.staff 는 엔진 sanitize 를 거쳐도 같고, 틀린 값은 고쳐짐', function () {
  var st = E.draft(2027, H, { mode: 'feb' }).state;
  var s = JSON.parse(JSON.stringify(s0)); s.published = true; byName(s, '전담B').min = 20; byName(s, '전담B').max = '';
  var st2 = E.sanitize(JSON.parse(JSON.stringify(S.put(st, s))));
  var back = S.of(st2);
  assert.strictEqual(back.published, true);
  assert.strictEqual(byName(back, '전담B').min, 20);
  assert.strictEqual(byName(back, '전담B').max, null);
  assert.deepStrictEqual(back.teachers.map(function (t) { return t.items; }), s.teachers.map(function (t) { return t.items; }));
  var bad = S.sanitize({ classes: { 1: -3, 2: 'x' }, teachers: [{ name: 'A', items: [{ grade: 9 }, { grade: 2, n: 99, h1: -1, h2: 4.6 }] }, { name: 'A' }, 5] });
  assert.strictEqual(bad.classes[1], 0); assert.strictEqual(bad.teachers.length, 1);
  assert.deepStrictEqual(bad.teachers[0].items, [{ grade: 2, subject: '', n: 20, h1: 0, h2: 5 }]);
  // 공식 계산은 바뀌지 않음
  assert.deepStrictEqual(E.build(st2, H).totals, E.build(st, H).totals);
});

console.log(failed ? '\n실패 ' + failed + '건' : '\n모두 통과');
process.exit(failed ? 1 : 0);
