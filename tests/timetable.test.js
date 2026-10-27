/* 시간표 모듈 테스트: node tests/timetable.test.js */
'use strict';
var path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
var root = path.join(__dirname, '..');
var ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'holidays.js'), 'utf8'), ctx);
var H = ctx.window.HOLIDAY_DATA, E = require(path.join(root, 'engine.js')), T = require(path.join(root, 'timetable.js'));
var board = require('./board-sample');

var failed = 0;
function check(name, fn) { try { fn(); console.log('  통과  ' + name); } catch (e) { failed++; console.log('  실패  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } }
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

var parsed = T.parseBoard(board);
console.log('게시판 읽기');
check('학급 18개(5학년 2반, 6학년 4반), 전담 6명(스포츠강사는 sports)', function () {
  assert.strictEqual(parsed.classes.length, 18);
  assert.deepStrictEqual(parsed.teachers.map(function (t) { return t.name + ':' + t.kind; }),
    ['전담A:specialist', '전담B:specialist', '전담C:specialist', '전담D:specialist', '강사E:sports', '전담F:specialist']);
  assert.strictEqual(parsed.teachers[2].desc, '3,4 과학');
});
check('점심 칸을 빼고 교시를 센다(학년마다 점심 위치가 다름)', function () {
  assert.deepStrictEqual(parsed.subjects['1-1'][0], ['국어', '통합', '통합', '수학']);
  assert.deepStrictEqual(parsed.subjects['1-2'][0], ['국어', '수학', '통합', '통합']);
  assert.deepStrictEqual(parsed.subjects['3-1'][0], ['국어', '수학', '사회', '체육', '도덕']);
  assert.deepStrictEqual(parsed.subjects['3-1'][3], ['국어', '수학', '체육', '사회', '음악']);
  assert.deepStrictEqual(parsed.subjects['5-1'][4], ['미술', '과학', '미술', '사회', '영어', '음악']);
});
check('학년별 요일 교시: 1·2학년 4,5,5,5,4 / 3·4학년 5,5,5,5,6 / 5·6학년 6,6,5,6,6', function () {
  var gp = T.gradePeriods(T.fromBoard(parsed, null, 'both'), 1);
  assert.deepStrictEqual(gp.periods, { 1: [4, 5, 5, 5, 4], 2: [4, 5, 5, 5, 4], 3: [5, 5, 5, 5, 6], 4: [5, 5, 5, 5, 6], 5: [6, 6, 5, 6, 6], 6: [6, 6, 5, 6, 6] });
  assert.deepStrictEqual(gp.mismatch, []);
});
check('전담 배정: 3-1 화 3·4교시 과학 = 전담C, 1-1 화 2교시 = 전담A, 5-1 월 1교시 = 강사E', function () {
  assert.strictEqual(parsed.assign['3-1'][1][2], '전담C'); assert.strictEqual(parsed.assign['3-1'][1][3], '전담C');
  assert.strictEqual(parsed.subjects['3-1'][1][2], '과학');
  assert.strictEqual(parsed.assign['1-1'][1][1], '전담A');
  assert.strictEqual(parsed.assign['5-1'][0][0], '강사E');
  assert.strictEqual(parsed.assign['3-1'][0][0], '');
});
check('경고: 전담이 배정된 칸은 모두 기초시간표에 수업이 있음', function () {
  assert.deepStrictEqual(parsed.warnings, []);
});

var tt = T.fromBoard(parsed, null, 'both', '2026-10-27T00:00:00Z');
console.log('주간 점검');
check('과학 전담 교차 편성: 지금 표는 2학기 규칙과 맞고, 1학기 규칙과는 다름', function () {
  var sc = T.scienceCheck(tt);
  assert.ok(sc.filter(function (x) { return x.sem === 2; }).every(function (x) { return x.ok; }), JSON.stringify(sc.filter(function (x) { return x.sem === 2 && !x.ok; })));
  var s1 = sc.filter(function (x) { return x.sem === 1; });
  assert.strictEqual(s1.length, 12); // 3~6학년 12개 반
  assert.ok(s1.every(function (x) { return !x.ok; }));
  assert.deepStrictEqual(s1.filter(function (x) { return x.cls === '3-1'; })[0], { sem: 1, cls: '3-1', grade: 3, teacher: '전담C', hours: 2, expected: 3, ok: false });
});
check('같은 교사가 같은 시간 두 반에 배정된 곳 없음', function () {
  assert.deepStrictEqual(T.conflicts(tt, 2), []);
});

console.log('학급별 담임·전담 시수 (2027학년도 2월 종업 초안)');
var st = E.draft(2027, H, { mode: 'feb' }).state;
var r = E.build(st, H), out = T.compute(r, tt);
check('모든 학급: 담임 + 전담 = 학년 공식 시수(엔진 결과와 같음)', function () {
  tt.classes.forEach(function (c) {
    var o = out.classes[c.cls], g = r.totals.hours[c.grade];
    assert.strictEqual(o.total.total, g.total, c.cls);
    assert.strictEqual(o.homeroom.total + o.specialistSum.total, g.total, c.cls);
    assert.strictEqual(o.homeroom.sem1 + o.specialistSum.sem1, g.sem1, c.cls);
  });
});
check('공식 시수는 회귀 기준 그대로(시간표 계산이 엔진 결과를 바꾸지 않음)', function () {
  assert.deepStrictEqual(E.GRADES.map(function (g) { return r.totals.hours[g].total; }), [869, 871, 980, 980, 1090, 1088]);
});
check('스포츠강사 수업은 담임 시수에 포함되고 따로도 셈', function () {
  var o = out.classes['5-1'];
  assert.ok(o.sports.total > 0);
  assert.ok(!o.specialist['강사E']);
  assert.strictEqual(out.teachers['강사E'].hours.total, sum(Object.keys(out.classes).map(function (k) { return out.classes[k].sports.total; })));
});
check('전담 교사 시수 = 학급별 전담 시수 합', function () {
  tt.teachers.filter(function (t) { return t.kind === 'specialist'; }).forEach(function (t) {
    var s = sum(Object.keys(out.classes).map(function (k) { return (out.classes[k].specialist[t.id] || { total: 0 }).total; }));
    assert.strictEqual(out.teachers[t.id].hours.total, s, t.id);
  });
});
check('공휴일로 빠진 전담 수업: 2027.5.5(수, 어린이날) 1-3 2·3교시 전담A', function () {
  var d = out.dropped.filter(function (x) { return x.date === '2027-05-05' && x.cls === '1-3'; });
  assert.deepStrictEqual(d.map(function (x) { return x.period + ':' + x.teacher + ':' + x.why; }), ['2:전담A:holiday', '3:전담A:holiday']);
});
check('방학 중 공휴일(광복절 대체 등)은 빠진 수업으로 세지 않음', function () {
  assert.ok(!out.dropped.some(function (x) { return x.date > st.dates.summerStart && x.date < st.dates.summerEnd; }));
});
check('행사로 단축된 날(시업일 3.2 화): 뒤쪽 교시의 전담 수업이 빠짐', function () {
  // 3.2(화)는 전 학년 4교시(1학년 2교시). 화요일 5교시 이후 전담이 있으면 short 로 기록돼야 한다
  var shortOn = out.dropped.filter(function (x) { return x.date === '2027-03-02'; });
  assert.ok(shortOn.every(function (x) { return x.why === 'short'; }));
  // 1-1 화 2교시(전담A)는 1학년 2교시 행사라 그대로 진행 → 빠지지 않음
  assert.ok(!shortOn.some(function (x) { return x.cls === '1-1' && x.period === 2; }));
  // 1-2 화 4교시(전담A)는 1학년이 2교시만 하므로 빠짐
  assert.ok(shortOn.some(function (x) { return x.cls === '1-2' && x.period === 4 && x.teacher === '전담A'; }));
});
check('기준 교시와 시간표가 다른 요일을 알려 줌(지금 설정은 원작 기본값)', function () {
  assert.ok(out.mismatch.some(function (m) { return m.grade === 1 && m.dow === 2 && m.base === 4 && m.timetable === 5; }));
});
check('시간표 요일 교시를 기준 시수에 반영하면 mismatch 가 없어지고 담임+전담=공식 시수 유지', function () {
  var s2 = JSON.parse(JSON.stringify(st)), gp = T.gradePeriods(tt, 1).periods;
  Object.keys(gp).forEach(function (g) { s2.basePeriods[g] = gp[g]; });
  var r2 = E.build(s2, H), o2 = T.compute(r2, tt);
  assert.deepStrictEqual(o2.mismatch, []);
  tt.classes.forEach(function (c) { assert.strictEqual(o2.classes[c.cls].homeroom.total + o2.classes[c.cls].specialistSum.total, r2.totals.hours[c.grade].total); });
  assert.ok(o2.classes['3-1'].extra.total === 0);
});
check('sanitize: 저장했다 불러와도 같은 계산, 모르는 교사 배정은 버림', function () {
  var back = T.sanitize(JSON.parse(JSON.stringify(tt)));
  assert.deepStrictEqual(back.sem, JSON.parse(JSON.stringify(tt.sem)));
  var bad = JSON.parse(JSON.stringify(tt)); bad.sem[1].assign['3-1'][0][0] = '없는사람';
  assert.strictEqual(T.sanitize(bad).sem[1].assign['3-1'][0][0], '');
  assert.strictEqual(T.sanitize(null), null);
});
check('한 학기만 다시 가져오면 다른 학기 수정은 유지', function () {
  var edited = JSON.parse(JSON.stringify(tt)); edited.sem[1].assign['3-1'][2][1] = '전담C';
  var again = T.fromBoard(parsed, edited, 2);
  assert.strictEqual(again.sem[1].assign['3-1'][2][1], '전담C');
  assert.strictEqual(again.sem[2].assign['3-1'][2][1], ''); // 2학기는 게시판 그대로(3-1 수 2교시 과학은 담임)
});

console.log(failed ? '\n실패 ' + failed + '건' : '\n모두 통과');
process.exit(failed ? 1 : 0);
