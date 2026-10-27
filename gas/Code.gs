/**
 * 학사일정·수업시수 계산기 — 김해외동초 저장소 (Google Apps Script 웹앱)
 *
 * 화면(GitHub Pages)이 이 웹앱에 학년도별 학사일정(state JSON)을 읽고 씁니다.
 *  - 읽기(GET):  ?action=list  → 시트에 있는 학년도 목록
 *               ?action=get&year=2027 → 그 학년도 자료
 *  - 쓰기(POST): { action:'check', pw }  → 비밀번호 확인
 *               { action:'save', pw, year, state, base, force, device } → 저장
 *               { action:'ttGet', pw, year }   → 그 학년도 시간표(교사 이름이 있어 비밀번호 필요)
 *               { action:'ttSave', pw, year, data, base, force, device } → 시간표 저장
 *               { action:'board', pw } → 「외동 게시판」 기초시간표 탭 값(화면이 해석)
 *    base = 화면이 마지막으로 받은 savedAt. 시트에 그보다 새 저장본이 있으면(다른 곳에서 저장)
 *    저장하지 않고 conflict 로 알립니다. force=true 이면 덮어씁니다.
 *
 * 담당자 비밀번호는 코드에 넣지 않습니다.
 *   프로젝트 설정(톱니바퀴) → 스크립트 속성 → 속성 EDIT_PASSWORD, 값 = 비밀번호
 * 게시판 주소가 바뀌면 스크립트 속성 BOARD_ID 에 새 시트 ID를 넣습니다(없으면 아래 BOARD_ID).
 *
 * 시트 탭(용도별로 나눔. 나중에 온라인 교무실과 합칠 때 그대로 가져갈 수 있게):
 *   학사일정  학년도마다 한 줄: 학년도 | savedAt | 저장 시각 | 저장한 기기 | 조각 수 | JSON…
 *   시간표    학년도마다 한 줄(같은 모양): 1·2학기 학급 시간표와 전담 배정
 *   저장기록  저장·실패 기록
 *   안내      각 탭 설명
 */

var APP = 'haksa-sisu-calculator';
var BOARD_ID = '1d26nIbonPBHVzN66qqigv9F_uGtAL-_yCQdAdjy-drs'; // 2026 외동 게시판
var BOARD_ROWS = 120, BOARD_COLS = 60;
var SHEET_DATA = '학사일정';
var SHEET_TT = '시간표';
var SHEET_LOG = '저장기록';
var SHEET_INFO = '안내';
var DATA_HEADER = ['학년도', 'savedAt', '저장 시각', '저장한 기기', 'JSON 조각 수', 'JSON'];
var LOG_HEADER = ['시각', '학년도', '기기', '결과', 'savedAt'];
var CHUNK = 45000;        // 한 칸에 50,000자까지 들어가므로 여유를 두고 나눠 담음
var MAX_JSON = 400000;    // 비정상적으로 큰 자료는 거부
var LOG_KEEP = 3000;      // 저장기록은 최근 이만큼만 남김
var FAIL_LIMIT = 20;      // 10분 안에 비밀번호를 이만큼 틀리면 잠시 막음

