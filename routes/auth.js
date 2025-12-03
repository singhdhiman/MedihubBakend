const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);
router.post("/forgot-password", authController.forgotPassword);
router.get("/verify-reset-token", authController.verifyResetToken);
router.post("/reset-password", authController.resetPassword);
// email verification
router.post(
  "/send-verification",
  authController.sendVerificationEmailController
);
// OR allow by email without auth: router.post("/send-verification", sendVerificationEmailController);
router.get("/verify-email", authController.verifyEmailController);
router.post(
  "/resend-verification",
  authController.resendVerificationEmailController
);

module.exports = router;
