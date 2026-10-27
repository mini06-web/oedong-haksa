/* 저장: 구글시트(GAS 웹앱) + 이 브라우저 백업
 * 시트 주소는 config.js 의 HAKSA_CONFIG.gasUrl. 읽기는 누구나, 쓰기는 담당자 비밀번호가 맞을 때만.
 * savedAt(밀리초)은 시트(GAS)가 정한다. 저장할 때 "마지막으로 받은 savedAt"(base)을 함께 보내고,
 * 시트에 그보다 새로운 저장본이 있으면 GAS가 거부해 충돌을 알린다(집·학교 동시 편집 대비).
 * 파일 내보내기 형식(2027학년도_학사일정.json)은 원본과 같다: { app, format, savedAt, state }
 */
(function () {
  'use strict';
  var cfg = window.HAKSA_CONFIG || {};
  var TIMEOUT = 20000;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 저장소 막힘 */ } }
  function url() { return lsGet('haksa:gasUrl') || cfg.gasUrl || ''; }

  // 실패 사유: 'network'(연결 안 됨) | 'auth'(비밀번호) | 'server'(시트 오류) | 'off'(주소 없음)
  function fail(code, detail) { var e = new Error(code); e.detail = detail; return e; }
  function req(method, params, body) {
    var u = url(); if (!u) return Promise.reject(fail('off'));
    var q = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    // text/plain 으로 보내야 사전 요청(preflight) 없이 GAS에 닿는다
    var opt = { method: method, redirect: 'follow', signal: ctl ? ctl.signal : undefined };
    if (body) opt.body = JSON.stringify(body);
    return fetch(u + (q ? (u.indexOf('?') < 0 ? '?' : '&') + q : ''), opt)
      .then(function (r) { if (!r.ok) throw fail('network', r.status); return r.text(); }, function () { throw fail('network'); })
      .then(function (t) {
        clearTimeout(timer);
        var o; try { o = JSON.parse(t); } catch (e) { throw fail('server', '응답 형식 오류'); }
        if (o && o.error === 'auth') throw fail('auth');
        if (!o || (!o.ok && !o.conflict)) throw fail('server', o && o.error);
        return o;
      }, function (e) { clearTimeout(timer); throw e; });
  }

  // 시트에 있는 학년도 목록: [{ year, savedAt, savedBy }]
  function list() { return req('GET', { action: 'list' }).then(function (o) { return o.years || []; }); }
  // 한 학년도: null(없음) | { year, state, savedAt, savedBy }
  function get(year) { return req('GET', { action: 'get', year: year }).then(function (o) { return o.data || null; }); }
  // 결과: { ok:true, savedAt } | { conflict:true, remote:{ state, savedAt, savedBy } }
  function save(year, state, base, force) {
    return req('POST', null, { action: 'save', pw: password(), year: year, state: state, base: base || 0, force: !!force, device: device() })
      .then(function (o) { return o.conflict ? { conflict: true, remote: o.remote } : { ok: true, savedAt: o.savedAt }; });
  }
  // 비밀번호 확인: true | false (연결 실패는 reject)
  function check(pw) {
    return req('POST', null, { action: 'check', pw: pw }).then(function () { return true; }, function (e) { if (e.message === 'auth') return false; throw e; });
  }

  // 담당자 비밀번호: '기억'하면 localStorage, 아니면 이 탭(sessionStorage)에만
  function password() {
    var s = null; try { s = sessionStorage.getItem('haksa:pw'); } catch (e) { /* 막힘 */ }
    return s || lsGet('haksa:pw') || '';
  }
  function setPassword(pw, remember) {
    try { if (pw && !remember) sessionStorage.setItem('haksa:pw', pw); else sessionStorage.removeItem('haksa:pw'); } catch (e) { /* 막힘 */ }
    lsSet('haksa:pw', pw && remember ? pw : null);
  }
  // 저장한 곳 표시용 이름(예: 집, 학교 교무실)
  function device() { return lsGet('haksa:device') || ''; }
  function setDevice(n) { lsSet('haksa:device', (n || '').slice(0, 30) || null); }

  // ---------- 파일 내려받기·불러오기(원본과 같은 형식) ----------
  function fileName(y) { return y + '학년도_학사일정.json'; }
  function wrap(state, at) { return { app: 'haksa-sisu-calculator', format: 1, savedAt: new Date(at || Date.now()).toISOString(), state: state }; }
  function unwrap(o) { return o && o.state && o.app === 'haksa-sisu-calculator' ? o.state : o && o.year && o.dates ? o : null; }
  function downloadBlob(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function download(y, state) {
    downloadBlob(fileName(y), new Blob([JSON.stringify(wrap(state), null, 1)], { type: 'application/json' }));
  }
  function readFile(file) { return file.text().then(function (t) { return unwrap(JSON.parse(t)); }); }

  window.Store = {
    configured: function () { return !!url(); },
    list: list, get: get, save: save, check: check,
    password: password, setPassword: setPassword, device: device, setDevice: setDevice,
    fileName: fileName, download: download, downloadBlob: downloadBlob, readFile: readFile
  };
})();
