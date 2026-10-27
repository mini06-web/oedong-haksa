/* 엑셀 내보내기: 원본 학사일정 양식(달력 / 전학년 수업시수(일별) / (주별))을 같은 구조와 색으로 새로 만든다.
 * 합계는 엑셀 수식으로 넣어 엑셀에서 고쳐도 합계가 맞도록 한다(계산값도 함께 넣어 바로 보이게).
 * ExcelJS(브라우저용)를 사용한다.
 */
(function () {
  'use strict';
  var GR = [1, 2, 3, 4, 5, 6];
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var FONT = '맑은 고딕';
  // 원본 범례 색
  var C = {
    title: 'FF002060', head: 'FFD9E1F2', peach: 'FFFEE8D2', note: 'FFE2EFDA', sumFill: 'FFE2EFDA', gray: 'FFF2F2F2', grid: 'FFBFBFBF',
    cer: 'FFFFFF00', hol: 'FFFFCCFF', clo: 'FFFFF2CC', adapt: 'FF00FFFF', adj: 'FFA9D08E', sun: 'FF8EA9DB', vac: 'FFF2F2F2',
    red: 'FFFF0000', blue: 'FF0070C0', purple: 'FF7030A0', grayText: 'FFA6A6A6'
  };

  function colL(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function md(date) { return (+date.slice(5, 7)) + '.' + (+date.slice(8, 10)) + '.'; }
  function mdw(date, w) { return md(date) + '(' + w + ')'; }
  function addDays(s, n) { var t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
  function dowOf(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay(); }

  function fill(cell, argb) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }; }
  function font(cell, o) { cell.font = Object.assign({ name: FONT, size: 10 }, o || {}); }
  function center(cell, wrap) { cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: !!wrap }; }
  function border(cell, argb) { var b = { style: 'thin', color: { argb: argb || C.grid } }; cell.border = { top: b, left: b, bottom: b, right: b }; }
  function put(ws, ref, value, o) {
    var c = ws.getCell(ref); c.value = value; o = o || {};
    font(c, o.font); center(c, o.wrap);
    if (o.align) c.alignment = Object.assign({}, c.alignment, o.align);
    if (o.fill) fill(c, o.fill);
    if (o.border !== false) border(c);
    return c;
  }
  function formula(f, result) { return { formula: f, result: result }; }

  // 화면과 같은 날짜 분류
  function category(d, state, suneungDate) {
    var holName = d.labels.filter(function (l) { return l !== '수능'; })[0];
    if (d.status === 'holiday' || (d.off && holName && d.status !== 'closure')) return 'hol';
    if (d.status === 'closure') return 'clo';
    if (d.status === 'vacation') return 'vac';
    if (d.status === 'outside') return 'out';
    if (d.status === 'weekend') return 'we';
    if (d.category === 'ceremony') return 'cer';
    if (d.category === 'adapt') return 'adapt';
    if (d.category === 'suneung') return 'sun';
    if (d.category === 'adjust') return 'adj';
    return 'sch';
  }
  function natural(state, d, g, suneungDate) {
    var p = window.Engine.basePeriodsFor(state, g, d.sem)[d.dow - 1];
    if (d.date === suneungDate && state.suneung.mode === 'minus1') p = Math.max(0, p - 1);
    return p;
  }

  // ---------- 1. 달력 ----------
  function sheetCalendar(wb, r, H) {
    var s = r.state, y = s.year, ws = wb.addWorksheet(y + ' 달력', { views: [{ showGridLines: false }] });
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } };
    var dayMap = {}; r.days.forEach(function (d) { dayMap[d.date] = d; });
    // 열: A 여백, 블록마다 7칸 + 간격 1칸, 4블록 → B..AF, 간격 AG, 오른쪽 표 AH..AO
    for (var i = 1; i <= 41; i++) ws.getColumn(i).width = 4.6;
    ws.getColumn(1).width = 2;
    [9, 17, 25, 33].forEach(function (c) { ws.getColumn(c).width = 1.6; });
    ws.getColumn(34).width = 9;
    ws.mergeCells('B1:AO1');
    put(ws, 'B1', y + '학년도 학사일정' + (s.school.name ? ' · ' + s.school.name : ''), { font: { size: 22, bold: true, color: { argb: 'FFFFFFFF' } }, fill: C.title, border: false });
    ws.getRow(1).height = 40;
    ws.mergeCells('B2:AO2');
    put(ws, 'B2', '수업일수 ' + r.totals.days.total + '일 (1학기 ' + r.totals.days.sem1 + '일 · 2학기 ' + r.totals.days.sem2 + '일, 법정 ' + s.standards.minDays + '일 이상) · 시업 ' + md(s.dates.start) + ' · 여름방학식 ' + md(s.dates.summerStart) + ' · 개학 ' + md(s.dates.summerEnd) +
      (s.dates.winterStart && s.dates.winterEnd ? ' · 겨울방학식 ' + md(s.dates.winterStart) + ' · 개학 ' + md(s.dates.winterEnd) : '') + ' · 종업 ' + md(s.dates.end), { font: { size: 11, bold: true }, border: false, align: { horizontal: 'left' } });
    ws.getRow(2).height = 22;

    // 범례
    var leg = [['공휴일', C.hol], ['자율휴업일', C.clo], ['방학', C.vac], ['행사', C.cer], ['입학초기', C.adapt], ['시수 증감', C.adj], ['수능', C.sun]];
    var lc = 2;
    leg.forEach(function (l) {
      put(ws, colL(lc) + '3', '', { fill: l[1] });
      ws.mergeCells(colL(lc + 1) + '3:' + colL(lc + 3) + '3');
      put(ws, colL(lc + 1) + '3', l[0], { font: { size: 9 }, border: false, align: { horizontal: 'left' } });
      lc += 4;
    });
    ws.mergeCells(colL(lc) + '3:' + colL(lc + 10) + '3');
    put(ws, colL(lc) + '3', '행사: 시업·방학·개학·종업식 등 단축 수업일', { font: { size: 8, color: { argb: 'FF595959' } }, border: false, align: { horizontal: 'left' } });
    ws.getRow(3).height = 18;

    var weekTable = [];
    for (var k = 0; k < 12; k++) {
      var yy = k < 10 ? y : y + 1, mm = (k + 2) % 12 + 1, ym = yy + '-' + (mm < 10 ? '0' : '') + mm;
      var bc = 2 + (k % 4) * 8, br = 5 + Math.floor(k / 4) * 10; // 블록 왼쪽 열, 머리 행
      var mdays = (r.months.filter(function (m) { return m.ym === ym; })[0] || { days: 0 }).days;
      ws.mergeCells(colL(bc) + br + ':' + colL(bc + 2) + br);
      put(ws, colL(bc) + br, (mm <= 2 ? yy + '. ' : '') + mm + '월', { font: { size: 13, bold: true }, fill: 'FFFFFFCC' });
      ws.mergeCells(colL(bc + 3) + br + ':' + colL(bc + 6) + br);
      put(ws, colL(bc + 3) + br, '수업 ' + mdays + '일', { font: { size: 13, bold: true, color: { argb: C.purple } }, fill: 'FFDDEBF7' });
      ws.getRow(br).height = 24;
      for (var w = 0; w < 7; w++) put(ws, colL(bc + w) + (br + 1), WD[w], { font: { size: 10, bold: true, color: { argb: w === 0 ? C.red : w === 6 ? C.blue : 'FF000000' } }, fill: C.gray });
      var first = ym + '-01', off = dowOf(first), dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      var rowsCount = [0, 0, 0, 0, 0, 0];
      for (var rr = 0; rr < 6; rr++) for (var cc = 0; cc < 7; cc++) put(ws, colL(bc + cc) + (br + 2 + rr), '', {});
      var notes = [];
      for (var dn = 1; dn <= dim; dn++) {
        var date = ym + '-' + (dn < 10 ? '0' : '') + dn, d = dayMap[date], pos = off + dn - 1, row = Math.floor(pos / 7), cl = pos % 7;
        var cat = category(d, s, r.suneungDate);
        var cell = ws.getCell(colL(bc + cl) + (br + 2 + row));
        cell.value = dn;
        var fc = cl === 0 || cat === 'hol' ? C.red : cl === 6 ? C.blue : cat === 'out' || cat === 'vac' ? C.grayText : 'FF000000';
        font(cell, { size: 11, bold: cat !== 'vac' && cat !== 'out', color: { argb: fc } });
        var f = { hol: C.hol, clo: C.clo, vac: C.vac, cer: C.cer, adapt: C.adapt, adj: C.adj, sun: C.sun }[cat];
        if (f) fill(cell, f);
        if (d.status === 'school') rowsCount[row]++;
        // 메모: 휴일·휴업·행사·수능·조정
        var lab = d.labels.slice();
        if (d.status === 'school' && cat === 'adj') lab = lab.length ? lab : ['시수 조정'];
        if (lab.length && d.status !== 'vacation' || (d.status === 'vacation' && d.off && lab.length)) {
          var ev = (s.events || []).filter(function (e) { return e.date === date; })[0];
          var extra = ev && ev.periods ? ' (' + GR.map(function (g) { return ev.periods[g] == null ? '-' : ev.periods[g]; }).join('/') + '교시)' : '';
          notes.push(mdw(date, d.weekday) + ' ' + lab.join(', ') + extra);
        }
      }
      if (s.dates.summerStart && s.dates.summerStart.slice(0, 7) === ym) notes.push('여름방학 ' + md(addDays(s.dates.summerStart, 1)) + '~' + md(addDays(s.dates.summerEnd, -1)));
      if (s.dates.winterStart && s.dates.winterEnd && s.dates.winterStart.slice(0, 7) === ym) notes.push('겨울방학 ' + md(addDays(s.dates.winterStart, 1)) + '~' + md(addDays(s.dates.winterEnd, -1)));
      for (var rh = 0; rh < 6; rh++) ws.getRow(br + 2 + rh).height = 17;
      ws.mergeCells(colL(bc) + (br + 8) + ':' + colL(bc + 6) + (br + 8));
      var nc = put(ws, colL(bc) + (br + 8), notes.join('\n'), { font: { size: 8 }, wrap: true, fill: C.note });
      nc.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      ws.getRow(br + 8).height = Math.max(ws.getRow(br + 8).height || 0, 12 + 11 * Math.max(1, notes.length));
      weekTable.push({ label: (mm <= 2 ? yy + '.' : '') + mm + '월', weeks: rowsCount, sem: k < 5 ? 1 : 2 });
    }

    // 오른쪽: 월별 주차 수업일 (원본 AH~AN 표). 메모 줄과 겹치지 않게 달력 주 줄에 배치
    var tc = 35, ROWS = { head: 6, m: [7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22], sem1: 12, sem2: 25, year: 26 };
    ['월', '1주', '2주', '3주', '4주', '5주', '6주', '합계'].forEach(function (h, i) { put(ws, colL(tc + i - 1) + ROWS.head, h, { font: { bold: true }, fill: C.gray }); });
    ws.getColumn(tc - 1).width = 9; ws.getColumn(tc + 6).width = 7;
    weekTable.forEach(function (m, i) {
      var row = ROWS.m[i];
      put(ws, colL(tc - 1) + row, m.label, { font: { bold: true } });
      m.weeks.forEach(function (v, j) { put(ws, colL(tc + j) + row, v || 0, {}); });
      var tot = m.weeks.reduce(function (a, b) { return a + b; }, 0);
      put(ws, colL(tc + 6) + row, formula('SUM(' + colL(tc) + row + ':' + colL(tc + 5) + row + ')', tot), { font: { bold: true, color: { argb: C.purple } } });
    });
    function sumRow(row, label, f, v, size) {
      ws.mergeCells(colL(tc - 1) + row + ':' + colL(tc + 5) + row);
      put(ws, colL(tc - 1) + row, label, { font: { bold: true }, fill: C.gray });
      put(ws, colL(tc + 6) + row, formula(f, v), { font: { size: size, bold: true, color: { argb: C.purple } } });
    }
    var T = colL(tc + 6);
    sumRow(ROWS.sem1, '1학기 수업일수', "'" + DAILY + "'!H" + r._semRow[1], r.totals.days.sem1, 13);
    put(ws, colL(tc - 1) + 15, '', { border: false });
    ['월', '1주', '2주', '3주', '4주', '5주', '6주', '합계'].forEach(function (h, i) { put(ws, colL(tc + i - 1) + 15, h, { font: { bold: true }, fill: C.gray }); });
    sumRow(ROWS.sem2, '2학기 수업일수', "'" + DAILY + "'!H" + r._semRow[2], r.totals.days.sem2, 13);
    sumRow(ROWS.year, '연간 수업일수', T + ROWS.sem1 + '+' + T + ROWS.sem2, r.totals.days.total, 14);
    var s2 = ROWS.year - 2;
    ws.mergeCells(colL(tc - 1) + (s2 + 3) + ':' + colL(tc + 6) + (s2 + 8));
    var cap = put(ws, colL(tc - 1) + (s2 + 3), '주차는 달력의 줄(일~토) 기준입니다.\n날짜 색은 범례를 따릅니다.\n자세한 시수는 「전학년 수업시수(일별)」 시트에 있습니다.\n\n학사일정·수업시수 계산기 (김해외동초)\n원작: 서울신답초등학교 정용석', { font: { size: 9, color: { argb: 'FF595959' } }, wrap: true, border: false });
    cap.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  }

  // ---------- 2. 일별 ----------
  var DAILY = '전학년 수업시수(일별)';
  function sheetDaily(wb, r) {
    var s = r.state, ws = wb.addWorksheet(DAILY, { views: [{ state: 'frozen', xSplit: 8, ySplit: 5, showGridLines: false }] });
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .25, right: .25, top: .35, bottom: .35, header: .2, footer: .2 } };
    var dayMap = {}; r.days.forEach(function (d) { dayMap[d.date] = d; });
    // 열: A 월, B 주, C~G 월~금 날짜, H 주별 수업일, I~ 학년별 6칸(월~금, 합계)
    var GC = function (g, k) { return 9 + (g - 1) * 6 + k; }; // k: 0~4 요일, 5 합계
    var lastCol = GC(6, 5);
    ws.getColumn(1).width = 5; ws.getColumn(2).width = 4;
    for (var c = 3; c <= 7; c++) ws.getColumn(c).width = 4.2;
    ws.getColumn(8).width = 6;
    for (c = 9; c <= lastCol; c++) ws.getColumn(c).width = (c - 9) % 6 === 5 ? 6 : 4.2;
    ws.mergeCells('A1:' + colL(lastCol) + '1');
    put(ws, 'A1', s.year + '학년도 전학년 수업시수(일별)' + (s.school.name ? ' · ' + s.school.name : ''), { font: { size: 20, bold: true, color: { argb: 'FFFFFFFF' } }, fill: C.title, border: false });
    ws.getRow(1).height = 34;
    // 범례 + 요일별 기준 시수
    var leg = [['행사(개학·방학)', C.cer], ['공휴', C.hol], ['자율휴업', C.clo], ['입학초기', C.adapt], ['증감', C.adj], ['수능', C.sun]];
    leg.forEach(function (l, i) { var cc = 1 + i * 3; ws.mergeCells(colL(cc) + '2:' + colL(cc + 2) + '2'); put(ws, colL(cc) + '2', l[0], { font: { size: 9, bold: true }, fill: l[1] }); });
    ws.mergeCells('A3:H3');
    put(ws, 'A3', '요일별 기준 시수', { font: { bold: true, size: 9 }, fill: C.gray });
    GR.forEach(function (g) {
      ws.mergeCells(colL(GC(g, 0)) + '3:' + colL(GC(g, 5)) + '3');
      var b1 = window.Engine.basePeriodsFor(s, g, 1), b2 = window.Engine.basePeriodsFor(s, g, 2);
      function label(b) { return b.join('·') + ' (주 ' + b.reduce(function (a, v) { return a + v; }, 0) + ')'; }
      var different = b1.some(function (v, i) { return v !== b2[i]; });
      put(ws, colL(GC(g, 0)) + '3', different ? g + '학년\n1학기 ' + label(b1) + '\n2학기 ' + label(b2) : g + '학년 ' + label(b1), { font: { size: 9 }, wrap: different });
      if (different) ws.getRow(3).height = 42;
    });
    ws.getRow(2).height = 18;

    var row = 4, semRows = {}, monthRows = {};
    function header(sem) {
      ws.mergeCells('A' + row + ':' + colL(lastCol) + row);
      put(ws, 'A' + row, sem + '학기', { font: { size: 13, bold: true }, fill: 'FFFFFFCC', align: { horizontal: 'left' } });
      row++;
      put(ws, 'A' + row, '월', { font: { bold: true }, fill: C.peach }); put(ws, 'B' + row, '주', { font: { bold: true }, fill: C.peach });
      ['월', '화', '수', '목', '금'].forEach(function (w, k) { put(ws, colL(3 + k) + row, w, { font: { bold: true }, fill: C.peach }); });
      put(ws, 'H' + row, '수업일', { font: { bold: true, size: 9 }, fill: C.peach });
      GR.forEach(function (g) {
        ['월', '화', '수', '목', '금'].forEach(function (w, k) { put(ws, colL(GC(g, k)) + row, w, { fill: C.head }); });
        put(ws, colL(GC(g, 5)) + row, g + '학년', { font: { bold: true, size: 9 }, fill: C.head });
      });
      row++;
    }
    [1, 2].forEach(function (sem) {
      header(sem);
      var weeks = r.weeks.filter(function (w) { return w.sem === sem; }), first = row, lastMonth = null;
      weeks.forEach(function (w, i) {
        var mo = +w.month.slice(5);
        put(ws, 'A' + row, mo !== lastMonth ? mo + '월' : '', { font: { bold: true }, fill: C.peach }); lastMonth = mo;
        (monthRows[sem] = monthRows[sem] || {})[mo] = (monthRows[sem][mo] || []).concat([row]);
        put(ws, 'B' + row, i + 1, {});
        var days = 0;
        for (var k = 0; k < 5; k++) {
          var date = addDays(w.monday, k), d = dayMap[date];
          if (d && d.sem !== w.sem && d.status === 'school') d = { status: 'outside', labels: [], date: date };
          var dc = put(ws, colL(3 + k) + row, +date.slice(8, 10), { font: { size: 9, color: { argb: d && d.status === 'school' ? 'FF000000' : C.grayText } } });
          if (d && d.status === 'holiday') fill(dc, C.hol);
          if (d && d.status === 'school') days++;
          GR.forEach(function (g) {
            var cell = ws.getCell(colL(GC(g, k)) + row);
            border(cell); center(cell); font(cell, { size: 10 });
            if (!d || d.status === 'outside' || d.status === 'weekend' || d.status === 'vacation') { fill(cell, C.vac); return; }
            if (d.status === 'holiday') { fill(cell, C.hol); return; }
            if (d.status === 'closure') { fill(cell, C.clo); return; }
            var v = d.periods[g]; cell.value = v;
            var cat = category(d, s, r.suneungDate);
            if (cat === 'cer') fill(cell, C.cer);
            else if (cat === 'adapt') fill(cell, C.adapt);
            else if (cat === 'sun' && v === natural(s, d, g, r.suneungDate)) fill(cell, C.sun);
            else if (v !== natural(s, d, g, r.suneungDate)) fill(cell, C.adj);
          });
        }
        put(ws, 'H' + row, days, { font: { bold: true }, fill: C.peach });
        GR.forEach(function (g) {
          put(ws, colL(GC(g, 5)) + row, formula('SUM(' + colL(GC(g, 0)) + row + ':' + colL(GC(g, 4)) + row + ')', w.hours[g]), { font: { color: { argb: C.red } } });
        });
        row++;
      });
      var last = row - 1;
      // 학기 계
      ws.mergeCells('A' + row + ':G' + row);
      put(ws, 'A' + row, sem + '학기 계', { font: { bold: true }, fill: C.sumFill });
      put(ws, 'H' + row, formula('SUM(H' + first + ':H' + last + ')', r.totals.days['sem' + sem]), { font: { bold: true }, fill: C.sumFill });
      GR.forEach(function (g) {
        for (var k = 0; k < 5; k++) {
          var col = colL(GC(g, k)), val = 0;
          weeks.forEach(function (w) { var d = dayMap[addDays(w.monday, k)]; if (d && d.status === 'school' && d.sem === w.sem) val += d.periods[g]; });
          put(ws, col + row, formula('SUM(' + col + first + ':' + col + last + ')', val), { font: { size: 9 }, fill: C.sumFill });
        }
        put(ws, colL(GC(g, 5)) + row, formula('SUM(' + colL(GC(g, 5)) + first + ':' + colL(GC(g, 5)) + last + ')', r.totals.hours[g]['sem' + sem]), { font: { size: 11, bold: true, color: { argb: C.red } }, fill: C.sumFill });
      });
      semRows[sem] = row;
      row++;
      // 월별 합계(주의 소속 월 = 금요일이 속한 달)
      var months = Object.keys(monthRows[sem]).map(Number);
      months.sort(function (a, b) { return (a < 3 ? a + 12 : a) - (b < 3 ? b + 12 : b); });
      ws.mergeCells('A' + row + ':H' + row); put(ws, 'A' + row, '월별 시수', { font: { bold: true }, fill: C.gray });
      ws.mergeCells('A' + (row + 1) + ':H' + (row + 1)); put(ws, 'A' + (row + 1), '(주의 소속 월 = 금요일 기준)', { font: { size: 8 }, fill: C.gray });
      GR.forEach(function (g) {
        // 6칸 안에 월을 나눠 넣는다(넘치면 끝 칸에 묶음)
        var slots = [];
        months.forEach(function (m, i) { var si = Math.min(i, 5); (slots[si] = slots[si] || []).push(m); });
        for (var k = 0; k < 6; k++) {
          var col = colL(GC(g, k)), ms = slots[k] || [];
          put(ws, col + row, ms.map(function (m) { return m + '월'; }).join('·'), { font: { size: 8 }, fill: C.gray });
          var refs = [], val = 0;
          ms.forEach(function (m) { monthRows[sem][m].forEach(function (rr) { refs.push(colL(GC(g, 5)) + rr); var w = r.weeks.filter(function (x) { return x.sem === sem && +x.month.slice(5) === m; }); }); });
          r.weeks.forEach(function (w) { if (w.sem === sem && ms.indexOf(+w.month.slice(5)) >= 0) val += w.hours[g]; });
          put(ws, col + (row + 1), refs.length ? formula('SUM(' + refs.join(',') + ')', val) : '', { font: { size: 9, bold: true } });
        }
      });
      row += 3;
    });

    // 연간·학년군 판정
    var labels = [['1학기 계', function (g) { return formula(colL(GC(g, 5)) + semRows[1], r.totals.hours[g].sem1); }],
      ['2학기 계', function (g) { return formula(colL(GC(g, 5)) + semRows[2], r.totals.hours[g].sem2); }],
      [s.year + '학년도 계', function (g, rr) { return formula(colL(GC(g, 5)) + (rr - 2) + '+' + colL(GC(g, 5)) + (rr - 1), r.totals.hours[g].total); }],
      ['작년 이수(2·4·6) / 내년 필요(1·3·5)', null], ['학년군 합', null], ['학년군 기준(최소)', null], ['편차', null]];
    var gradeRow = {};
    r.grades.forEach(function (g) { gradeRow[g.grade] = g; });
    var start = row;
    put(ws, 'A' + (row - 1), '연간 합계와 학년군 판정 (2022 개정 교육과정: 1~2학년 1,744 · 3~4학년 1,972 · 5~6학년 2,176, 최소 시수)', { font: { bold: true }, border: false, align: { horizontal: 'left' } });
    labels.forEach(function (l, i) {
      var rr = start + i;
      ws.mergeCells('A' + rr + ':H' + rr);
      put(ws, 'A' + rr, l[0], { font: { bold: true }, fill: C.gray });
      GR.forEach(function (g) {
        ws.mergeCells(colL(GC(g, 0)) + rr + ':' + colL(GC(g, 4)) + rr);
        put(ws, colL(GC(g, 0)) + rr, i === 0 ? g + '학년' : '', { font: { size: 9, color: { argb: 'FF595959' } } });
        var gr = gradeRow[g], tc = colL(GC(g, 5)), v;
        if (l[1]) v = l[1](g, rr);
        else if (i === 3) v = g % 2 === 0 ? (gr.prev == null ? '' : gr.prev) : formula(gr.standard + '-' + tc + (start + 2), gr.nextYearNeed);
        else if (i === 4) v = g % 2 === 0 ? (gr.prev == null ? '' : formula(tc + (start + 2) + '+' + tc + (start + 3), gr.total + gr.prev)) : '';
        else if (i === 5) v = gr.standard;
        else if (i === 6) v = g % 2 === 0 ? (gr.prev == null ? '작년 미입력' : formula(tc + (start + 4) + '-' + tc + (start + 5), gr.margin)) : '';
        var cell = put(ws, tc + rr, v, { font: { bold: i === 2 || i === 6, color: { argb: i === 6 && gr.margin != null && gr.margin < 0 ? C.red : 'FF000000' } } });
        if (i === 6 && g % 2 === 0 && gr.prev != null) fill(cell, gr.margin < 0 ? 'FFFFC7CE' : gr.margin === 0 ? 'FFFFEB9C' : 'FFC6EFCE');
      });
    });
    return { GC: GC, semRows: semRows };
  }

  // ---------- 3. 주별 ----------
  function sheetWeekly(wb, r, dailyRef) {
    var s = r.state, ws = wb.addWorksheet('전학년 수업시수(주별)', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
    ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } };
    var widths = [6, 5, 5, 15, 7, 8, 8, 8, 8, 8, 8, 34];
    widths.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    ws.mergeCells('A1:L1');
    put(ws, 'A1', s.year + '학년도 전학년 수업시수(주별)' + (s.school.name ? ' · ' + s.school.name : ''), { font: { size: 18, bold: true, color: { argb: 'FFFFFFFF' } }, fill: C.title, border: false });
    ws.getRow(1).height = 30;
    ws.mergeCells('A2:L2');
    put(ws, 'A2', '학년별 주간 시수는 「' + DAILY + '」 시트를 참조합니다. 일별 시트에서 시수를 고치면 이 시트도 함께 바뀝니다.', { font: { size: 9, color: { argb: 'FF595959' } }, border: false, align: { horizontal: 'left' } });
    ['학기', '월', '주', '기간', '수업일'].concat(GR.map(function (g) { return g + '학년'; })).concat(['주요 일정(쉬는 평일·행사)']).forEach(function (h, i) { put(ws, colL(i + 1) + '3', h, { font: { bold: true }, fill: i < 5 ? C.peach : i < 11 ? C.head : C.gray }); });
    // 일별 시트의 주 행 위치를 다시 계산(같은 규칙으로 배치했으므로)
    var dayMap = {}; r.days.forEach(function (d) { dayMap[d.date] = d; });
    var row = 4, drow = 6, sums = {};
    [1, 2].forEach(function (sem) {
      var weeks = r.weeks.filter(function (w) { return w.sem === sem; }), first = row;
      weeks.forEach(function (w, i) {
        put(ws, 'A' + row, i === 0 ? sem + '학기' : '', { font: { bold: true }, fill: C.peach });
        put(ws, 'B' + row, (+w.month.slice(5)) + '월', {}); put(ws, 'C' + row, i + 1, {});
        put(ws, 'D' + row, md(w.monday) + ' ~ ' + md(w.friday), {});
        put(ws, 'E' + row, formula("'" + DAILY + "'!H" + drow, w.days), { font: { bold: true } });
        GR.forEach(function (g, gi) { put(ws, colL(6 + gi) + row, formula("'" + DAILY + "'!" + colL(dailyRef.GC(g, 5)) + drow, w.hours[g]), {}); });
        var notes = [];
        for (var k = 0; k < 5; k++) {
          var d = dayMap[addDays(w.monday, k)];
          if (!d || d.status === 'outside') continue;
          var ev = (s.events || []).filter(function (e) { return e.date === d.date; })[0];
          if (d.off || (ev && ev.type === 'ceremony') || d.category === 'suneung') notes.push(md(d.date) + ' ' + (d.labels.filter(function (l) { return l; })[0] || '휴업'));
        }
        var nc = put(ws, 'L' + row, notes.join(', '), { font: { size: 9 }, wrap: true }); nc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        row++; drow++;
      });
      var last = row - 1;
      ws.mergeCells('A' + row + ':D' + row);
      put(ws, 'A' + row, sem + '학기 계', { font: { bold: true }, fill: C.sumFill });
      put(ws, 'E' + row, formula('SUM(E' + first + ':E' + last + ')', r.totals.days['sem' + sem]), { font: { bold: true }, fill: C.sumFill });
      GR.forEach(function (g, gi) { var col = colL(6 + gi); put(ws, col + row, formula('SUM(' + col + first + ':' + col + last + ')', r.totals.hours[g]['sem' + sem]), { font: { bold: true, color: { argb: C.red } }, fill: C.sumFill }); });
      put(ws, 'L' + row, '', { fill: C.sumFill });
      sums[sem] = row;
      row += 2;
      drow += 6; // 일별 시트: 학기 계 1 + 월별 2 + 빈 줄 1 + 다음 학기 머리 2
    });
    ws.mergeCells('A' + row + ':D' + row);
    put(ws, 'A' + row, '연간 합계', { font: { bold: true }, fill: C.gray });
    put(ws, 'E' + row, formula('E' + sums[1] + '+E' + sums[2], r.totals.days.total), { font: { bold: true, size: 12 } });
    GR.forEach(function (g, gi) { var col = colL(6 + gi); put(ws, col + row, formula(col + sums[1] + '+' + col + sums[2], r.totals.hours[g].total), { font: { bold: true, size: 12 } }); });
  }

  function build(result, H) {
    if (!window.ExcelJS) return Promise.reject(new Error('ExcelJS 없음'));
    var wb = new window.ExcelJS.Workbook();
    wb.creator = '김해외동초등학교 (원작: 서울신답초등학교 정용석, 학사일정·수업시수 계산기)'; wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    // 달력 시트가 일별 시트의 학기 합계 행을 참조하므로 행 위치를 먼저 계산(일별 시트 배치와 같은 규칙)
    var semRow = {}, row = 4;
    [1, 2].forEach(function (sem) { row += 2; row += result.weeks.filter(function (w) { return w.sem === sem; }).length; semRow[sem] = row; row += 4; });
    result._semRow = semRow;
    sheetCalendar(wb, result, H);
    var ref = sheetDaily(wb, result);
    if (ref.semRows[1] !== semRow[1] || ref.semRows[2] !== semRow[2]) throw new Error('row mismatch');
    sheetWeekly(wb, result, ref);
    return wb.xlsx.writeBuffer();
  }
  var lastFileStem = '', sameSecondCount = 0;
  function fileName(state) {
    var date = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    var stamp = date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + '_' +
      two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
    var stem = state.year + '학년도_학사일정' + (state.school.name ? '_' + state.school.name.replace(/[\\/:*?"<>|]/g, '') : '') + '_' + stamp;
    sameSecondCount = stem === lastFileStem ? sameSecondCount + 1 : 0;
    lastFileStem = stem;
    return stem + (sameSecondCount ? '_' + (sameSecondCount + 1) : '') + '.xlsx';
  }

  window.ExportXlsx = { build: build, fileName: fileName };
})();
