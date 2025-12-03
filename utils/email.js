// utils/email.js
const { Resend } = require("resend");
const resend = new Resend("re_HgxzueVX_5Gp9xNCekGRYShmR4KdEjT9d");

async function sendVerificationEmail({ to, verifyUrl }) {
  await resend.emails.send({
    from: "Your App <onboarding@resend.dev>",
    to,
    subject: "Verify your email address",
    html: `<h2>Verify Your Email</h2>
           <p>Click below to verify:</p>
           <a href="${verifyUrl}" target="_blank">${verifyUrl}</a>`,
  });
  console.log(`[EMAIL SENT] Verification email sent to ${to}`);
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  await resend.emails.send({
    from: "Your App <onboarding@resend.dev>",
    to,
    subject: "Reset your password",
    html: `<h2>Reset Your Password</h2>
           <p>Click below to reset it:</p>
           <a href="${resetUrl}" target="_blank">${resetUrl}</a>`,
  });
  console.log(`[EMAIL SENT] Password reset email sent to ${to}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
