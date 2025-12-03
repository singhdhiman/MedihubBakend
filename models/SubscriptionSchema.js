const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const SubscriptionSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true }, // who owns this subscription
    planId: { type: ObjectId, ref: "SubscriptionPlan", required: true }, // which plan was purchased
    stripeSubscriptionId: { type: String, index: true }, // Stripe subscription id (sub_xxx)
    stripePriceId: { type: String }, // Stripe Price id used for billing
    status: {
      type: String,
      enum: [
        "active",
        "past_due",
        "canceled",
        "trialing",
        "incomplete",
        "unpaid",
        "trial_ended",
      ],
      default: "trialing",
    }, // reflect Stripe status
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date },
    trialStart: { type: Date },
    trialEnd: { type: Date },
    billingCycleAnchor: { type: Date }, // optional: when cycle anchors (useful for proration)
    metadata: { type: Schema.Types.Mixed }, // any app-specific flags (e.g., allowedFeaturedCount)
  },
  { timestamps: true }
);

SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ stripeSubscriptionId: 1 });
module.exports = mongoose.model("Subscription", SubscriptionSchema);
