const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const ProductModelSchema = new Schema(
  {
    product: { type: ObjectId, ref: "ProductCatalog", required: true },
    modelNumber: { type: String, required: true },
    variantName: { type: String }, // e.g., "Pro Max", "Limited Edition"
    specifications: { type: Schema.Types.Mixed }, // flexible structure
    price: { type: Number },
    stockQuantity: { type: Number, default: 0 },
    colorOptions: [{ type: String }],
    images: [{ type: String }],
    attributes: { type: Schema.Types.Mixed },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

ProductModelSchema.index({ modelNumber: 1, product: 1 }, { unique: true });

module.exports = mongoose.model("ProductModel", ProductModelSchema);
