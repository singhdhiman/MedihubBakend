const mongoose = require("mongoose");
const { Schema } = mongoose;

// --- Main Schema ---
const ServiceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: { type: String, trim: true },
    description: { type: String, trim: true },
    country: { type: String, trim: true, index: true },

    // Services and categories selected
    servicesProvided: [
      {
        serviceKey: String, // e.g. "delivery_by_sea"a
        title: String, // e.g. "Delivery by Sea"
        categories: [
          {
            categoryRef: {
              type: Schema.Types.ObjectId,
              ref: "Category",
            },
            label: String, // e.g. "Dental Equipment > Dental Lasers"
          },
        ],
      },
    ],
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        validate: {
          validator: function (v) {
            return (
              !v ||
              (Array.isArray(v) &&
                v.length === 2 &&
                v.every((n) => typeof n === "number"))
            );
          },
          message: "location.coordinates should be [lng, lat]",
        },
      },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index for queries
ServiceSchema.index({ userId: 1, isActive: 1 });
ServiceSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Service", ServiceSchema);
