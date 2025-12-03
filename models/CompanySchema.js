// models/Company.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AddressSchema = new Schema(
  {
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    countryCode: { type: String, trim: true }, // e.g. "IN", "US", "UA"
  },
  { _id: false }
);

const CompanySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    typeOfActivity: { type: String, trim: true }, // e.g. "Public clinic"
    website: { type: String, trim: true },
    emails: [{ type: String, lowercase: true, trim: true }],
    phones: [{ type: String, trim: true }],
    gstNumber: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    address: AddressSchema,
    about: { type: String, trim: true },

    // housekeeping
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// keep a unique pair (normalizedName + countryCode) for de-dupe
CompanySchema.index(
  { normalizedName: 1, "address.countryCode": 1 },
  {
    unique: true,
    partialFilterExpression: { "address.countryCode": { $type: "string" } },
  }
);

// lightweight text search
CompanySchema.index({ name: "text" });

CompanySchema.pre("validate", function (next) {
  if (this.name && !this.normalizedName) {
    this.normalizedName = this.name.toLowerCase().trim();
  }
  next();
});

module.exports = mongoose.model("Company", CompanySchema);
