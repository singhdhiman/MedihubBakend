// controllers/subscriptionController.js
const Stripe = require("stripe");
const mongoose = require("mongoose");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const User = require("../models/UserSchema");
const SubscriptionPlan = require("../models/SubscriptionPlanSchema");
const Subscription = require("../models/SubscriptionSchema");
const PaymentLog = require("../models/PaymentLogSchema");

const subscriptionController = {
  // ---------- Plans ----------
  async listPlans(req, res) {
    try {
      const plans = await SubscriptionPlan.find({ isActive: true }).lean();
      return res.json({ ok: true, plans });
    } catch (err) {
      console.error("listPlans error", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async createPlan(req, res) {
    try {
      const {
        name,
        slug,
        description,
        priceCents,
        currency = "usd",
        billingInterval = "month",
        createStripe = false,
        features = [],
        trialDays = 0,
      } = req.body;

      if (!name || !slug || !priceCents) {
        return res.status(400).json({ ok: false, error: "Missing fields" });
      }

      const plan = new SubscriptionPlan({
        name,
        slug,
        description,
        priceCents,
        currency,
        billingInterval,
        features,
        trialDays,
      });

      if (createStripe) {
        const product = await stripe.products.create({
          name,
          metadata: { slug },
        });
        const price = await stripe.prices.create({
          unit_amount: priceCents,
          currency,
          recurring:
            billingInterval === "once"
              ? undefined
              : { interval: billingInterval },
          product: product.id,
        });
        plan.stripePriceId = price.id;
      }

      await plan.save();
      return res.json({ ok: true, plan });
    } catch (err) {
      console.error("createPlan err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async updatePlan(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const plan = await SubscriptionPlan.findByIdAndUpdate(id, updates, {
        new: true,
      });
      if (!plan) return res.status(404).json({ ok: false, error: "Not found" });
      return res.json({ ok: true, plan });
    } catch (err) {
      console.error("updatePlan err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async deletePlan(req, res) {
    try {
      const { id } = req.params;
      const plan = await SubscriptionPlan.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );
      if (!plan) return res.status(404).json({ ok: false, error: "Not found" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("deletePlan err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  // ---------- Checkout & resume ----------
  async createCheckoutSession(req, res) {
    try {
      const { userId, planId, successUrl, cancelUrl } = req.body;
      if (!userId || !planId)
        return res
          .status(400)
          .json({ ok: false, error: "userId and planId required" });

      const user = await User.findById(userId);
      if (!user)
        return res.status(404).json({ ok: false, error: "User not found" });

      const plan = await SubscriptionPlan.findById(planId);
      if (!plan)
        return res.status(404).json({ ok: false, error: "Plan not found" });
      if (!plan.stripePriceId)
        return res
          .status(500)
          .json({ ok: false, error: "Plan missing stripePriceId" });

      // prevent duplicate active purchase
      const existingActive = await Subscription.findOne({
        userId: user._id,
        planId: plan._id,
        status: { $in: ["active", "trialing", "past_due"] },
      });
      if (existingActive) {
        return res.status(400).json({
          ok: false,
          error: "User already has an active subscription for this plan",
        });
      }

      const pendingLog = await PaymentLog.findOne({
        userId: user._id,
        type: "subscription",
        status: "pending",
        "raw.session.metadata.planId": plan._id.toString(),
      }).sort({ createdAt: -1 });

      if (pendingLog && pendingLog.stripeCheckoutSessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(
            pendingLog.stripeCheckoutSessionId
          );
          if (session && session.url)
            return res.json({
              ok: true,
              url: session.url,
              sessionId: session.id,
              reused: true,
            });
        } catch (e) {
          console.warn("previous session invalid - creating new");
        }
      }

      const customerId = await ensureStripeCustomer(user);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        customer: customerId,
        success_url:
          (successUrl || process.env.APP_URL || "http://localhost:3000") +
          "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url:
          (cancelUrl || process.env.APP_URL || "http://localhost:3000") +
          "/cancel",
        subscription_data: {
          metadata: {
            userId: user._id.toString(),
            planId: plan._id.toString(),
          },
          trial_period_days:
            plan.trialDays && plan.trialDays > 0 ? plan.trialDays : undefined,
        },
      });

      // Create pending PaymentLog (single source for pending checkout)
      await PaymentLog.updateOne(
        { stripeCheckoutSessionId: session.id },
        {
          $setOnInsert: {
            userId: user._id,
            stripeCheckoutSessionId: session.id,
            type: "subscription",
            status: "pending",
            amountCents: plan.priceCents,
            currency: plan.currency,
            raw: { session },
          },
        },
        { upsert: true }
      );

      return res.json({
        ok: true,
        url: session.url,
        sessionId: session.id,
        reused: false,
      });
    } catch (err) {
      console.error("createCheckoutSession err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async resumeCheckoutSession(req, res) {
    try {
      const { userId, planId, successUrl, cancelUrl } = req.body;
      if (!userId || !planId)
        return res
          .status(400)
          .json({ ok: false, error: "userId and planId required" });

      const user = await User.findById(userId);
      if (!user)
        return res.status(404).json({ ok: false, error: "User not found" });

      const plan = await SubscriptionPlan.findById(planId);
      if (!plan)
        return res.status(404).json({ ok: false, error: "Plan not found" });
      if (!plan.stripePriceId)
        return res
          .status(500)
          .json({ ok: false, error: "Plan missing stripePriceId" });

      const existingActive = await Subscription.findOne({
        userId: user._id,
        planId: plan._id,
        status: { $in: ["active", "trialing", "past_due"] },
      });
      if (existingActive)
        return res.status(400).json({
          ok: false,
          error: "User already has an active subscription for this plan",
        });

      const pending = await PaymentLog.findOne({
        userId: user._id,
        type: "subscription",
        status: "pending",
        "raw.session.metadata.planId": plan._id.toString(),
      }).sort({ createdAt: -1 });

      if (pending && pending.stripeCheckoutSessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(
            pending.stripeCheckoutSessionId
          );
          if (session && session.url)
            return res.json({
              ok: true,
              url: session.url,
              sessionId: session.id,
              reused: true,
            });
        } catch (e) {
          console.warn("Old session invalid - creating new");
        }
      }

      const customerId = await ensureStripeCustomer(user);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        customer: customerId,
        success_url:
          (successUrl || process.env.APP_URL || "http://localhost:3000") +
          "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url:
          (cancelUrl || process.env.APP_URL || "http://localhost:3000") +
          "/cancel",
        subscription_data: {
          metadata: {
            userId: user._id.toString(),
            planId: plan._id.toString(),
          },
          trial_period_days:
            plan.trialDays && plan.trialDays > 0 ? plan.trialDays : undefined,
        },
      });

      await PaymentLog.updateOne(
        {
          userId: user._id,
          type: "subscription",
          status: "pending",
          "raw.session.metadata.planId": plan._id.toString(),
        },
        {
          $set: {
            stripeCheckoutSessionId: session.id,
            amountCents: plan.priceCents,
            currency: plan.currency,
            raw: { session },
          },
          $setOnInsert: {
            userId: user._id,
            type: "subscription",
            status: "pending",
          },
        },
        { upsert: true }
      );

      return res.json({
        ok: true,
        url: session.url,
        sessionId: session.id,
        reused: false,
      });
    } catch (err) {
      console.error("resumeCheckoutSession err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  // ---------- Subscriptions & cancel/change ----------
  async getMySubscription(req, res) {
    try {
      const userId = req.query.userId || req.body.userId;
      if (!userId)
        return res.status(400).json({ ok: false, error: "userId required" });

      const subscription = await Subscription.findOne({ userId })
        .sort({ createdAt: -1 })
        .populate("planId")
        .lean();

      return res.json({ ok: true, subscription });
    } catch (err) {
      console.error("getMySubscription err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async cancelSubscription(req, res) {
    try {
      const { userId, cancelNow = false } = req.body;
      if (!userId)
        return res.status(400).json({ ok: false, error: "userId required" });

      const subs = await Subscription.findOne({
        userId,
        status: { $in: ["active", "trialing", "past_due"] },
      }).sort({ createdAt: -1 });

      if (!subs)
        return res
          .status(404)
          .json({ ok: false, error: "No active subscription" });

      if (!subs.stripeSubscriptionId) {
        subs.status = "canceled";
        subs.canceledAt = new Date();
        subs.cancelAtPeriodEnd = false;
        await subs.save();
        return res.json({ ok: true, subscription: subs });
      }

      if (cancelNow) {
        await stripe.subscriptions.del(subs.stripeSubscriptionId);
        subs.status = "canceled";
        subs.canceledAt = new Date();
        subs.cancelAtPeriodEnd = false;
      } else {
        await stripe.subscriptions.update(subs.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        subs.cancelAtPeriodEnd = true;
      }

      await subs.save();
      await User.findByIdAndUpdate(userId, {
        $unset: { currentSubscriptionId: 1 },
      });

      return res.json({ ok: true, subscription: subs });
    } catch (err) {
      console.error("cancelSubscription err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  async changePlan(req, res) {
    try {
      const { userId, newPlanId, proration = true } = req.body;
      if (!userId || !newPlanId)
        return res
          .status(400)
          .json({ ok: false, error: "userId and newPlanId required" });

      const newPlan = await SubscriptionPlan.findById(newPlanId);
      if (!newPlan)
        return res.status(404).json({ ok: false, error: "Plan not found" });
      if (!newPlan.stripePriceId)
        return res
          .status(500)
          .json({ ok: false, error: "New plan missing stripePriceId" });

      const subs = await Subscription.findOne({
        userId,
        status: { $in: ["active", "trialing", "past_due"] },
      }).sort({ createdAt: -1 });
      if (!subs)
        return res
          .status(404)
          .json({ ok: false, error: "No active subscription" });

      const stripeSub = await stripe.subscriptions.retrieve(
        subs.stripeSubscriptionId
      );
      const item = stripeSub.items.data[0];

      const updated = await stripe.subscriptions.update(
        subs.stripeSubscriptionId,
        {
          proration_behavior: proration ? "create_prorations" : "none",
          items: [{ id: item.id, price: newPlan.stripePriceId, quantity: 1 }],
        }
      );

      subs.planId = newPlan._id;
      subs.stripePriceId = newPlan.stripePriceId;
      subs.currentPeriodStart = new Date(updated.current_period_start * 1000);
      subs.currentPeriodEnd = new Date(updated.current_period_end * 1000);
      subs.status = updated.status;
      await subs.save();

      return res.json({ ok: true, subscription: subs });
    } catch (err) {
      console.error("changePlan err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  // ---------- Webhook ----------
  async handleStripeWebhookRaw(req, res) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const sig = req.headers["stripe-signature"];
    const rawBody = req.rawBody || req.body;

    if (!rawBody) {
      console.error("Stripe webhook missing rawBody");
      return res.status(400).send("Missing raw body");
    }

    // normalize and canonicalize
    function normalizeType(t) {
      if (!t) return t;
      return t.replace(/_/g, "."); // underscores -> dots
    }
    function canonicalize(n) {
      if (!n) return n;
      // invoice payment variants -> invoice.paid
      const inv = new Set([
        "invoice.payment.paid",
        "invoice.payment.succeeded",
        "invoice_payment.paid",
        "invoice_payment.succeeded",
      ]);
      if (inv.has(n)) return "invoice.paid";
      // payment.intent.* -> payment_intent.<tail>
      if (n.startsWith("payment.intent.")) {
        const tail = n.split(".").pop();
        return `payment_intent.${tail}`;
      }
      if (n === "payment.method.attached" || n === "payment.method.attached")
        return "payment_method.attached";
      // leave others as normalized
      return n;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error(
        "Webhook signature verification failed.",
        err && err.message
      );
      return res.status(400).send(`Webhook Error: ${err && err.message}`);
    }

    const rawType = event.type;
    const normalized = normalizeType(rawType);
    const type = canonicalize(normalized);
    console.log(
      "Stripe webhook received:",
      rawType,
      "->",
      normalized,
      "->",
      type
    );

    // idempotency: if we've processed the exact Stripe event id before, skip full processing.
    try {
      const exists = await PaymentLog.findOne({ stripeEventId: event.id });
      if (exists) {
        console.log("Already processed event:", event.id);
        return res.json({ received: true, skipped: true });
      }
    } catch (e) {
      console.warn("Idempotency check error", e && e.message);
    }

    // helper: mark webhook event processed (one marker per event id)
    async function markWebhookEvent(evtId, meta = {}) {
      try {
        await PaymentLog.updateOne(
          { stripeEventId: evtId },
          {
            $setOnInsert: {
              stripeEventId: evtId,
              type: "webhook_event",
              status: "processed",
              raw: { ...meta },
            },
          },
          { upsert: true }
        );
      } catch (e) {
        console.warn("Error marking webhook event", e && e.message);
      }
    }

    // helper: update pending PaymentLog(s) by various identifiers (checkout session, invoice, stripe sub, charge)
    async function updatePendingLogs({
      sessionId,
      invoiceId,
      stripeSubId,
      stripeChargeId,
      userId,
      subscriptionId,
    }) {
      const or = [];
      if (sessionId) or.push({ stripeCheckoutSessionId: sessionId });
      if (invoiceId) or.push({ stripeInvoiceId: invoiceId });
      if (stripeSubId) or.push({ "raw.stripeSub.id": stripeSubId });
      if (stripeChargeId) or.push({ stripeChargeId: stripeChargeId });

      if (or.length === 0) return null;

      const update = { $set: { status: "succeeded" } };
      if (subscriptionId) update.$set.subscriptionId = subscriptionId;
      if (userId) update.$set.userId = userId;
      update.$unset = { stripeCheckoutSessionId: "" };

      try {
        const updated = await PaymentLog.findOneAndUpdate(
          { $or: or, status: "pending" },
          update,
          { new: true }
        );
        return updated;
      } catch (e) {
        console.warn("Error updating pending logs", e && e.message);
        return null;
      }
    }

    try {
      switch (type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          // Ensure pending exists for session
          await PaymentLog.updateOne(
            { stripeCheckoutSessionId: session.id },
            {
              $setOnInsert: {
                stripeCheckoutSessionId: session.id,
                userId: session.metadata?.userId || undefined,
                type: "subscription",
                status: "pending",
                amountCents: session.amount_total || undefined,
                currency: session.currency || undefined,
                raw: { session },
              },
            },
            { upsert: true }
          );

          // if subscription attached immediately, upsert it and link logs
          if (session.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(
              session.subscription,
              { expand: ["latest_invoice"] }
            );
            const subDoc = await upsertSubscriptionFromStripe(
              stripeSub,
              session,
              event.id
            );
            await updatePendingLogs({
              sessionId: session.id,
              stripeSubId: stripeSub.id,
              userId:
                subDoc && subDoc.userId ? subDoc.userId.toString() : undefined,
              subscriptionId: subDoc ? subDoc._id : undefined,
            });
          }

          await markWebhookEvent(event.id, {
            eventType: rawType,
            sessionId: session.id,
          });
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const stripeSub = event.data.object;
          const subDoc = await upsertSubscriptionFromStripe(
            stripeSub,
            null,
            event.id
          );
          await updatePendingLogs({
            stripeSubId: stripeSub.id,
            userId:
              subDoc && subDoc.userId ? subDoc.userId.toString() : undefined,
            subscriptionId: subDoc ? subDoc._id : undefined,
          });
          await markWebhookEvent(event.id, {
            eventType: rawType,
            stripeSubId: stripeSub.id,
          });
          break;
        }

        case "customer.subscription.deleted":
        case "customer.subscription.expired": {
          const stripeSub = event.data.object;
          try {
            const sub = await Subscription.findOne({
              stripeSubscriptionId: stripeSub.id,
            });
            if (sub) {
              sub.status = "canceled";
              sub.canceledAt = stripeSub.canceled_at
                ? new Date(stripeSub.canceled_at * 1000)
                : new Date();
              sub.cancelAtPeriodEnd = false;
              await sub.save();
              if (sub.userId) {
                await User.findByIdAndUpdate(sub.userId, {
                  $unset: { currentSubscriptionId: "" },
                });
              }
            }
          } catch (e) {
            console.warn("Error marking subscription canceled", e && e.message);
          }
          await markWebhookEvent(event.id, {
            eventType: rawType,
            stripeSubId: stripeSub.id,
          });
          break;
        }

        case "invoice.created":
        case "invoice.finalized": {
          // invoice lifecycle markers — do not create a full payment row here
          const invoice = event.data.object;
          await markWebhookEvent(event.id, {
            eventType: rawType,
            invoiceId: invoice.id,
          });
          break;
        }

        case "invoice.paid": {
          const invoice = event.data.object;
          // ensure subscription locally
          let subDoc = null;
          if (invoice.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(
              invoice.subscription,
              { expand: ["latest_invoice"] }
            );
            subDoc = await upsertSubscriptionFromStripe(
              stripeSub,
              null,
              event.id
            );
          }

          // 1) try to attach to pending by metadata userId+amount
          let updated = null;
          if (invoice.metadata && invoice.metadata.userId) {
            try {
              updated = await PaymentLog.findOneAndUpdate(
                {
                  userId: invoice.metadata.userId,
                  status: "pending",
                  amountCents: invoice.amount_paid || invoice.amount_due,
                },
                {
                  $set: {
                    status: "succeeded",
                    stripeInvoiceId: invoice.id,
                    subscriptionId: subDoc ? subDoc._id : undefined,
                    userId: invoice.metadata.userId,
                  },
                  $unset: { stripeCheckoutSessionId: "" },
                },
                { new: true }
              );
            } catch (e) {
              console.warn(
                "Error updating by invoice.metadata.userId",
                e && e.message
              );
            }
          }

          // 2) try to update any pending logs by invoiceId/stripeSubId
          if (!updated) {
            updated = await updatePendingLogs({
              invoiceId: invoice.id,
              stripeSubId: invoice.subscription,
              subscriptionId: subDoc ? subDoc._id : undefined,
            });
          }

          // 3) if still nothing matched, upsert a single invoice PaymentLog (one per invoice)
          if (!updated) {
            await PaymentLog.updateOne(
              { stripeInvoiceId: invoice.id },
              {
                $setOnInsert: {
                  stripeEventId: event.id,
                  stripeInvoiceId: invoice.id,
                  subscriptionId:
                    invoice.subscription || (subDoc ? subDoc._id : undefined),
                  userId: invoice.metadata?.userId || undefined,
                  type: "invoice",
                  amountCents: invoice.amount_paid || invoice.amount_due,
                  currency: invoice.currency,
                  status: "succeeded",
                  raw: { invoice },
                },
              },
              { upsert: true }
            );
          }

          await markWebhookEvent(event.id, {
            eventType: rawType,
            invoiceId: invoice.id,
          });
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(
              invoice.subscription
            );
            await upsertSubscriptionFromStripe(stripeSub, null, event.id);
          }

          // upsert a single invoice record marked failed (only one per invoice)
          await PaymentLog.updateOne(
            { stripeInvoiceId: invoice.id },
            {
              $setOnInsert: {
                stripeEventId: event.id,
                stripeInvoiceId: invoice.id,
                subscriptionId: invoice.subscription || undefined,
                userId: invoice.metadata?.userId || undefined,
                type: "invoice",
                amountCents: invoice.amount_due,
                currency: invoice.currency,
                status: "failed",
                raw: { invoice },
              },
            },
            { upsert: true }
          );

          await markWebhookEvent(event.id, {
            eventType: rawType,
            invoiceId: invoice.id,
          });
          break;
        }

        case "charge.succeeded": {
          const charge = event.data.object;
          // If charge belongs to an invoice, try to attach it to the invoice PaymentLog first
          if (charge.invoice) {
            try {
              const invoice = await stripe.invoices.retrieve(charge.invoice);
              // try to update any pending logs by invoice/sub
              let updated = await updatePendingLogs({
                invoiceId: invoice.id,
                stripeSubId: invoice.subscription,
                stripeChargeId: charge.id,
              });
              if (!updated) {
                // upsert one charge/invoice log
                await PaymentLog.updateOne(
                  { stripeChargeId: charge.id },
                  {
                    $setOnInsert: {
                      stripeEventId: event.id,
                      stripeChargeId: charge.id,
                      stripeInvoiceId: invoice.id || undefined,
                      userId: invoice.metadata?.userId || undefined,
                      type: "invoice",
                      amountCents: charge.amount,
                      currency: charge.currency,
                      status: "succeeded",
                      raw: { charge, invoice },
                    },
                  },
                  { upsert: true }
                );
              }
            } catch (e) {
              console.warn(
                "Error handling charge.succeeded invoice retrieval",
                e && e.message
              );
            }
          } else {
            // standalone charge - upsert by charge id only
            await PaymentLog.updateOne(
              { stripeChargeId: charge.id },
              {
                $setOnInsert: {
                  stripeEventId: event.id,
                  stripeChargeId: charge.id,
                  type: "charge",
                  amountCents: charge.amount,
                  currency: charge.currency,
                  status: "succeeded",
                  raw: { charge },
                },
              },
              { upsert: true }
            );
          }
          await markWebhookEvent(event.id, {
            eventType: rawType,
            chargeId: event.data.object.id,
          });
          break;
        }

        case "payment_method.attached":
        case "payment_intent.created":
        case "payment_intent.succeeded": {
          // low-level events — create only the idempotency marker, no payment rows
          await markWebhookEvent(event.id, { eventType: rawType });
          break;
        }

        default:
          console.log(
            "Unhandled-but-matched (shouldn't happen):",
            type,
            rawType
          );
          await markWebhookEvent(event.id, { eventType: rawType });
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err && err.message, err);
      return res.status(500).send("Server error");
    }
  },

  // ---------- Payment history ----------
  async getPaymentHistory(req, res) {
    try {
      const userId = (req.query.userId || req.body.userId || "")
        .toString()
        .trim();
      if (!userId)
        return res.status(400).json({ ok: false, error: "userId required" });
      if (!mongoose.isValidObjectId(userId))
        return res
          .status(400)
          .json({ ok: false, error: "userId is not a valid ObjectId" });

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(parseInt(req.query.limit || "20", 10), 200);
      const skip = (page - 1) * limit;

      const filters = { userId: new mongoose.Types.ObjectId(userId) };
      if (req.query.type) filters.type = req.query.type;
      if (req.query.status) filters.status = req.query.status;

      const [payments, total] = await Promise.all([
        PaymentLog.find(filters)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PaymentLog.countDocuments(filters),
      ]);

      return res.json({
        ok: true,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        payments,
      });
    } catch (err) {
      console.error("getPaymentHistory err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },

  // ---------- Subscription history ----------
  async getSubscriptionHistory(req, res) {
    try {
      const userId = (req.query.userId || req.body.userId || "")
        .toString()
        .trim();
      if (!userId)
        return res.status(400).json({ ok: false, error: "userId required" });
      if (!mongoose.isValidObjectId(userId))
        return res
          .status(400)
          .json({ ok: false, error: "userId is not a valid ObjectId" });

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(parseInt(req.query.limit || "20", 10), 200);
      const skip = (page - 1) * limit;

      const filters = { userId: new mongoose.Types.ObjectId(userId) };
      if (req.query.status) filters.status = req.query.status;

      const [subscriptions, total] = await Promise.all([
        Subscription.find(filters)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("planId")
          .lean(),
        Subscription.countDocuments(filters),
      ]);

      return res.json({
        ok: true,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        subscriptions,
      });
    } catch (err) {
      console.error("getSubscriptionHistory err", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  },
};

// ----------------- helpers -----------------
async function ensureStripeCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user._id.toString() },
  });
  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

async function upsertSubscriptionFromStripe(
  stripeSub,
  session = null,
  stripeEventId = null
) {
  const stripeSubscriptionId = stripeSub.id;
  const customerId = stripeSub.customer;
  const priceId =
    stripeSub.items &&
    stripeSub.items.data &&
    stripeSub.items.data[0] &&
    stripeSub.items.data[0].price &&
    stripeSub.items.data[0].price.id;

  // resolve user by stripeCustomerId, session metadata, or stripeSub.metadata
  let user = null;
  try {
    if (customerId) user = await User.findOne({ stripeCustomerId: customerId });
    if (!user && session && session.metadata && session.metadata.userId)
      user = await User.findById(session.metadata.userId);
    if (!user && stripeSub.metadata && stripeSub.metadata.userId)
      user = await User.findById(stripeSub.metadata.userId);
    if (
      !user &&
      session &&
      session.customer_details &&
      session.customer_details.email
    )
      user = await User.findOne({ email: session.customer_details.email });
  } catch (e) {
    console.warn(
      "Error resolving user in upsertSubscriptionFromStripe",
      e && e.message
    );
  }

  const plan = priceId
    ? await SubscriptionPlan.findOne({ stripePriceId: priceId })
    : null;

  const currentPeriodStart = stripeSub.current_period_start
    ? new Date(stripeSub.current_period_start * 1000)
    : undefined;
  const currentPeriodEnd = stripeSub.current_period_end
    ? new Date(stripeSub.current_period_end * 1000)
    : undefined;

  let sub = await Subscription.findOne({ stripeSubscriptionId });
  try {
    if (!sub) {
      sub = new Subscription({
        userId: user ? user._id : undefined,
        planId: plan ? plan._id : undefined,
        stripeSubscriptionId,
        stripePriceId: priceId,
        status: stripeSub.status,
        currentPeriodStart,
        currentPeriodEnd,
        trialStart: stripeSub.trial_start
          ? new Date(stripeSub.trial_start * 1000)
          : undefined,
        trialEnd: stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000)
          : undefined,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
        canceledAt: stripeSub.canceled_at
          ? new Date(stripeSub.canceled_at * 1000)
          : undefined,
      });
      await sub.save();
    } else {
      sub.stripePriceId = priceId || sub.stripePriceId;
      sub.status = stripeSub.status || sub.status;
      sub.currentPeriodStart = currentPeriodStart || sub.currentPeriodStart;
      sub.currentPeriodEnd = currentPeriodEnd || sub.currentPeriodEnd;
      if (stripeSub.cancel_at_period_end) sub.cancelAtPeriodEnd = true;
      if (stripeSub.canceled_at)
        sub.canceledAt = new Date(stripeSub.canceled_at * 1000);
      await sub.save();
    }
  } catch (err) {
    console.error(
      "upsertSubscriptionFromStripe save error:",
      err && err.message,
      { stripeSubscriptionId, userId: user ? user._id : undefined }
    );
    throw err;
  }

  // link the subscription to user if we resolved one
  if (user) {
    try {
      if (
        !user.currentSubscriptionId ||
        user.currentSubscriptionId.toString() !== sub._id.toString()
      ) {
        user.currentSubscriptionId = sub._id;
        await user.save();
      }
    } catch (e) {
      console.warn("Error linking subscription to user", e && e.message);
    }
  }

  return sub;
}

module.exports = subscriptionController;
