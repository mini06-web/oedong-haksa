/* gas/Code.gs 저장 흐름 테스트 (가짜 시트에서): node tests/gas.test.js */
'use strict';
var path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
var createGas = require('./mock-gas').createGas;
var root = path.join(__dirname, '..');
var ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'holidays.js'), 'utf8'), ctx);
var H = ctx.window.HOLIDAY_DATA, E = require(path.join(root, 'engine.js'));

var failed = 0;
function check(name, fn) { try { fn(); console.log('  통과  ' + name); } catch (e) { failed++; console.log('  실패  ' + name + '\n        ' + (e.stack || e.message)); } }

var gas = createGas(), PW = 'test-pw';
var st = E.draft(2027, H, { mode: 'feb' }).state;
st.school.name = '김해외동초등학교';

console.log('Code.gs 저장 흐름');
check('처음에는 학년도 목록이 비어 있음', function () {
  assert.deepStrictEqual(gas.get({ action: 'list' }), { ok: true, years: [] });
  assert.strictEqual(gas.get({ action: 'get', year: '2027' }).data, null);
});
check('setup: 학사일정·시간표·저장기록·안내 탭을 만들고 빈 시트1은 지움', function () {
  gas.setup();
  assert.deepStrictEqual(gas.sheets.map(function (s) { return s.name; }).sort(), ['시간표', '안내', '저장기록', '학사일정']);
});
check('비밀번호가 틀리면 확인·저장 모두 거부', function () {
  assert.deepStrictEqual(gas.post({ action: 'check', pw: 'nope' }), { ok: false, error: 'auth' });
  var r = gas.post({ action: 'save', pw: 'nope', year: 2027, state: st, base: 0 });
  assert.strictEqual(r.error, 'auth');
  assert.strictEqual(gas.get({ action: 'get', year: 2027 }).data, null);
});
check('비밀번호가 맞으면 확인 통과', function () { assert.deepStrictEqual(gas.post({ action: 'check', pw: PW }), { ok: true }); });

