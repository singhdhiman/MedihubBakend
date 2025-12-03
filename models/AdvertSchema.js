// models/AdvertSchema.js
const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const AdvertSchema = new Schema(
  {
    // Product links
    catalogItem: { type: ObjectId, ref: "ProductCatalog", required: true },
    modelItem: { type: ObjectId, ref: "ProductModel" },

    // Seller info
    seller: { type: ObjectId, ref: "User", required: true, index: true },
    sellerName: { type: String }, // optional cache for faster queries
    companyName: { type: String },

    // Advert details
    title: { type: String, required: true },
    description: { type: String },
    images: [{ type: String }],
    price: { type: Number, required: true },
    currency: { type: String, default: "INR" },

    // Product condition and availability
    condition: {
      type: String,
      enum: ["New", "Used", "Refurbished", "For Parts"],
    },
    inStock: { type: Boolean, default: true },
    availabilityStatus: {
      type: String,
      enum: ["In Stock", "On Request"],
      default: "In Stock",
    },

    // Location info - we will only actively use `country`
    country: { type: String },
    // legacy fields kept but NOT used in filtering
    state: { type: String },
    city: { type: String },

    // Classification
    advertType: { type: String }, // e.g. "Sell", "Buy", "Rent"
    tags: [{ type: String }],
    // Make salesArea an array of strings (primary location filter)
    salesArea: [{ type: String }],

    // Publishing
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },

    // Soft delete
    isDeleted: { type: Boolean, default: false },

    // Optional / additional
    isPart: { type: Boolean, default: false },
    yearOfManufacture: { type: Number },
    brand: { type: String },
    model: { type: String }, // fallback model name stored on advert
  },
  { timestamps: true }
);

// Text search index for title + description
AdvertSchema.index({ title: "text", description: "text" });

// Helpful query indexes
AdvertSchema.index({ isPublished: 1, isDeleted: 1 });
AdvertSchema.index({ price: 1 });
AdvertSchema.index({ seller: 1 });
AdvertSchema.index({ catalogItem: 1 });
AdvertSchema.index({ modelItem: 1 });
AdvertSchema.index({ salesArea: 1 }); // index salesArea for fast matching/counts
AdvertSchema.index({ country: 1 });

module.exports = mongoose.model("Advert", AdvertSchema);
