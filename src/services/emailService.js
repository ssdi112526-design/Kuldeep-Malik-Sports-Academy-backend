import { Resend } from 'resend';

let resendClient;

function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
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
    ['Company', contact.organisation || '-'],
    ['Service Required', contact.serviceRequired],
    ['Message', contact.message],
    ['Date & Time', submittedAt],
    ['IP Address', ip],
  ];

  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 14px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#0f172a;width:160px;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;border:1px solid #e2e8f0;color:#1e293b;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:20px 24px;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;">New Form Submission Received</h1>
        <p style="margin:4px 0 0;color:#eff6ff;font-size:13px;">Kartik Repossession Agency &mdash; Website Contact Form</p>
      </div>
      <div style="padding:20px 24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${rowsHtml}
        </table>
        <p style="margin-top:20px;font-size:12px;color:#64748b;">
          This is an automated notification. Log in to the admin dashboard to view and manage this submission.
        </p>
      </div>
    </div>
  </div>`;
}

export async function sendNewContactNotification(contact, req) {
  try {
    const to = process.env.ADMIN_EMAIL;
    if (!to) {
      console.error('ADMIN_EMAIL is not configured — skipping contact notification');
      return;
    }

    const from =
      process.env.RESEND_FROM ||
      'Kartik Repossession Agency <onboarding@resend.dev>';
    const ip = getClientIp(req);
    const submittedAt = formatIST(contact.createdAt || new Date());

    const { error } = await getResend().emails.send({
      from,
      to: [to],
      subject: 'New Form Submission Received',
      html: buildEmailHtml(contact, ip, submittedAt),
    });

    if (error) {
      console.error('Failed to send contact notification email:', error.message || error);
    }
  } catch (error) {
    console.error('Failed to send contact notification email:', error.message);
  }
}