// ---------- 웹앱 입구 ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return json_({ ok: true, years: listYears_() });
    if (p.action === 'get') {
      var y = toYear_(p.year);
      if (!y) return json_({ ok: false, error: '학년도가 올바르지 않습니다' });
      return json_({ ok: true, data: readYear_(y) });
    }
    return json_({ ok: true, app: APP });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: '요청 형식 오류' }); }
  try {
    if (tooManyFails_()) return json_({ ok: false, error: 'auth' });
    if (!checkPassword_(body.pw)) {
      noteFail_();
      log_(toYear_(body.year), body.device, body.action === 'check' ? '비밀번호 확인 실패' : '저장 거부(비밀번호)', '');
      return json_({ ok: false, error: 'auth' });
    }
    if (body.action === 'check') return json_({ ok: true });
    if (body.action === 'save') return json_(saveYear_(body));
    // 시간표에는 교사 이름이 있어 읽기도 비밀번호가 필요하다
    if (body.action === 'ttGet') {
      var y = toYear_(body.year);
      if (!y) return json_({ ok: false, error: '학년도가 올바르지 않습니다' });
      return json_({ ok: true, data: readTimetable_(y) });
    }
    if (body.action === 'ttSave') return json_(saveTimetable_(body));
    if (body.action === 'board') return json_(Object.assign({ ok: true }, readBoard_()));
    return json_({ ok: false, error: '알 수 없는 요청' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- 저장·읽기 ----------
function saveYear_(body) {
  var y = toYear_(body.year);
  if (!y) return { ok: false, error: '학년도가 올바르지 않습니다' };
  var st = body.state;
  if (!st || typeof st !== 'object' || +st.year !== y || !st.dates) return { ok: false, error: '학사일정 자료 형식이 아닙니다' };
  return saveRow_(SHEET_DATA, y, st, body, '', function () { return readYear_(y); });
}
function saveTimetable_(body) {
  var y = toYear_(body.year);
  if (!y) return { ok: false, error: '학년도가 올바르지 않습니다' };
  var tt = body.data;
  if (!tt || typeof tt !== 'object' || !tt.sem || !Array.isArray(tt.classes)) return { ok: false, error: '시간표 자료 형식이 아닙니다' };
  return saveRow_(SHEET_TT, y, tt, body, '시간표 ', function () { return readTimetable_(y); });
}

// 학년도 한 줄 저장(학사일정·시간표 공통). remote(): 충돌 때 돌려줄 최신본
function saveRow_(name, y, obj, body, what, remote) {
  var text = JSON.stringify(obj);
  if (text.length > MAX_JSON) return { ok: false, error: '자료가 너무 큽니다' };
  var device = String(body.device || '').slice(0, 30);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(name), row = findRow_(sh, y);
    var cur = row ? Number(sh.getRange(row, 2).getValue()) || 0 : 0;
    var base = Number(body.base) || 0;
    if (cur && !body.force && cur > base) {
      log_(y, device, what + '충돌(저장 안 함)', cur);
      return { ok: false, conflict: true, remote: remote() };
    }
    var savedAt = Math.max(Date.now(), cur + 1);
    var chunks = [];
    for (var i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
    var values = [y, savedAt, new Date(savedAt), device, chunks.length].concat(chunks);
    if (!row) row = sh.getLastRow() + 1;
    var width = Math.max(sh.getLastColumn(), values.length);
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    // 이전 저장본이 더 많은 조각이었을 수 있으니 줄 전체를 지우고 쓴다
    sh.getRange(row, 1, 1, width).clearContent();
    sh.getRange(row, 6, 1, chunks.length).setNumberFormat('@');
    sh.getRange(row, 1, 1, values.length).setValues([values]);
    sortRows_(sh);
    log_(y, device, what + (body.force ? '덮어쓰기 저장' : '저장'), savedAt);
    return { ok: true, savedAt: savedAt };
  } finally {
    lock.releaseLock();
  }
}

function readYear_(y) {
  var r = readRow_(SHEET_DATA, y);
  return r && { year: y, state: r.obj, savedAt: r.savedAt, savedBy: r.savedBy };
}
function readTimetable_(y) {
  var r = readRow_(SHEET_TT, y);
  return r && { year: y, data: r.obj, savedAt: r.savedAt, savedBy: r.savedBy };
}
function readRow_(name, y) {
  var sh = sheet_(name), row = findRow_(sh, y);
  if (!row) return null;
  var width = sh.getLastColumn();
  var v = sh.getRange(row, 1, 1, width).getValues()[0];
  var n = Number(v[4]) || 1, text = '';
  for (var i = 0; i < n; i++) text += String(v[5 + i] || '');
  var obj;
  try { obj = JSON.parse(text); } catch (x) { throw new Error(y + '학년도 ' + name + ' 자료를 읽지 못했습니다(시트의 JSON 칸이 손상됨)'); }
  return { obj: obj, savedAt: Number(v[1]) || 0, savedBy: String(v[3] || '') };
}

// ---------- 게시판 시간표 읽기 ----------
// 「2026 외동 게시판」의 '기초시간표' 탭 값을 그대로 돌려준다(해석은 화면의 timetable.js 가 함)
function readBoard_() {
  var id = PropertiesService.getScriptProperties().getProperty('BOARD_ID') || BOARD_ID;
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (x) { throw new Error('게시판 시트를 열 수 없습니다. 이 계정에 게시판 보기 권한이 있는지 확인하세요'); }
  var sh = ss.getSheets().filter(function (s) { return /기초시간표/.test(s.getName()); })[0];
  if (!sh) throw new Error('게시판에서 「기초시간표」가 들어간 탭을 찾지 못했습니다');
  var rows = Math.min(sh.getLastRow(), BOARD_ROWS), cols = Math.min(sh.getLastColumn(), BOARD_COLS);
  return { title: ss.getName(), sheet: sh.getName(), values: rows && cols ? sh.getRange(1, 1, rows, cols).getDisplayValues() : [] };
}

/** 게시판 읽기 권한 승인용: 편집기에서 한 번 실행하세요. 실행 로그에 탭 이름이 나오면 성공 */
function checkBoard() {
  var b = readBoard_();
  Logger.log(b.title + ' / ' + b.sheet + ' / ' + b.values.length + '줄');
}

function listYears_() {
  var sh = sheet_(SHEET_DATA), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter(function (r) { return toYear_(r[0]); })
    .map(function (r) { return { year: Number(r[0]), savedAt: Number(r[1]) || 0, savedBy: String(r[3] || '') }; });
}

function findRow_(sh, y) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) if (Number(col[i][0]) === y) return i + 2;
  return 0;
}

function sortRows_(sh) {
  var last = sh.getLastRow();
  if (last > 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).sort({ column: 1, ascending: true });
}

// ---------- 비밀번호 ----------
function checkPassword_(pw) {
  var real = PropertiesService.getScriptProperties().getProperty('EDIT_PASSWORD');
  if (!real) throw new Error('스크립트 속성 EDIT_PASSWORD 가 설정되지 않았습니다');
  return typeof pw === 'string' && pw.length > 0 && pw === real;
}
function tooManyFails_() { return Number(CacheService.getScriptCache().get('fails') || 0) >= FAIL_LIMIT; }
function noteFail_() {
  var c = CacheService.getScriptCache(), n = Number(c.get('fails') || 0) + 1;
  c.put('fails', String(n), 600);
}

// ---------- 시트 준비 ----------
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  return sh;
}

