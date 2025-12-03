// routes/subscriptionRoutes.js
const express = require("express");
const subscriptionController = require("../controllers/subscriptionController");
const router = express.Router();

// No auth middleware needed — we use userId from payload for testing

// Public
router.get("/plans", subscriptionController.listPlans);

// Admin Plan Management
router.post("/admin/plans", subscriptionController.createPlan);
router.put("/admin/plans/:id", subscriptionController.updatePlan);
router.delete("/admin/plans/:id", subscriptionController.deletePlan);

// User subscription flow
router.post("/subscribe", subscriptionController.createCheckoutSession);
router.get("/my-subscription", subscriptionController.getMySubscription);
router.post("/subscription/cancel", subscriptionController.cancelSubscription);
router.post("/subscription/change-plan", subscriptionController.changePlan);

router.get(
  "/subscriptions/history",
  subscriptionController.getSubscriptionHistory
); // ?userId=&page=&limit=&status=
router.get("/payments/history", subscriptionController.getPaymentHistory); // ?userId=&page=&limit=&type=&status=

// Stripe Webhook (raw body handled in server.js)
router.post("/webhooks/stripe", subscriptionController.handleStripeWebhookRaw);

router.post("/subscribe/resume", subscriptionController.resumeCheckoutSession);

module.exports = router;
