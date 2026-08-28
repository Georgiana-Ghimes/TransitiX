const RESEND_URL = 'https://api.resend.com/emails';

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Send email via Resend when configured; otherwise log to console (local/dev).
 * Never throws on stub path. Returns { ok, stub?, id? }.
 */
function resendAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((file) => ({
    filename: file.filename || 'attachment',
    content: Buffer.isBuffer(file.content)
      ? file.content.toString('base64')
      : String(file.content || ''),
  }));
}

export async function sendEmail({ to, subject, text, html, attachments } = {}) {
  const recipient = String(to || '').trim();
  if (!recipient || !subject) {
    return { ok: false, message: 'Completează destinatarul și subiectul.' };
  }

  if (!emailConfigured()) {
    console.log('[email stub]', {
      to: recipient,
      subject,
      body: String(text || html || '').slice(0, 300),
      attachments: Array.isArray(attachments) ? attachments.map((a) => a.filename) : [],
    });
    return { ok: true, stub: true, message: 'Emailul a fost înregistrat pe server (serviciul de email nu este configurat).' };
  }

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [recipient],
      subject,
      text: text || undefined,
      html: html || undefined,
      attachments: resendAttachments(attachments),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || res.statusText || 'Resend request failed';
    console.error('[email resend]', message);
    throw new Error(message);
  }

  return { ok: true, stub: false, id: data.id || null };
}
