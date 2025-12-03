// controllers/auth.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/UserSchema");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require("../utils/token");
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("../utils/email");

const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

/* -------------------- AUTH: REGISTER -------------------- */
async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashed,
      role,
    });

    // Non-blocking: send verification email
    issueAndSendEmailVerification(user).catch((e) =>
      console.warn("Verification email send failed:", e?.message || e)
    );

    return res.status(201).json({ message: "User created", userId: user._id });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- AUTH: LOGIN -------------------- */
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const accessToken = signAccessToken({
      userId: user._id,
      email: user.email,
    });
    const refreshToken = signRefreshToken({ userId: user._id });

    user.refreshToken = refreshToken;
    await user.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    return res.json({ accessToken });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- AUTH: REFRESH TOKEN -------------------- */
async function refreshToken(req, res) {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (!token) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const user = await User.findById(payload.userId);
    if (!user || !user.refreshToken) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }
    if (user.refreshToken !== token) {
      return res.status(403).json({ message: "Token mismatch" });
    }

    const newAccess = signAccessToken({ userId: user._id, email: user.email });
    const newRefresh = signRefreshToken({ userId: user._id });

    user.refreshToken = newRefresh;
    await user.save();

    res.cookie("refreshToken", newRefresh, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return res.json({ accessToken: newAccess });
  } catch (err) {
    console.error("refreshToken error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- AUTH: LOGOUT -------------------- */
async function logout(req, res) {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await User.findByIdAndUpdate(payload.userId, {
          $unset: { refreshToken: 1 },
        });
      } catch {
        // ignore invalid token
      }
    }
    res.clearCookie("refreshToken");
    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- FORGOT PASSWORD -------------------- */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });

    // Always return same message to avoid enumeration
    if (!user) {
      return res.json({
        message:
          "If that email is registered, a password reset link has been sent.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await user.save();

    const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail({ to: user.email, resetUrl });

    return res.json({
      message:
        "If that email is registered, a password reset link has been sent.",
    });
  } catch (err) {
    console.error("forgotPassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* (Optional) Pre-validate reset token for UI */
async function verifyResetToken(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "Token is required" });

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token" });
    return res.json({ message: "Token is valid" });
  } catch (err) {
    console.error("verifyResetToken error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- RESET PASSWORD -------------------- */
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ message: "Token and newPassword are required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    // Force re-login on all devices
    user.refreshToken = undefined;

    await user.save();

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
    });

    return res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- EMAIL VERIFICATION HELPERS -------------------- */
async function issueAndSendEmailVerification(userDoc) {
  if (userDoc.isVerified) return; // already verified

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  userDoc.emailVerificationToken = hashedToken;
  userDoc.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await userDoc.save();

  const verifyUrl = `${APP_URL}/verify-email?token=${rawToken}`;
  await sendVerificationEmail({ to: userDoc.email, verifyUrl });
}

/* -------------------- SEND VERIFICATION (explicit) -------------------- */
async function sendVerificationEmailController(req, res) {
  try {
    const authUserId = req.user?.userId;
    const { email } = req.body || {};

    const user = authUserId
      ? await User.findById(authUserId)
      : await User.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.json({ message: "Email already verified" });

    await issueAndSendEmailVerification(user);
    return res.json({
      message: "Verification email sent if the account exists",
    });
  } catch (err) {
    console.error("sendVerificationEmailController error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- VERIFY EMAIL -------------------- */
async function verifyEmailController(req, res) {
  try {
    const token = req.query.token || req.body.token;
    if (!token) return res.status(400).json({ message: "Token is required" });

    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerificationToken: hashed,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token" });

    user.isVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    // Optionally auto sign-in after verification
    const accessToken = signAccessToken({
      userId: user._id,
      email: user.email,
    });
    const refreshToken = signRefreshToken({ userId: user._id });
    user.refreshToken = refreshToken;

    await user.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return res.json({ message: "Email verified successfully", accessToken });
  } catch (err) {
    console.error("verifyEmailController error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* -------------------- RESEND VERIFICATION -------------------- */
async function resendVerificationEmailController(req, res) {
  try {
    const authUserId = req.user?.userId;
    const { email } = req.body || {};

    const user = authUserId
      ? await User.findById(authUserId)
      : await User.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.json({ message: "Email already verified" });

    await issueAndSendEmailVerification(user);
    return res.json({
      message: "Verification email resent if the account exists",
    });
  } catch (err) {
    console.error("resendVerificationEmailController error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  sendVerificationEmailController,
  verifyEmailController,
  resendVerificationEmailController,
};
