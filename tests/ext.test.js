/* 3단계 계산(ext.js) 테스트: node tests/ext.test.js  (교사 이름은 가명 자료) */
'use strict';
var path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
var root = path.join(__dirname, '..');
var ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'holidays.js'), 'utf8'), ctx);
var H = ctx.window.HOLIDAY_DATA, E = require(path.join(root, 'engine.js')), X = require(path.join(root, 'ext.js'));
var T = require(path.join(root, 'timetable.js'));

var failed = 0;
function check(name, fn) { try { fn(); console.log('  통과  ' + name); } catch (e) { failed++; console.log('  실패  ' + name + '\n        ' + (e.stack || e.message)); } }

var st = E.draft(2027, H, { mode: 'feb' }).state;
var base = E.build(st, H);

console.log('입학초기');
var ad = { from: '2027-03-02', to: '2027-03-12', periods: [4, 4, 4, 4, 4] };
var a1 = X.applyAdapt(st, H, ad);
check('수업일에만 1학년 교시를 넣고, 다른 행사가 있는 날(시업식)은 건너뜀', function () {
  assert.strictEqual(a1.days.length, 8);
  assert.deepStrictEqual(a1.skipped, [{ date: '2027-03-02', name: '시업식·입학식' }]);
  var e = a1.state.events.filter(function (x) { return x.date === '2027-03-03'; })[0];
  assert.deepStrictEqual(e.periods, { 1: 4 });
});
check('1학년 시수만 줄고 다른 학년·수업일수는 그대로', function () {
  var r = E.build(a1.state, H);
  // 3.3~3.12 기준 1학년 [4,5,4,5,5] → 4: 수·목·금, 월·화·수·목·금 중 5교시였던 날 수만큼 감소
  assert.strictEqual(base.totals.hours[1].total - r.totals.hours[1].total, 5);
  assert.strictEqual(r.totals.hours[2].total, base.totals.hours[2].total);
  assert.strictEqual(r.totals.days.total, base.totals.days.total);
});
check('기간을 바꿔 다시 만들면 자동으로 만든 날만 바뀜(손으로 넣은 입학초기 날은 유지)', function () {
  var s = JSON.parse(JSON.stringify(a1.state));
  s.events.push({ date: '2027-03-22', type: 'adapt', name: '입학초기 적응', reason: '', periods: { 1: 3 } });
  var a2 = X.applyAdapt(s, H, { from: '2027-03-08', to: '2027-03-09', periods: [3, 3, 3, 3, 3] });
  var auto = a2.state.events.filter(X.isAutoAdapt).map(function (e) { return e.date; });
  assert.deepStrictEqual(auto, ['2027-03-08', '2027-03-09']);
  assert.ok(a2.state.events.some(function (e) { return e.date === '2027-03-22'; }));
  var off = X.applyAdapt(a2.state, H, null);
  assert.strictEqual(off.state.events.filter(X.isAutoAdapt).length, 0);
  assert.strictEqual(off.state.ext.adapt, undefined);
});
check('ext 는 sanitize 를 거쳐도 남음', function () {
  var s = E.sanitize(JSON.parse(JSON.stringify(a1.state)));
  assert.deepStrictEqual(s.ext.adapt, a1.state.ext.adapt);
  assert.strictEqual(s.events.filter(X.isAutoAdapt).length, 8);
});

