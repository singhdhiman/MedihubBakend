const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const PaymentLogSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", index: true },
    subscriptionId: { type: ObjectId, ref: "Subscription" },
    type: {
      type: String,
      enum: ["one_time", "subscription", "invoice", "refund", "charge"],
      required: true,
    },
    amountCents: { type: Number },
    currency: { type: String },
    stripeEventId: { type: String }, // event id or charge id from Stripe
    stripeChargeId: { type: String },
    stripeInvoiceId: { type: String },
    stripeCheckoutSessionId: { type: String },
    status: {
      type: String,
      enum: ["succeeded", "failed", "pending", "refunded"],
      default: "pending",
    },
    raw: { type: Schema.Types.Mixed }, // store some raw Stripe payload for debugging
  },
  { timestamps: true }
);

PaymentLogSchema.index({ userId: 1, subscriptionId: 1 });
module.exports = mongoose.model("PaymentLog", PaymentLogSchema);
