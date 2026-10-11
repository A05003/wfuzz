'use strict';
/* Delivery of one-time recovery codes by e-mail or SMS.
 * No provider credentials ship with the project, so delivery is pluggable:
 *   NOTIFY_DRIVER=console  (default) prints the message to the server log — development only
 *   NOTIFY_DRIVER=webhook  POSTs {channel,to,subject,text} as JSON to NOTIFY_WEBHOOK_URL
 *                          (optional NOTIFY_WEBHOOK_TOKEN as a Bearer token); point it at your SMTP/SMS gateway
 *   NOTIFY_DRIVER=memory   keeps messages in `outbox` (tests)
 * The code is NEVER returned in an HTTP response.
 */
const outbox = [];

const TEXT = {
  ar: (venue, code) => ({ subject: `رمز استعادة كلمة المرور — ${venue}`, text: `رمز التحقق الخاص بك: ${code}\nصالح لمدة 15 دقيقة. إن لم تطلبه فتجاهل هذه الرسالة.` }),
  en: (venue, code) => ({ subject: `Password recovery code — ${venue}`, text: `Your verification code: ${code}\nValid for 15 minutes. If you did not request it, ignore this message.` }),
};

async function sendRecoveryCode({ channel, to, lang, venue, code }) {
  const msg = (TEXT[lang] || TEXT.en)(venue, code);
  const payload = { channel, to, subject: channel === 'email' ? msg.subject : undefined, text: msg.text };
  const driver = process.env.NOTIFY_DRIVER || 'console';
  if (driver === 'memory') { outbox.push({ ...payload, code }); return; }
  if (driver === 'webhook') {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    if (!url) throw new Error('NOTIFY_WEBHOOK_URL is not set');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.NOTIFY_WEBHOOK_TOKEN ? { Authorization: 'Bearer ' + process.env.NOTIFY_WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`notification gateway answered ${res.status}`);
    return;
  }
  console.log(`[notify:${channel}] to=${to}\n${payload.subject ? payload.subject + '\n' : ''}${payload.text}`);
}

module.exports = { sendRecoveryCode, outbox };
