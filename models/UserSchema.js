// models/UserSchema.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    refreshToken: { type: String },
    role: { type: String, default: "user" },
    isVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },

    // Email verification
    emailVerificationToken: { type: String, index: true },
    emailVerificationExpires: { type: Date },
    emailVerifiedAt: { type: Date },

    // Forgot password fields
    passwordResetToken: { type: String, index: true },
    passwordResetExpires: { type: Date },
    passwordChangedAt: { type: Date },

    stripeCustomerId: { type: String, index: true },
    currentSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
    },
  },
  { timestamps: true }
);

// optional: mark passwordChangedAt whenever password is modified
UserSchema.pre("save", function (next) {
  if (!this.isModified("password")) return next();
  this.passwordChangedAt = new Date();
  next();
});

module.exports = mongoose.model("User", UserSchema);
