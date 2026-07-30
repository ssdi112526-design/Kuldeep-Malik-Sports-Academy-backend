import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const BRAND_NAME = 'Raghunandan Akhada';

let resendClient;
let gmailTransporter;

function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) return null;
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function getGmailTransporter() {
  if (gmailTransporter) return gmailTransporter;

  const user = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  const pass = (process.env.APP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, '');

  if (!user || !pass) return null;

  gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return gmailTransporter;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'Unknown';
}

function formatIST(date) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailHtml(contact, ip, submittedAt) {
  const rows = [
    ['Full Name', contact.fullName],
    ['Email', contact.email],
    ['Phone', contact.phone || '-'],
    ['PAN Number', contact.panNumber || '-'],
    ['Aadhaar Number', contact.aadhaarNumber || '-'],
    ['Message', contact.message],
    ['Date & Time', submittedAt],
    ['IP Address', ip],
  ];

  if (contact.organisation) {
    rows.splice(5, 0, ['Organisation', contact.organisation]);
  }
  if (contact.serviceRequired && contact.serviceRequired !== 'General Inquiry') {
    rows.splice(contact.organisation ? 6 : 5, 0, ['Inquiry Type', contact.serviceRequired]);
  }

  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 14px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#0f172a;width:160px;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;border:1px solid #e2e8f0;color:#1e293b;white-space:pre-wrap;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#2563EB,#1D4ED8);padding:20px 24px;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;">${escapeHtml(BRAND_NAME)}</h1>
        <p style="margin:4px 0 0;color:#eff6ff;font-size:13px;">New website contact form submission</p>
      </div>
      <div style="padding:20px 24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${rowsHtml}
        </table>
        <p style="margin-top:20px;font-size:12px;color:#64748b;">
          This is an automated notification from ${escapeHtml(BRAND_NAME)}. Log in to the admin dashboard to manage this inquiry.
        </p>
      </div>
    </div>
  </div>`;
}

async function sendViaGmail({ to, subject, html, replyTo }) {
  const transporter = getGmailTransporter();
  if (!transporter) return false;

  const user = process.env.ADMIN_EMAIL || process.env.SMTP_USER;

  await transporter.sendMail({
    from: {
      name: BRAND_NAME,
      address: user,
    },
    to,
    replyTo,
    subject,
    html,
    // Helps some clients show brand name instead of collapsing to "me"
    headers: {
      'X-Entity-Ref-ID': `akhada-contact-${Date.now()}`,
    },
  });
  return true;
}

async function sendViaResend({ to, subject, html, replyTo }) {
  const resend = getResend();
  if (!resend) return false;

  const from =
    process.env.RESEND_FROM || `${BRAND_NAME} <onboarding@resend.dev>`;

  const { error } = await resend.emails.send({
    from,
    to: [to],
    reply_to: replyTo,
    subject,
    html,
  });

  if (error) {
    throw new Error(error.message || String(error));
  }
  return true;
}

/**
 * Notify admin when a contact form is submitted.
 * Prefers Resend so inbox shows "Raghunandan Akhada" (not Gmail "me").
 * Falls back to Gmail SMTP.
 */
export async function sendNewContactNotification(contact, req) {
  try {
    const to = process.env.ADMIN_EMAIL;
    if (!to) {
      console.error('ADMIN_EMAIL is not configured — skipping contact notification');
      return;
    }

    const ip = getClientIp(req);
    const submittedAt = formatIST(contact.createdAt || new Date());
    const html = buildEmailHtml(contact, ip, submittedAt);
    const subject = `${BRAND_NAME}: New inquiry from ${contact.fullName || 'Website visitor'}`;
    const replyTo = contact.email || undefined;

    let sent = false;

    // Resend first — branded sender name shows correctly in Gmail
    try {
      sent = await sendViaResend({ to, subject, html, replyTo });
      if (sent) {
        console.log(`Contact notification emailed to ${to} via Resend (${BRAND_NAME})`);
      }
    } catch (resendErr) {
      console.error('Resend send failed, trying Gmail:', resendErr.message);
    }

    if (!sent) {
      sent = await sendViaGmail({ to, subject, html, replyTo });
      if (sent) {
        console.log(`Contact notification emailed to ${to} via Gmail (${BRAND_NAME})`);
      }
    }

    if (!sent) {
      console.error(
        'No email transport configured. Set RESEND_API_KEY or APP_PASSWORD (Gmail).'
      );
    }
  } catch (error) {
    console.error('Failed to send contact notification email:', error.message);
  }
}
