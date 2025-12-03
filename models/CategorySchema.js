const mongoose = require("mongoose");
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const CategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    parentCategory: { type: ObjectId, ref: "Category", default: null },
    description: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Category", CategorySchema);
