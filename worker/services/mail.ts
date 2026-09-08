/**
 * Transactional email via Cloudflare Email Sending.
 *
 * This is a Worker binding rather than an HTTP API, so there is no key to
 * store, rotate, or leak — `send_email` in wrangler.jsonc is the whole
 * credential story. The sending domain (ffhistorian.com) is onboarded to Email
 * Sending, which is what authorises the `from` address.
 *
 * Set MAIL_TRANSPORT=console to print messages instead of sending them; local
 * development uses that so building the auth flow never emails real people.
 * Everything funnels through this one function, so swapping providers stays a
 * single-file change.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, msg: EmailMessage): Promise<void> {
  if (env.MAIL_TRANSPORT === "console" || !env.EMAIL) {
    console.log(
      `\n[mail:console] to=${msg.to}\nsubject: ${msg.subject}\n${msg.text}\n`,
    );
    return;
  }

  await env.EMAIL.send({
    to: msg.to,
    from: { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME },
    subject: msg.subject,
    html: msg.html,
    // Always send a text part too: some clients show only that, and its
    // absence measurably worsens spam scoring.
    text: msg.text,
  });
}

function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b1020;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
<table role="presentation" style="max-width:520px;margin:0 auto;background:#141a2e;border-radius:14px;padding:32px;color:#e8ecf8">
<tr><td>
<h1 style="margin:0 0 16px;font-size:20px;color:#fff">${heading}</h1>
<div style="font-size:15px;line-height:1.6;color:#b6c0da">${body}</div>
${
  cta
    ? `<p style="margin:28px 0 8px"><a href="${cta.url}" style="display:inline-block;background:#3b6ef5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;font-size:15px">${cta.label}</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#7b86a3;word-break:break-all">Or paste this into your browser:<br>${cta.url}</p>`
    : ""
}
</td></tr></table></body></html>`;
}

export function magicLinkEmail(url: string, isNew: boolean): Omit<EmailMessage, "to"> {
  const heading = isNew ? "Welcome to UCL Pick'em" : "Your sign-in link";
  const body = isNew
    ? "Tap below to create your account and start making picks. This link works once and expires in 15 minutes."
    : "Tap below to sign in. This link works once and expires in 15 minutes.";
  return {
    subject: heading,
    html: layout(heading, body, { label: isNew ? "Create my account" : "Sign in", url }),
    text: `${body}\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
  };
}

export function passwordResetEmail(url: string): Omit<EmailMessage, "to"> {
  const body =
    "Tap below to choose a new password. This link works once and expires in 15 minutes. Your current password stays active until you set a new one.";
  return {
    subject: "Reset your password",
    html: layout("Reset your password", body, { label: "Choose a new password", url }),
    text: `${body}\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
  };
}
