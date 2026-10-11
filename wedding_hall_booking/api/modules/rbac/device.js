'use strict';
/* A short, human-readable description of the client for the login journal ("Chrome 120 · Windows"). */
function deviceInfo(ua) {
  const s = String(ua || '');
  if (!s) return 'unknown';
  const browser = (/Edg\/([\d.]+)/.exec(s) && ['Edge', RegExp.$1]) || (/OPR\/([\d.]+)/.exec(s) && ['Opera', RegExp.$1]) || (/Chrome\/([\d.]+)/.exec(s) && ['Chrome', RegExp.$1])
    || (/Firefox\/([\d.]+)/.exec(s) && ['Firefox', RegExp.$1]) || (/Version\/([\d.]+).*Safari/.exec(s) && ['Safari', RegExp.$1]) || null;
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  const device = /Mobile|Android|iPhone/.test(s) ? 'Mobile' : 'Desktop';
  const name = browser ? `${browser[0]} ${browser[1].split('.')[0]}` : s.slice(0, 40);
  return [name, os, device].filter(Boolean).join(' · ').slice(0, 120);
}
module.exports = { deviceInfo };