console.log('행사 템플릿');
check('작년 날짜 → 같은 월·주차·요일 규칙', function () {
  var r = X.ruleFromDate('2026-05-08'); // 금요일, 둘째 주
  assert.deepStrictEqual(r, { kind: 'nth', month: 5, nth: 2, dow: 5 });
  assert.strictEqual(X.dateFromRule(r, 2027), '2027-05-14');
  assert.strictEqual(X.ruleText(r), '5월 2번째 금요일');
});
check('5번째 요일이 없으면 그 달 마지막', function () {
  assert.strictEqual(X.dateFromRule({ kind: 'nth', month: 3, nth: 5, dow: 1 }, 2027), '2027-03-29');
});
check('고정 날짜, 1·2월은 다음 해', function () {
  assert.strictEqual(X.dateFromRule({ kind: 'fixed', month: 2, day: 5 }, 2027), '2028-02-05');
  assert.strictEqual(X.dateFromRule({ kind: 'fixed', month: 2, day: 29 }, 2026), null);
});
var prev = E.draft(2026, H, { mode: 'feb' }).state;
prev.events.push({ date: '2026-05-08', type: 'ceremony', name: '운동회', reason: '', periods: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 } });
prev.events.push({ date: '2026-10-16', type: 'adjust', name: '현장체험학습', reason: '', periods: { 5: 6 } });
check('작년 행사 가져오기: 학사 기본 행사(방학식 등)·입학초기 자동분은 빼고 가져옴', function () {
  var p = X.applyAdapt(prev, H, { from: '2026-03-03', to: '2026-03-06', periods: [4, 4, 4, 4, 4] }).state;
  var t = X.templatesFromState(p, p.dates);
  assert.deepStrictEqual(t.map(function (x) { return x.name; }), ['운동회', '현장체험학습']);
});
check('미리보기: 날짜·상태, 적용하면 행사가 들어가고 다시 보면 "이미 들어 있음"', function () {
  var t = X.mergeTemplates([], X.templatesFromState(prev, prev.dates));
  t.push({ name: '토요 행사', type: 'ceremony', periods: {}, reason: '', rule: { kind: 'fixed', month: 5, day: 15 } });
  var rows = X.previewTemplates(st, H, t);
  var byName = {}; rows.forEach(function (x) { byName[x.tpl.name] = x; });
  assert.strictEqual(byName['운동회'].date, '2027-05-14');
  assert.strictEqual(byName['운동회'].status, 'ok');
  assert.strictEqual(byName['토요 행사'].status, 'notschool');
  var s2 = X.applyTemplates(st, rows);
  assert.ok(s2.events.some(function (e) { return e.date === '2027-05-14' && e.name === '운동회' && e.periods[1] === 4; }));
  assert.ok(!s2.events.some(function (e) { return e.name === '토요 행사'; }));
  assert.strictEqual(X.previewTemplates(s2, H, t).filter(function (x) { return x.tpl.name === '운동회'; })[0].status, 'same');
});
check('같은 이름은 덮어쓰고 월 순서(3월부터)로 정렬', function () {
  var t = X.mergeTemplates([{ name: '졸업식', type: 'ceremony', periods: {}, rule: { kind: 'fixed', month: 2, day: 10 } }, { name: 'A', type: 'ceremony', periods: {}, rule: { kind: 'fixed', month: 4, day: 1 } }],
    [{ name: 'A', type: 'ceremony', periods: {}, rule: { kind: 'fixed', month: 3, day: 9 } }]);
  assert.deepStrictEqual(t.map(function (x) { return x.name + x.rule.month; }), ['A3', '졸업식2']);
});
check('템플릿 검사: 틀린 규칙은 버림', function () {
  var t = X.sanitizeTemplates([{ name: '좋음', rule: { kind: 'nth', month: 5, nth: 2, dow: 5 }, periods: { 1: '4', 9: 3 } }, { name: '', rule: {} }, { name: '나쁨', rule: { kind: 'nth', month: 5, nth: 2, dow: 6 } }]);
  assert.deepStrictEqual(t, [{ name: '좋음', type: 'ceremony', periods: { 1: 4 }, reason: '', rule: { kind: 'nth', month: 5, nth: 2, dow: 5 } }]);
});

console.log('내부 비교');
check('담임 부담 = 담임 − 스포츠×0.5, 학년 평균·주당', function () {
  var tt = T.fromBoard(T.parseBoard(require('./board-sample.js')), null, 'both');
  var out = T.compute(base, tt);
  var c = X.compare(base, tt, out, 'total');
  var one = c.classes.filter(function (x) { return x.sports > 0; })[0], o = out.classes[one.cls];
  assert.strictEqual(one.load, o.homeroom.total - o.sports.total * 0.5);
  assert.ok(c.weeks > 30 && c.weeks < 45);
  var g = c.grades[0], cs = c.classes.filter(function (x) { return x.grade === g.grade; });
  assert.strictEqual(g.avg, cs.reduce(function (a, b) { return a + b.load; }, 0) / cs.length);
  var s1 = X.compare(base, tt, out, 'sem1');
  assert.ok(s1.weeks < c.weeks);
});

console.log('홈페이지용 HTML');
check('월별 행사·공휴일·방학, 이어진 공휴일은 한 줄, 인라인 스타일만', function () {
  var r = E.build(a1.state, H), m = X.monthlyItems(r);
  assert.strictEqual(m[0].ym, '2027-03');
  var sep = m.filter(function (x) { return x.ym === '2027-09'; })[0].items.filter(function (i) { return i.text === '추석'; });
  assert.deepStrictEqual(sep.map(function (i) { return i.from + '~' + i.to; }), ['2027-09-14~2027-09-16']);
  assert.ok(m.some(function (x) { return x.items.some(function (i) { return i.kind === 'vacation' && i.text === '여름방학'; }); }));
  assert.ok(!m.some(function (x) { return x.items.some(function (i) { return i.text === '입학초기 적응'; }); }), '입학초기 날마다 쓰지 않음');
  var html = X.homepageHtml(r, '김해외동초등학교');
  assert.ok(/2027학년도 학사일정/.test(html));
  assert.ok(!/<style|class=|<script/i.test(html));
});

console.log(failed ? '\n실패 ' + failed + '건' : '\n모두 통과');
process.exit(failed ? 1 : 0);