/** 처음 한 번 편집기에서 실행하세요(권한 승인 + 탭 만들기). 여러 번 실행해도 자료는 지우지 않습니다. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = ss.getSheetByName(SHEET_DATA) || ss.insertSheet(SHEET_DATA);
  data.getRange(1, 1, 1, DATA_HEADER.length).setValues([DATA_HEADER]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  data.setFrozenRows(1);
  data.getRange('B:B').setNumberFormat('0');
  data.getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  data.setColumnWidth(6, 300);

  var tt = ss.getSheetByName(SHEET_TT) || ss.insertSheet(SHEET_TT);
  tt.getRange(1, 1, 1, DATA_HEADER.length).setValues([DATA_HEADER]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  tt.setFrozenRows(1);
  tt.getRange('B:B').setNumberFormat('0');
  tt.getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  tt.setColumnWidth(6, 300);

  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);
  log.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold').setBackground('#EEF2F7');
  log.setFrozenRows(1);
  log.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  log.getRange('E:E').setNumberFormat('0');

  var info = ss.getSheetByName(SHEET_INFO) || ss.insertSheet(SHEET_INFO);
  info.clear();
  info.getRange(1, 1, 7, 2).setValues([
    ['탭', '설명'],
    [SHEET_DATA, '학년도마다 한 줄. 계산기가 자동으로 씁니다. 손으로 고치지 마세요(JSON이 깨지면 그 학년도를 열 수 없습니다).'],
    [SHEET_TT, '학년도마다 한 줄. 1·2학기 학급 시간표와 전담 배정(교사 이름 포함, 비밀번호로만 읽힘). 손으로 고치지 마세요.'],
    [SHEET_LOG, '저장·충돌·비밀번호 실패 기록. 최근 ' + LOG_KEEP + '줄만 남깁니다.'],
    [SHEET_INFO, '이 설명.'],
    ['비밀번호', 'Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성 EDIT_PASSWORD'],
    ['원작', '학사일정·수업시수 계산기(서울신답초등학교 정용석)를 김해외동초 실정에 맞게 고친 판']
  ]);
  info.getRange(1, 1, 1, 2).setFontWeight('bold');
  info.setColumnWidth(1, 120); info.setColumnWidth(2, 640);

  // 새 스프레드시트에 기본으로 있던 빈 '시트1'은 정리
  ['시트1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

// ---------- 도구 ----------
function log_(year, device, result, savedAt) {
  try {
    var sh = sheet_(SHEET_LOG);
    sh.appendRow([new Date(), year || '', String(device || '').slice(0, 30), result, savedAt || '']);
    var extra = sh.getLastRow() - 1 - LOG_KEEP;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (x) { /* 기록 실패는 저장에 영향 없음 */ }
}
function toYear_(v) { var y = Math.round(Number(v)); return y >= 2000 && y <= 2100 ? y : 0; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
