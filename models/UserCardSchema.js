const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const UserCardSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    displayName: { type: String },
    phone: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
    companyName: { type: String },
    logoUrl: { type: String },
    gstNumber: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserCard", UserCardSchema);
