const mongoose = require("mongoose");
const { Schema } = mongoose;

const SubscriptionPlanSchema = new Schema(
  {
    name: { type: String, required: true }, // human name e.g. "Pro Monthly"
    slug: { type: String, required: true, unique: true }, // url-friendly key e.g. "pro-monthly"
    description: { type: String }, // short description shown to users
    priceCents: { type: Number, required: true }, // price in cents/paise (avoid floats)
    currency: { type: String, required: true, default: "usd" }, // 'usd' | 'inr' etc.
    billingInterval: {
      type: String,
      enum: ["month", "year", "once", "day"],
      default: "month",
    },
    stripePriceId: { type: String }, // Stripe Price ID (if created in Stripe)
    features: [{ type: String }], // array of strings describing plan features
    trialDays: { type: Number, default: 0 }, // optional trial length
    isActive: { type: Boolean, default: true }, // soft toggle to show/hide plan
    metadata: { type: Schema.Types.Mixed }, // free-form data you might need
  },
  { timestamps: true }
);

SubscriptionPlanSchema.index({ slug: 1 });
module.exports = mongoose.model("SubscriptionPlan", SubscriptionPlanSchema);
