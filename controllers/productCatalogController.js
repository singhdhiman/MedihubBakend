// controllers/productCatalogController.js
const mongoose = require("mongoose");
const ProductCatalog = require("../models/ProductCatalogSchema");
const ProductModel = require("../models/ProductModelSchema");

let CategoryCollectionName = "categories";
try {
  const CategoryModel = mongoose.model("Category");
  CategoryCollectionName = CategoryModel.collection.name;
} catch {
  CategoryCollectionName = "categories";
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
function toObjectId(id) {
  try {
    return isValidId(id) ? new mongoose.Types.ObjectId(id) : null;
  } catch {
    return null;
  }
}
function escapeRegex(q = "") {
  return q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Create Product + Models (simple) */
async function createProductCatalog(req, res) {
  try {
    const body = req.body || {};
    if (!body.name)
      return res.status(400).json({ message: "name is required" });

    const newProduct = await ProductCatalog.create({
      name: body.name,
      sku: body.sku,
      description: body.description,
      category: body.category ? toObjectId(body.category) : undefined,
      brand: body.brand,
      yearIntroduced: body.yearIntroduced
        ? Number(body.yearIntroduced)
        : undefined,
      attributes: body.attributes || {},
      images: Array.isArray(body.images) ? body.images : [],
      meta: body.meta || {},
    });

    let createdModels = [];
    if (Array.isArray(body.models) && body.models.length) {
      const modelsPayload = body.models
        .filter((m) => m && m.modelNumber)
        .map((m) => ({
          product: newProduct._id,
          modelNumber: m.modelNumber,
          variantName: m.variantName,
          specifications: m.specifications || {},
          price: m.price ? Number(m.price) : undefined,
          stockQuantity: m.stockQuantity ? Number(m.stockQuantity) : 0,
          colorOptions: Array.isArray(m.colorOptions) ? m.colorOptions : [],
          images: Array.isArray(m.images) ? m.images : [],
          attributes: m.attributes || {},
          meta: m.meta || {},
        }));

      if (modelsPayload.length) {
        createdModels = await ProductModel.insertMany(modelsPayload);
      }
    }

    return res.status(201).json({
      success: true,
      product: newProduct,
      createdModels,
    });
  } catch (err) {
    console.error("createProductCatalog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/** Search Products + Models + Filters (with counts) */
async function searchProductCatalog(req, res) {
  try {
    const body = req.body || {};
    const page = Math.max(parseInt(body.page || 1, 10), 1);
    const MAX_LIMIT = 100;
    const limit = Math.max(
      1,
      Math.min(parseInt(body.limit || 20, 10), MAX_LIMIT)
    );
    const skip = (page - 1) * limit;

    const match = {};

    // Text search: product-level (name, description, sku, brand)
    // and model-level (modelNumber, variantName) -> union product ids
    let modelProductIdsFromText = [];
    if (body.query && typeof body.query === "string" && body.query.trim()) {
      const q = body.query.trim();
      const re = new RegExp(escapeRegex(q), "i");

      // model-level matches -> get their product ids
      const modelMatches = await ProductModel.find(
        { $or: [{ modelNumber: re }, { variantName: re }] },
        { product: 1 }
      ).lean();
      modelProductIdsFromText = [
        ...new Set(
          modelMatches
            .map((m) => (m.product ? String(m.product) : null))
            .filter(Boolean)
        ),
      ]
        .map(toObjectId)
        .filter(Boolean);

      match.$or = [
        { name: { $regex: re } },
        { description: { $regex: re } },
        { sku: { $regex: re } },
        { brand: { $regex: re } },
      ];

      if (modelProductIdsFromText.length) {
        // include products matched by model text
        match.$or.push({ _id: { $in: modelProductIdsFromText } });
      }
    }

    // filters: categories, brands, years (optional)
    if (Array.isArray(body.categories) && body.categories.length) {
      const validCats = body.categories.map(toObjectId).filter(Boolean);
      if (validCats.length) match.category = { $in: validCats };
    } else if (body.category && isValidId(body.category)) {
      const c = toObjectId(body.category);
      if (c) match.category = c;
    }

    if (Array.isArray(body.brands) && body.brands.length) {
      const brands = body.brands.filter((b) => b !== null && b !== undefined);
      if (brands.length) match.brand = { $in: brands };
    }

    if (Array.isArray(body.years) && body.years.length) {
      const yrs = body.years.map(Number).filter((n) => !isNaN(n));
      if (yrs.length) match.yearIntroduced = { $in: yrs };
    }

    // Optional: model-based filter (client may pass modelNumbers or modelIds)
    if (Array.isArray(body.modelIds) && body.modelIds.length) {
      const modelIds = body.modelIds.map(toObjectId).filter(Boolean);
      if (modelIds.length) {
        const modFound = await ProductModel.find(
          { _id: { $in: modelIds } },
          { product: 1 }
        ).lean();
        const pids = [
          ...new Set(
            modFound
              .map((m) => (m.product ? String(m.product) : null))
              .filter(Boolean)
          ),
        ]
          .map(toObjectId)
          .filter(Boolean);
        if (pids.length) {
          match._id = match._id
            ? {
                $in: [
                  ...new Set([...(match._id.$in || []), ...pids.map(String)]),
                ]
                  .map(toObjectId)
                  .filter(Boolean),
              }
            : { $in: pids };
        } else {
          // no models -> return empty
          return res.json({
            success: true,
            filters: {
              brands: [],
              models: [],
              years: [],
              categories: [],
              modelCounts: [],
            },
            products: [],
            pagination: { page, limit, totalProducts: 0, totalPages: 0 },
          });
        }
      }
    } else if (Array.isArray(body.models) && body.models.length) {
      const modelNumbers = body.models.filter(Boolean);
      if (modelNumbers.length) {
        const modFound = await ProductModel.find(
          { modelNumber: { $in: modelNumbers } },
          { product: 1 }
        ).lean();
        const pids = [
          ...new Set(
            modFound
              .map((m) => (m.product ? String(m.product) : null))
              .filter(Boolean)
          ),
        ]
          .map(toObjectId)
          .filter(Boolean);
        if (pids.length) {
          match._id = match._id
            ? {
                $in: [
                  ...new Set([...(match._id.$in || []), ...pids.map(String)]),
                ]
                  .map(toObjectId)
                  .filter(Boolean),
              }
            : { $in: pids };
        } else {
          return res.json({
            success: true,
            filters: {
              brands: [],
              models: [],
              years: [],
              categories: [],
              modelCounts: [],
            },
            products: [],
            pagination: { page, limit, totalProducts: 0, totalPages: 0 },
          });
        }
      }
    }

    // Sorting
    const sortStage = (() => {
      if (body.sort === "name_asc") return { name: 1 };
      if (body.sort === "name_desc") return { name: -1 };
      if (body.sort === "year_desc") return { yearIntroduced: -1 };
      return { createdAt: -1 };
    })();

    // Aggregation: page of products + total
    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: CategoryCollectionName,
          localField: "category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      {
        $facet: {
          products: [
            { $sort: sortStage },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                name: 1,
                sku: 1,
                description: 1,
                brand: 1,
                yearIntroduced: 1,
                images: 1,
                category: {
                  _id: "$categoryDoc._id",
                  name: "$categoryDoc.name",
                },
                createdAt: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const aggRes = await ProductCatalog.aggregate(pipeline).allowDiskUse(true);
    const facet =
      aggRes && aggRes[0] ? aggRes[0] : { products: [], totalCount: [] };
    const products = facet.products || [];
    const total =
      (facet.totalCount && facet.totalCount[0] && facet.totalCount[0].count) ||
      0;

    // Attach models to each product in the page
    const pageProductIds = products
      .map((p) => toObjectId(p._id))
      .filter(Boolean);
    let models = [];
    if (pageProductIds.length) {
      models = await ProductModel.find(
        { product: { $in: pageProductIds } },
        {
          _id: 1,
          product: 1,
          modelNumber: 1,
          variantName: 1,
          price: 1,
          stockQuantity: 1,
          colorOptions: 1,
          images: 1,
        }
      ).lean();
    }

    const modelsByProduct = models.reduce((acc, m) => {
      const key = String(m.product);
      if (!acc[key]) acc[key] = [];
      acc[key].push(m);
      return acc;
    }, {});

    const productsWithModels = products.map((p) => ({
      ...p,
      models: modelsByProduct[String(p._id)] || [],
    }));

    // --- Now compute filter counts using the same `match` so counts reflect active filters ---

    // 1) Brand counts
    const brandCountsAgg = await ProductCatalog.aggregate([
      { $match: match },
      { $group: { _id: "$brand", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).allowDiskUse(true);
    const brands = (brandCountsAgg || [])
      .filter((b) => b._id)
      .map((b) => ({ value: b._id, count: b.count }));

    // 2) Year counts
    const yearCountsAgg = await ProductCatalog.aggregate([
      { $match: match },
      { $group: { _id: "$yearIntroduced", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]).allowDiskUse(true);
    const years = (yearCountsAgg || [])
      .filter((y) => y._id !== null && y._id !== undefined)
      .map((y) => ({ value: y._id, count: y.count }));

    // 3) Category counts (group by category id and lookup category name)
    const categoryCountsAgg = await ProductCatalog.aggregate([
      { $match: match },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      {
        $lookup: {
          from: CategoryCollectionName,
          localField: "_id",
          foreignField: "_id",
          as: "cat",
        },
      },
      { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, count: 1, name: "$cat.name" } },
      { $sort: { count: -1 } },
    ]).allowDiskUse(true);
    const categories = (categoryCountsAgg || [])
      .filter((c) => c._id)
      .map((c) => ({ _id: c._id, name: c.name || null, count: c.count }));

    // 4) Model counts & models list -> need product ids that match the product-level match
    // Get all product ids that match `match` (not just page)
    const matchingProductIdsDocs = await ProductCatalog.find(match, {
      _id: 1,
    }).lean();
    const matchingProductIds = (matchingProductIdsDocs || [])
      .map((d) => toObjectId(d._id))
      .filter(Boolean);

    let modelsCounts = [];
    let modelsList = [];
    if (matchingProductIds.length) {
      modelsCounts = await ProductModel.aggregate([
        { $match: { product: { $in: matchingProductIds } } },
        { $group: { _id: "$modelNumber", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).allowDiskUse(true);

      modelsList = (modelsCounts || [])
        .filter((m) => m._id)
        .map((m) => ({ value: m._id, count: m.count }));
    }

    const filters = {
      brands,
      models: modelsList,
      years,
      categories,
      modelCounts: (modelsCounts || []).map((m) => ({
        modelNumber: m._id,
        count: m.count,
      })),
    };

    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      filters,
      products: productsWithModels,
      pagination: { page, limit, totalProducts: total, totalPages },
    });
  } catch (err) {
    console.error(
      "searchProductCatalog error:",
      err && err.stack ? err.stack : err
    );
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = { createProductCatalog, searchProductCatalog };
