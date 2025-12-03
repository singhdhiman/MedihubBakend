const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const ProductCatalogSchema = new Schema(
  {
    name: { type: String, required: true },
    sku: { type: String, index: true },
    description: { type: String },
    category: { type: ObjectId, ref: "Category" },
    brand: { type: String },
    yearIntroduced: { type: Number },
    attributes: { type: Schema.Types.Mixed }, // flexible key/value
    images: [{ type: String }],
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

ProductCatalogSchema.index(
  { name: "text", description: "text" },
  { weights: { name: 5, description: 1 } }
);

module.exports = mongoose.model("ProductCatalog", ProductCatalogSchema);
