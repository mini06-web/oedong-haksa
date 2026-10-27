/* gas/Code.gs 를 Node에서 그대로 실행하기 위한 가짜 구글 서비스(메모리 시트).
 * 실제 배포 전에 저장·충돌·비밀번호 흐름을 확인하는 용도. 쓰는 메서드만 흉내 낸다.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

function Sheet(name) { this.name = name; this.grid = []; this.maxCols = 26; }
Sheet.prototype.cell = function (r, c) { return (this.grid[r - 1] || [])[c - 1]; };
Sheet.prototype.set = function (r, c, v) { (this.grid[r - 1] = this.grid[r - 1] || [])[c - 1] = v; };
Sheet.prototype.getLastRow = function () { for (var r = this.grid.length; r > 0; r--) if ((this.grid[r - 1] || []).some(function (v) { return v !== '' && v != null; })) return r; return 0; };
Sheet.prototype.getLastColumn = function () { var m = 0; this.grid.forEach(function (row) { (row || []).forEach(function (v, i) { if (v !== '' && v != null) m = Math.max(m, i + 1); }); }); return m; };
Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; };
Sheet.prototype.appendRow = function (vals) { var r = this.getLastRow() + 1, s = this; vals.forEach(function (v, i) { s.set(r, i + 1, v); }); };
Sheet.prototype.deleteRows = function (r, n) { this.grid.splice(r - 1, n); };
Sheet.prototype.clear = function () { this.grid = []; };
['setFrozenRows', 'setColumnWidth'].forEach(function (k) { Sheet.prototype[k] = function () { return this; }; });
Sheet.prototype.getRange = function (r, c, nr, nc) {
  if (typeof r === 'string') { var col = r.charCodeAt(0) - 64; return new Range(this, 1, col, 1000, 1); }
  return new Range(this, r, c, nr || 1, nc || 1);
};

function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
Range.prototype.getValues = function () {
  var out = [];
  for (var i = 0; i < this.nr; i++) { var row = []; for (var j = 0; j < this.nc; j++) { var v = this.sh.cell(this.r + i, this.c + j); row.push(v == null ? '' : v); } out.push(row); }
  return out;
};
Range.prototype.getValue = function () { return this.getValues()[0][0]; };
Range.prototype.getDisplayValues = function () { return this.getValues().map(function (r) { return r.map(String); }); };
Sheet.prototype.getName = function () { return this.name; };
Range.prototype.setValues = function (vals) {
  if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('범위 크기와 값의 크기가 다릅니다');
  if (this.c + this.nc - 1 > this.sh.maxCols) throw new Error('열이 부족합니다');
  var s = this;
  vals.forEach(function (row, i) { row.forEach(function (v, j) {
    if (typeof v === 'string' && v.length > 50000) throw new Error('칸에 50000자 넘게 넣음');
    s.sh.set(s.r + i, s.c + j, v);
  }); });
  return this;
};
Range.prototype.clearContent = function () { for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; };
Range.prototype.sort = function (o) {
  var rows = this.sh.grid.slice(this.r - 1, this.r - 1 + this.nr), k = o.column - 1;
  rows.sort(function (a, b) { return (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (o.ascending ? 1 : -1); });
  Array.prototype.splice.apply(this.sh.grid, [this.r - 1, rows.length].concat(rows));
  return this;
};
['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor'].forEach(function (k) { Range.prototype[k] = function () { return this; }; });

function createGas(opts) {
  opts = opts || {};
  var sheets = [new Sheet('시트1')];
  var ss = {
    getSheetByName: function (n) { return sheets.filter(function (s) { return s.name === n; })[0] || null; },
    insertSheet: function (n) { var s = new Sheet(n); sheets.push(s); return s; },
    getSheets: function () { return sheets.slice(); },
    deleteSheet: function (s) { sheets.splice(sheets.indexOf(s), 1); }
  };
  var props = { EDIT_PASSWORD: opts.password === undefined ? 'test-pw' : opts.password }, cache = {};
  // 게시판: opts.board 가 있으면 그 값을 '기초시간표, 전담시간표, 특별실' 탭으로, 없으면 권한 없음
  var boardSheet = new Sheet('기초시간표, 전담시간표, 특별실');
  (opts.board || []).forEach(function (r, i) { r.forEach(function (v, j) { boardSheet.set(i + 1, j + 1, v); }); });
  boardSheet.maxCols = 60;
  var board = { getName: function () { return '2026 외동 게시판'; }, getSheets: function () { return [new Sheet('링크모음'), boardSheet]; } };
  var ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return ss; },
      openById: function (id) { if (!opts.board) throw new Error('Exception: You do not have permission'); return board; }
    },
    Logger: { log: function () {} },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] || null; } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cache[k] || null; }, put: function (k, v) { cache[k] = v; } }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { content: s, setMimeType: function () { return this; } }; } },
    Date: Date, JSON: JSON, Math: Math, Number: Number, String: String
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ss: ss, sheets: sheets,
    get: function (params) { return JSON.parse(ctx.doGet({ parameter: params }).content); },
    post: function (body) { return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content); },
    setup: function () { ctx.setup(); }
  };
}
module.exports = { createGas: createGas };
