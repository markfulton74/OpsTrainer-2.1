// ============================================
// OpsTrainer 2.1 — Email Service
// Handles password reset and notifications
// ============================================
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.opstrainer.co.za',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || 'support@opstrainer.co.za',
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: '"OpsTrainer" <support@opstrainer.co.za>',
      to, subject, html
    });
    console.log('Email sent to ' + to);
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

function passwordResetEmail(resetUrl, fullName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <style>
        body { font-family: Inter, Arial, sans-serif; background: #f9fafb; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
        .header { background: linear-gradient(135deg, #0f172a 0%, #1a56db 100%); padding: 32px 40px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px; }
        .header p { color: rgba(255,255,255,0.7); font-size: 13px; margin: 4px 0 0; }
        .body { padding: 40px; }
        .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
        .btn { display: block; width: fit-content; margin: 24px auto; background: #1a56db; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; }
        .footer { padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align: center; }
        .footer p { color: #9ca3af; font-size: 12px; margin: 0; }
        .code { background: #f3f4f6; border-radius: 6px; padding: 12px 20px; text-align: center; font-size: 13px; color: #6b7280; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✦ OpsTrainer</h1>
          <p>Lead the way</p>
        </div>
        <div class="body">
          <p>Hi ${fullName},</p>
          <p>We received a request to reset your OpsTrainer password. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" class="btn">Reset My Password</a>
          <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
          <div class="code">If the button doesn't work, copy this link:<br/><br/>${resetUrl}</div>
        </div>
        <div class="footer">
          <p>OpsTrainer · support@opstrainer.co.za · opstrainer.co.za</p>
          <p style="margin-top:4px">The world's first Operational Intelligence system for humanitarian deployment.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function certificateEmail(fullName, courseName, certificateNumber, verifyUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <style>
        body { font-family: Inter, Arial, sans-serif; background: #f9fafb; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
        .header { background: linear-gradient(135deg, #0f172a 0%, #1a56db 100%); padding: 32px 40px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; }
        .header p { color: rgba(255,255,255,0.7); font-size: 13px; margin: 4px 0 0; }
        .body { padding: 40px; }
        .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
        .cert-box { background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0; }
        .cert-box .trophy { font-size: 48px; margin-bottom: 8px; }
        .cert-box h2 { font-size: 18px; font-weight: 800; color: #111827; margin: 0 0 4px; }
        .cert-box p { color: #6b7280; font-size: 13px; margin: 0; }
        .cert-number { font-family: monospace; font-size: 14px; font-weight: 700; color: #1a56db; margin-top: 8px; }
        .btn { display: block; width: fit-content; margin: 24px auto; background: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; }
        .footer { padding: 20px 40px; border-top: 1px solid #e5e7eb; text-align: center; }
        .footer p { color: #9ca3af; font-size: 12px; margin: 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✦ OpsTrainer</h1>
          <p>Lead the way</p>
        </div>
        <div class="body">
          <p>Congratulations ${fullName}!</p>
          <p>You have successfully completed <strong>${courseName}</strong> and earned your OpsTrainer certificate.</p>
          <div class="cert-box">
            <div class="trophy">🏆</div>
            <h2>${courseName}</h2>
            <p>Certificate of Achievement</p>
            <div class="cert-number">${certificateNumber}</div>
          </div>
          <p>Your certificate is available for download in your OpsTrainer account under <strong>My Certificates</strong>.</p>
          <a href="${verifyUrl}" class="btn">View & Verify Certificate</a>
        </div>
        <div class="footer">
          <p>OpsTrainer · support@opstrainer.co.za · opstrainer.co.za</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { sendEmail, passwordResetEmail, certificateEmail };

