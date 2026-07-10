'use strict';

/**
 * EmailService — thin wrapper around nodemailer for the send_email tool.
 *
 * Config precedence (highest → lowest):
 *   1. SMTP_URL env var  (smtp[s]://user:pass@host:port)
 *   2. Individual env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 *      SMTP_FROM, SMTP_SECURE)
 *   3. aquarium/CHANNELS/comms_config.json  → { email: { … } }
 *
 * The transport is created lazily on the first send() so servers that
 * never touch email pay nothing.
 *
 * nodemailer is imported dynamically so the package is only required when
 * email is actually used — keeps cold-start light and avoids a hard
 * dependency for users who don't need it.
 */

const log = { info: (...a) => console.log('[EmailService]', ...a),
              warn: (...a) => console.warn('[EmailService]', ...a) };

class EmailService {
  constructor(rm) {
    this.rm = rm;
    this._transport = null;   // nodemailer.Transporter, cached
    this._configHash = null;  // to detect config changes → re-create
    this._fromCache  = null;
  }

  async _resolveConfig() {
    // Env-var URL takes precedence — one liner for CI / dev
    if (process.env.SMTP_URL) {
      return { url: process.env.SMTP_URL, from: process.env.SMTP_FROM || null, source: 'env:SMTP_URL' };
    }
    // Individual env vars
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      return {
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT || 587),
        secure: /^(1|true|yes)$/i.test(process.env.SMTP_SECURE || ''),
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
        from:   process.env.SMTP_FROM || process.env.SMTP_USER,
        source: 'env:SMTP_*',
      };
    }
    // Fall back to comms_config.json → email section
    try {
      this.rm.invalidateCache();
      const cfg = await this.rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      const e = cfg.email || {};
      // Mode 1: local sendmail binary (Postfix/Exim installed on this machine)
      //   { "transport": "sendmail", "from": "poseidon@yourhost" }
      if (e.transport === 'sendmail') {
        return { sendmail: true, from: e.from || 'squidmind@localhost', source: 'comms_config.json (sendmail)' };
      }
      if (!e.host) return null;
      // Mode 2: SMTP. Auth is OPTIONAL — a local open-source MTA (Postfix on
      // 127.0.0.1:25) accepts mail from localhost without credentials.
      return {
        host:   e.host,
        port:   Number(e.port || 587),
        secure: !!e.secure,
        ...(e.user ? { auth: { user: e.user, pass: e.pass || '' } } : {}),
        from:   e.from || e.user || 'squidmind@localhost',
        source: 'comms_config.json',
      };
    } catch { return null; }
  }

  async _getTransport() {
    const cfg = await this._resolveConfig();
    if (!cfg) throw new Error(
      'Email not configured. Open COMMS → SMTP tab to set it up (Gmail: app password required), ' +
      'or set the SMTP_URL env var.'
    );
    // Hash to detect config drift so we don't hold a stale transport
    const hash = JSON.stringify(cfg);
    if (this._transport && this._configHash === hash) return { transport: this._transport, from: this._fromCache };

    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch { throw new Error('nodemailer not installed. Run: npm install nodemailer'); }

    const transport = cfg.sendmail
      ? nodemailer.createTransport({ sendmail: true, newline: 'unix', path: '/usr/sbin/sendmail' })
      : cfg.url
        ? nodemailer.createTransport(cfg.url)
        : nodemailer.createTransport({
            host: cfg.host, port: cfg.port, secure: cfg.secure,
            ...(cfg.auth ? { auth: cfg.auth } : {}),
          });
    this._transport  = transport;
    this._configHash = hash;
    this._fromCache  = cfg.from;
    log.info(`transport created from ${cfg.source}`);
    return { transport, from: cfg.from };
  }

  /**
   * Send an email.
   * @param {{ to:string|string[], subject:string, body:string, html?:string,
   *           cc?:string|string[], bcc?:string|string[], attachments?:Array,
   *           from?:string }} args
   * @returns {Promise<{ok:boolean, messageId?:string, error?:string, accepted?:string[], rejected?:string[]}>}
   */
  async send({ to, subject, body, html, cc, bcc, attachments, from }) {
    if (!to)      return { ok: false, error: '"to" is required' };
    if (!subject) return { ok: false, error: '"subject" is required' };
    if (!body && !html) return { ok: false, error: '"body" (text) or "html" is required' };

    try {
      const { transport, from: defaultFrom } = await this._getTransport();
      const info = await transport.sendMail({
        from:    from || defaultFrom,
        to, cc, bcc,
        subject,
        text:    body || undefined,
        html:    html || undefined,
        attachments,
      });
      return {
        ok: true,
        messageId: info.messageId,
        accepted:  info.accepted,
        rejected:  info.rejected,
        response:  info.response,
      };
    } catch (e) {
      // Auth failures need explicit guidance: without it the model tries to
      // "fix" credentials itself (inventing users/passwords via execute_bash,
      // exporting fake SMTP_* env vars) — none of which can ever work.
      if (/535|BadCredentials|Username and Password not accepted|Invalid login|auth/i.test(e.message)) {
        return {
          ok: false,
          error: `SMTP AUTHENTICATION FAILED: ${e.message.slice(0, 160)}. ` +
                 `DO NOT attempt to fix this yourself — do not invent credentials, do not set SMTP_* env vars, ` +
                 `do not retry with different usernames. The saved SMTP config is wrong and only the USER can fix it: ` +
                 `tell them to open COMMS → SMTP and either (a) for Gmail, use an App Password from ` +
                 `myaccount.google.com/apppasswords (normal passwords are rejected), or (b) click "Use local MTA preset" ` +
                 `if they run Postfix locally. Then stop.`,
        };
      }
      // Local MTA configured but not running/installed
      if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(e.message) && /127\.0\.0\.1|localhost/i.test(e.message)) {
        return {
          ok: false,
          error: `LOCAL MTA UNREACHABLE: ${e.message.slice(0, 120)}. The config points at a local mail server ` +
                 `(Postfix) that isn't running. DO NOT try to fix it yourself — tell the user to run: ` +
                 `"./start.sh --with-mail" (installs Postfix) or "sudo systemctl start postfix" if installed. Then stop.`,
        };
      }
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { EmailService };