var first;
check('처음 저장(학교) → 다시 읽으면 같은 자료, 계산 결과도 회귀 기준과 같음', function () {
  first = gas.post({ action: 'save', pw: PW, year: 2027, state: st, base: 0, device: '학교' });
  assert.ok(first.ok && first.savedAt > 0);
  var d = gas.get({ action: 'get', year: 2027 }).data;
  assert.deepStrictEqual(d.state, JSON.parse(JSON.stringify(st)));
  assert.strictEqual(d.savedBy, '학교');
  var r = E.build(E.sanitize(d.state), H);
  assert.deepStrictEqual(r.totals.days, { total: 190, sem1: 98, sem2: 92 });
  assert.deepStrictEqual(E.GRADES.map(function (g) { return r.totals.hours[g].total; }), [869, 871, 980, 980, 1090, 1088]);
});
var second;
check('같은 기기가 이어서 저장(base = 앞 savedAt) → 성공, savedAt 증가', function () {
  st.closures = [{ date: '2027-05-04', name: '자율휴업일', reason: '징검다리' }];
  second = gas.post({ action: 'save', pw: PW, year: 2027, state: st, base: first.savedAt, device: '학교' });
  assert.ok(second.ok && second.savedAt > first.savedAt);
});
check('집에서 예전 base로 저장 → 충돌, 시트 내용은 그대로, 최신본을 돌려줌', function () {
  var home = JSON.parse(JSON.stringify(st)); home.closures = [];
  var r = gas.post({ action: 'save', pw: PW, year: 2027, state: home, base: first.savedAt, device: '집' });
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(r.remote.savedAt, second.savedAt);
  assert.strictEqual(r.remote.savedBy, '학교');
  assert.strictEqual(gas.get({ action: 'get', year: 2027 }).data.state.closures.length, 1);
});
check('집에서 "내 것으로 덮어쓰기"(force) → 성공', function () {
  var home = JSON.parse(JSON.stringify(st)); home.closures = [];
  var r = gas.post({ action: 'save', pw: PW, year: 2027, state: home, base: first.savedAt, force: true, device: '집' });
  assert.ok(r.ok && r.savedAt > second.savedAt);
  var d = gas.get({ action: 'get', year: 2027 }).data;
  assert.strictEqual(d.state.closures.length, 0); assert.strictEqual(d.savedBy, '집');
});
check('큰 자료는 여러 칸에 나눠 담고, 다시 작아지면 남은 조각을 지움', function () {
  var big = JSON.parse(JSON.stringify(st));
  big.events = big.events.concat(Array.apply(null, Array(400)).map(function (_, i) { return { date: '2027-04-0' + (i % 9 + 1), type: 'adjust', name: '긴 이름 '.repeat(5) + i, reason: '사유'.repeat(40), periods: { 1: 3 } }; }));
  var cur = gas.get({ action: 'get', year: 2027 }).data.savedAt;
  var r = gas.post({ action: 'save', pw: PW, year: 2027, state: big, base: cur, device: '학교' });
  assert.ok(r.ok, JSON.stringify(r));
  var row = gas.ss.getSheetByName('학사일정').grid[1];
  assert.ok(row[4] >= 2, '조각 수 ' + row[4]);
  assert.deepStrictEqual(gas.get({ action: 'get', year: 2027 }).data.state.events.length, big.events.length);
  var r2 = gas.post({ action: 'save', pw: PW, year: 2027, state: st, base: r.savedAt, device: '학교' });
  assert.ok(r2.ok);
  row = gas.ss.getSheetByName('학사일정').grid[1];
  assert.strictEqual(row[4], 1); assert.strictEqual(row[6], '');
  assert.deepStrictEqual(gas.get({ action: 'get', year: 2027 }).data.state, JSON.parse(JSON.stringify(st)));
});
check('여러 학년도: 목록은 학년도 순', function () {
  var s28 = E.draft(2028, H, { mode: 'feb' }).state, s26 = E.draft(2026, H, { mode: 'feb' }).state;
  assert.ok(gas.post({ action: 'save', pw: PW, year: 2028, state: s28, base: 0 }).ok);
  assert.ok(gas.post({ action: 'save', pw: PW, year: 2026, state: s26, base: 0 }).ok);
  assert.deepStrictEqual(gas.get({ action: 'list' }).years.map(function (y) { return y.year; }), [2026, 2027, 2028]);
  assert.strictEqual(gas.get({ action: 'get', year: 2027 }).data.state.year, 2027);
});
check('학년도와 자료가 맞지 않거나 형식이 틀리면 거부', function () {
  assert.strictEqual(gas.post({ action: 'save', pw: PW, year: 2029, state: st, base: 0 }).ok, false);
  assert.strictEqual(gas.post({ action: 'save', pw: PW, year: 2027, state: 'x', base: 0 }).ok, false);
  assert.strictEqual(gas.post('not json').ok, false);
});
check('저장기록 탭에 저장·충돌·실패가 남음', function () {
  var log = gas.ss.getSheetByName('저장기록').grid.slice(1).map(function (r) { return r[3]; });
  ['저장', '충돌(저장 안 함)', '덮어쓰기 저장', '저장 거부(비밀번호)', '비밀번호 확인 실패'].forEach(function (k) { assert.ok(log.indexOf(k) >= 0, k + ' 없음'); });
});
check('setup: 시간표 탭도 만듦', function () {
  assert.ok(gas.ss.getSheetByName('시간표'));
});
check('시간표 읽기·저장은 비밀번호가 있어야 함', function () {
  assert.strictEqual(gas.post({ action: 'ttGet', pw: 'x', year: 2027 }).error, 'auth');
  assert.strictEqual(gas.post({ action: 'ttGet', pw: PW, year: 2027 }).data, null);
});
var tt = { version: 1, classes: [{ cls: '3-1', grade: 3, teacher: '담임07' }], teachers: [], sem: { 1: {}, 2: {} } }, tt1;
check('시간표 저장 → 읽기, 학사일정 줄과 섞이지 않음', function () {
  tt1 = gas.post({ action: 'ttSave', pw: PW, year: 2027, data: tt, base: 0, device: '집' });
  assert.ok(tt1.ok, JSON.stringify(tt1));
  var d = gas.post({ action: 'ttGet', pw: PW, year: 2027 }).data;
  assert.deepStrictEqual(d.data, tt); assert.strictEqual(d.savedBy, '집');
  assert.strictEqual(gas.get({ action: 'get', year: 2027 }).data.state.year, 2027);
  assert.deepStrictEqual(gas.get({ action: 'list' }).years.map(function (y) { return y.year; }), [2026, 2027, 2028]);
});
check('시간표도 예전 base 로 저장하면 충돌', function () {
  var r = gas.post({ action: 'ttSave', pw: PW, year: 2027, data: tt, base: tt1.savedAt - 1, device: '학교' });
  assert.strictEqual(r.conflict, true); assert.deepStrictEqual(r.remote.data, tt);
  assert.strictEqual(gas.post({ action: 'ttSave', pw: PW, year: 2027, data: { nope: 1 }, base: tt1.savedAt }).ok, false);
});
check('게시판 읽기: 권한이 없으면 안내 문장', function () {
  assert.ok(/보기 권한/.test(gas.post({ action: 'board', pw: PW }).error));
});
check('게시판 읽기: 기초시간표 탭 값을 문자열로 돌려줌(비밀번호 필요)', function () {
  var g = createGas({ board: require('./board-sample') });
  assert.strictEqual(g.post({ action: 'board', pw: 'x' }).error, 'auth');
  var b = g.post({ action: 'board', pw: PW });
  assert.ok(b.ok, JSON.stringify(b).slice(0, 200));
  assert.strictEqual(b.sheet, '기초시간표, 전담시간표, 특별실');
  assert.strictEqual(b.values[3][0], '1-1');
  var T = require('../timetable.js');
  assert.strictEqual(T.parseBoard(b.values).classes.length, 18);
});
check('비밀번호를 20번 틀리면 맞는 비밀번호도 잠시 막음', function () {
  var g2 = createGas();
  for (var i = 0; i < 20; i++) g2.post({ action: 'check', pw: 'x' });
  assert.strictEqual(g2.post({ action: 'check', pw: PW }).error, 'auth');
});
check('EDIT_PASSWORD 미설정이면 오류 메시지', function () {
  var g3 = createGas({ password: '' });
  assert.ok(/EDIT_PASSWORD/.test(g3.post({ action: 'check', pw: 'a' }).error));
});

console.log(failed ? '\n실패 ' + failed + '건' : '\n모두 통과');
process.exit(failed ? 1 : 0);
