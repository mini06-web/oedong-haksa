/* 회귀 테스트: 원본 엔진과 같은 결과가 나오는지 확인한다.
 * 실행: node tests/regress.js
 * 기준: 2027학년도, 2월 종업 초안, 기본 설정 (원본 nextyear.vercel.app 엔진으로 얻은 값)
 */
'use strict';
var path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
var root = path.join(__dirname, '..');

var ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'holidays.js'), 'utf8'), ctx);
var H = ctx.window.HOLIDAY_DATA;
var E = require(path.join(root, 'engine.js'));

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('  통과  ' + name); }
  catch (e) { failed++; console.log('  실패  ' + name + '\n        ' + e.message); }
}

var draft = E.draft(2027, H, { mode: 'feb' });
var r = draft.result, d = r.state.dates, t = r.totals;

console.log('2027학년도 2월 종업 초안');
check('학년도 날짜', function () {
  assert.deepStrictEqual(d, {
    start: '2027-03-02', summerStart: '2027-07-21', summerEnd: '2027-08-19',
    winterStart: '2027-12-24', winterEnd: '2028-02-04', end: '2028-02-10'
  });
});
check('수업일수 190일 (1학기 98, 2학기 92)', function () {
  assert.deepStrictEqual(t.days, { total: 190, sem1: 98, sem2: 92 });
});
check('방학일수 88일 (28 / 60)', function () {
  assert.deepStrictEqual(t.vacationDays, { total: 88, sem1: 28, sem2: 60 });
});
check('학년별 시수 869 · 871 · 980 · 980 · 1,090 · 1,088', function () {
  assert.deepStrictEqual(E.GRADES.map(function (g) { return t.hours[g].total; }), [869, 871, 980, 980, 1090, 1088]);
});

// 저장·불러오기를 거쳐도 결과가 같아야 한다(시트에 JSON으로 넣었다 꺼내는 과정)
check('JSON 저장 → sanitize → 다시 계산해도 같은 결과', function () {
  var back = E.sanitize(JSON.parse(JSON.stringify(draft.state)));
  var r2 = E.build(back, H);
  assert.deepStrictEqual(r2.totals.days, t.days);
  assert.deepStrictEqual(E.GRADES.map(function (g) { return r2.totals.hours[g].total; }), [869, 871, 980, 980, 1090, 1088]);
});

// 폴더에 있던 2027학년도 파일(원본 앱으로 저장)도 같은 결과
var saved = path.join(root, '..', '2027학년도_학사일정.json');
if (fs.existsSync(saved)) {
  check('원본 앱이 저장한 2027학년도 파일도 같은 결과', function () {
    var st = E.sanitize(JSON.parse(fs.readFileSync(saved, 'utf8')).state);
    var r3 = E.build(st, H);
    assert.deepStrictEqual(r3.totals.days, { total: 190, sem1: 98, sem2: 92 });
    assert.deepStrictEqual(E.GRADES.map(function (g) { return r3.totals.hours[g].total; }), [869, 871, 980, 980, 1090, 1088]);
  });
}

console.log(failed ? '\n실패 ' + failed + '건' : '\n모두 통과');
process.exit(failed ? 1 : 0);
