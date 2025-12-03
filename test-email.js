require("dotenv").config();
const { sendVerificationEmail } = require("./utils/email");

async function run() {
  try {
    const info = await sendVerificationEmail({
      to: "idhiman666@gmail.com",
      verifyUrl: "https://yourapp.test/verify?token=abc123",
    });
    console.log("Resend response:", info);
  } catch (err) {
    console.error("send error:", err);
  }
}

run();
