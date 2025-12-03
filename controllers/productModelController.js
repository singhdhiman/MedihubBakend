// controllers/productModelController.js
const ProductModel = require("../models/ProductModelSchema");
const ProductCatalog = require("../models/ProductCatalogSchema"); // optional for validation
const mongoose = require("mongoose");

/**
 * Create a product model
 */
exports.createModel = async (req, res) => {
  try {
    const payload = req.body;

    // optional: validate product exists
    if (!mongoose.Types.ObjectId.isValid(payload.product)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const productExists = await ProductCatalog.findById(payload.product).lean();
    if (!productExists)
      return res.status(404).json({ message: "Product not found" });

    const model = await ProductModel.create(payload);
    return res.status(201).json(model);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Model already exists for this product" });
    }
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * Get single model by id (populate product)
 */
exports.getModel = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid id" });

    const model = await ProductModel.findOne({ _id: id, isDeleted: false })
      .populate("product")
      .lean();

    if (!model) return res.status(404).json({ message: "Model not found" });
    return res.json(model);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * List models with pagination, filters and search
 * Query params: q (search), product (productId), minPrice, maxPrice, inStock, page, limit, sort
 */
exports.listModels = async (req, res) => {
  try {
    const {
      q,
      product,
      minPrice,
      maxPrice,
      inStock,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = { isDeleted: false };

    if (q) {
      // text search fallback
      filter.$text = { $search: q };
    }
    if (product && mongoose.Types.ObjectId.isValid(product)) {
      filter.product = product;
    }
    if (minPrice)
      filter.price = Object.assign({}, filter.price, {
        $gte: Number(minPrice),
      });
    if (maxPrice)
      filter.price = Object.assign({}, filter.price, {
        $lte: Number(maxPrice),
      });
    if (inStock !== undefined)
      filter.stockQuantity = inStock === "true" ? { $gt: 0 } : { $lte: 0 };

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      ProductModel.find(filter)
        .populate("product")
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ProductModel.countDocuments(filter),
    ]);

    return res.json({
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
      data: items,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Update a model
 */
exports.updateModel = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid id" });

    // optional: prevent changing product to a non-existent product
    if (payload.product && !mongoose.Types.ObjectId.isValid(payload.product)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const model = await ProductModel.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: payload },
      { new: true, runValidators: true }
    ).populate("product");

    if (!model) return res.status(404).json({ message: "Model not found" });
    return res.json(model);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "Duplicate model for product" });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Soft delete a model
 */
exports.deleteModel = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid id" });

    const model = await ProductModel.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );

    if (!model)
      return res
        .status(404)
        .json({ message: "Model not found or already deleted" });
    return res.json({ message: "Deleted", model });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Restore a soft-deleted model
 */
exports.restoreModel = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid id" });

    const model = await ProductModel.findOneAndUpdate(
      { _id: id, isDeleted: true },
      { $set: { isDeleted: false, deletedAt: null } },
      { new: true }
    );

    if (!model)
      return res
        .status(404)
        .json({ message: "Model not found or not deleted" });
    return res.json({ message: "Restored", model });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};
