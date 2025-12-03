// controllers/advertController.js
const mongoose = require("mongoose");
const Advert = require("../models/AdvertSchema");
const ProductCatalog = require("../models/ProductCatalogSchema");
const ProductModel = require("../models/ProductModelSchema");
const Category = require("../models/CategorySchema"); // optional, used if category filtering required

function isValidId(id) {
  return !!(id && mongoose.Types.ObjectId.isValid(id));
}

/**
 * buildMatchFromFilters
 * - Only accepts salesAreas (array) and country for location
 * - keeps other existing filters (price, condition, brand, models, advertTypes, etc.)
 */
function buildMatchFromFilters(body = {}) {
  const match = {
    isDeleted: false,
    isPublished: true,
  };

  if (body.query && typeof body.query === "string") {
    match._searchQuery = body.query;
  }

  if (Array.isArray(body.conditions) && body.conditions.length) {
    match.condition = { $in: body.conditions };
  }

  if (Array.isArray(body.availabilities) && body.availabilities.length) {
    match.availabilityStatus = { $in: body.availabilities };
  }

  if (
    Array.isArray(body.shippingFromRegions) &&
    body.shippingFromRegions.length
  ) {
    match.shippingFromRegion = { $in: body.shippingFromRegions };
  }

  if (body.price && typeof body.price === "object") {
    match.price = {};
    if (typeof body.price.min === "number") match.price.$gte = body.price.min;
    if (typeof body.price.max === "number") match.price.$lte = body.price.max;
    if (Object.keys(match.price).length === 0) delete match.price;
  }

  if (Array.isArray(body.years) && body.years.length) {
    match.yearOfManufacture = { $in: body.years };
  }

  if (Array.isArray(body.advertTypes) && body.advertTypes.length) {
    match.advertType = { $in: body.advertTypes };
  }

  if (typeof body.isPart === "boolean") {
    match.isPart = body.isPart;
  }

  // salesAreas: client should send an array of strings to filter by.
  if (Array.isArray(body.salesAreas) && body.salesAreas.length) {
    match.salesAreas = body.salesAreas;
  }

  if (Array.isArray(body.brands) && body.brands.length) {
    match.brand = { $in: body.brands };
  }

  if (Array.isArray(body.models) && body.models.length) {
    const idCandidates = body.models.filter((m) => isValidId(m));
    const stringCandidates = body.models.filter((m) => !isValidId(m));
    if (idCandidates.length) match._modelItemIds = idCandidates;
    if (stringCandidates.length) match.model = { $in: stringCandidates };
  }

  if (body.category && isValidId(body.category)) {
    match._categoryId = body.category;
  }

  // Only country for location filtering
  if (body.country) match.country = body.country;

  return match;
}

/**
 * createAdvert
 * - Accepts salesArea as array OR single string (coerces to array)
 * - Only stores country; state/city saved if present but not used in filters
 */
async function createAdvert(req, res) {
  try {
    const body = req.body || {};

    if (!body.seller || !isValidId(body.seller)) {
      return res.status(400).json({ message: "Valid seller id required" });
    }
    if (!body.title || typeof body.title !== "string") {
      return res.status(400).json({ message: "title required" });
    }

    if (!body.catalogItem || !isValidId(body.catalogItem)) {
      return res.status(400).json({ message: "Valid catalogItem id required" });
    }
    const cat = await ProductCatalog.findById(body.catalogItem).lean();
    if (!cat) return res.status(404).json({ message: "catalogItem not found" });

    if (body.modelItem && !isValidId(body.modelItem)) {
      return res.status(400).json({ message: "invalid modelItem id" });
    }
    if (body.modelItem) {
      const mod = await ProductModel.findById(body.modelItem).lean();
      if (!mod) return res.status(404).json({ message: "modelItem not found" });
    }

    if (typeof body.price !== "number" || Number.isNaN(body.price)) {
      return res.status(400).json({ message: "price (number) is required" });
    }
    if (body.price < 0) {
      return res.status(400).json({ message: "price must be >= 0" });
    }

    const advertData = {
      catalogItem: body.catalogItem,
      modelItem: body.modelItem || null,
      seller: body.seller,
      sellerName: body.sellerName,
      companyName: body.companyName,
      title: body.title,
      description: body.description || "",
      images: Array.isArray(body.images) ? body.images : [],
      price: body.price,
      currency: body.currency || "INR",
      condition: body.condition,
      inStock:
        typeof body.inStock === "boolean" ? body.inStock : body.inStock ?? true,
      availabilityStatus:
        body.availabilityStatus || body.availability || "In Stock",
      country: body.country || (cat && cat.country) || null,
      // salesArea stored as array; accept single string or array
      salesArea: Array.isArray(body.salesArea)
        ? body.salesArea
        : body.salesArea
        ? [body.salesArea]
        : [],
      // keep legacy but not used in filters
      state: body.state || null,
      city: body.city || null,
      shippingFromRegion: body.shippingFromRegion,
      salesArea: Array.isArray(body.salesArea)
        ? body.salesArea
        : body.salesArea
        ? [body.salesArea]
        : [],
      advertType: body.advertType,
      tags: Array.isArray(body.tags) ? body.tags : body.tags ? [body.tags] : [],
      isPublished: !!body.isPublished,
      publishedAt: !!body.isPublished ? body.publishedAt || new Date() : null,
      isDeleted: false,
      isPart: !!body.isPart,
      yearOfManufacture: body.yearOfManufacture,
      brand: body.brand,
      model: body.model,
    };

    const advert = await Advert.create(advertData);
    return res.status(201).json({ success: true, advert });
  } catch (err) {
    console.error("createAdvert error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * listAdverts
 * - Uses buildMatchFromFilters
 * - Filters using `salesArea` array intersection and `country`
 * - Produces products, filters, and counts for salesArea + country (no state/city)
 */
async function listAdverts(req, res) {
  try {
    const body = req.body || {};
    const page = Math.max(parseInt(body.page || 1, 10), 1);
    const limit = Math.max(parseInt(body.limit || 20, 10), 1);
    const skip = (page - 1) * limit;

    const match = buildMatchFromFilters(body);
    const pipeline = [];

    // If category id might be catalog id, detect and split
    let catalogFilterId = null;
    let categoryFilterId = null;
    if (match._categoryId) {
      const possibleCatalog = await ProductCatalog.findById(match._categoryId)
        .select("_id category")
        .lean();
      if (possibleCatalog) {
        catalogFilterId = match._categoryId;
        delete match._categoryId;
      } else {
        categoryFilterId = match._categoryId;
        delete match._categoryId;
      }
    }

    // Handle search query (regex)
    if (match._searchQuery) {
      const q = match._searchQuery;
      match.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
      delete match._searchQuery;
    }

    // Build initialMatch (do NOT include state/city)
    const initialMatch = {
      isDeleted: match.isDeleted,
      isPublished: match.isPublished,
    };
    if (match.condition) initialMatch.condition = match.condition;
    if (match.availabilityStatus)
      initialMatch.availabilityStatus = match.availabilityStatus;
    if (match.shippingFromRegion)
      initialMatch.shippingFromRegion = match.shippingFromRegion;
    if (match.price) initialMatch.price = match.price;
    if (match.yearOfManufacture)
      initialMatch.yearOfManufacture = match.yearOfManufacture;
    if (match.advertType) initialMatch.advertType = match.advertType;
    if (typeof match.isPart === "boolean") initialMatch.isPart = match.isPart;
    if (match.brand) initialMatch.brand = match.brand;
    if (match.model) initialMatch.model = match.model;
    if (match.country) initialMatch.country = match.country;
    if (match.$or) initialMatch.$or = match.$or;

    pipeline.push({ $match: initialMatch });

    // Lookups
    pipeline.push({
      $lookup: {
        from: "productcatalogs",
        localField: "catalogItem",
        foreignField: "_id",
        as: "catalog",
      },
    });
    pipeline.push({
      $unwind: { path: "$catalog", preserveNullAndEmptyArrays: true },
    });

    pipeline.push({
      $lookup: {
        from: "productmodels",
        localField: "modelItem",
        foreignField: "_id",
        as: "modelDoc",
      },
    });
    pipeline.push({
      $unwind: { path: "$modelDoc", preserveNullAndEmptyArrays: true },
    });

    pipeline.push({
      $lookup: {
        from: "categories",
        localField: "catalog.category",
        foreignField: "_id",
        as: "categoryDoc",
      },
    });
    pipeline.push({
      $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true },
    });

    // Category/catalog filtering
    if (catalogFilterId) {
      pipeline.push({
        $match: {
          $or: [
            { "catalog._id": new mongoose.Types.ObjectId(catalogFilterId) },
            { catalogItem: new mongoose.Types.ObjectId(catalogFilterId) },
          ],
        },
      });
    } else if (categoryFilterId) {
      pipeline.push({
        $match: {
          $or: [
            {
              "categoryDoc._id": new mongoose.Types.ObjectId(categoryFilterId),
            },
            {
              "catalog.category": new mongoose.Types.ObjectId(categoryFilterId),
            },
          ],
        },
      });
    }

    // Model item match (if provided)
    if (
      match._modelItemIds &&
      Array.isArray(match._modelItemIds) &&
      match._modelItemIds.length
    ) {
      const objIds = match._modelItemIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      const orClauses = [{ modelItem: { $in: objIds } }];
      if (match.model && match.model.$in)
        orClauses.push({ model: { $in: match.model.$in } });
      pipeline.push({ $match: { $or: orClauses } });
    }

    // Special handling for salesAreas (match any advert whose salesArea array contains any requested item)
    if (
      match.salesAreas &&
      Array.isArray(match.salesAreas) &&
      match.salesAreas.length
    ) {
      pipeline.push({
        $match: {
          salesArea: { $in: match.salesAreas },
        },
      });
    }

    // Sorting stage
    const sortStage = (() => {
      if (body.sort === "price_asc") return { price: 1, createdAt: -1 };
      if (body.sort === "price_desc") return { price: -1, createdAt: -1 };
      if (body.sort === "year_desc")
        return { yearOfManufacture: -1, createdAt: -1 };
      return { createdAt: -1 };
    })();

    // Facet to return paginated products + filters + totalCount
    pipeline.push({
      $facet: {
        products: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: "$_id",
              title: 1,
              images: 1,
              category: { _id: "$categoryDoc._id", name: "$categoryDoc.name" },
              brand: { $ifNull: ["$brand", "$catalog.brand"] },
              model: {
                $ifNull: [
                  "$modelDoc.variantName",
                  {
                    $ifNull: [
                      "$modelDoc.modelNumber",
                      { $ifNull: ["$model", "$catalog.modelNumber"] },
                    ],
                  },
                ],
              },
              yearOfManufacture: {
                $ifNull: ["$yearOfManufacture", "$catalog.yearIntroduced"],
              },
              condition: 1,
              availabilityStatus: {
                $ifNull: ["$availabilityStatus", "$availability"],
              },
              price: 1,
              isPart: { $ifNull: ["$isPart", false] },
              seller: 1,
              companyName: 1,
              advertType: 1,
              salesArea: 1,
              shippingFromRegion: 1,
              country: 1,
              createdAt: 1,
            },
          },
        ],
        filters: [
          {
            $group: {
              _id: null,
              brands: { $addToSet: { $ifNull: ["$brand", "$catalog.brand"] } },
              models: {
                $addToSet: {
                  $ifNull: [
                    "$modelDoc.variantName",
                    {
                      $ifNull: [
                        "$modelDoc.modelNumber",
                        { $ifNull: ["$model", "$catalog.modelNumber"] },
                      ],
                    },
                  ],
                },
              },
              conditions: { $addToSet: "$condition" },
              availabilities: {
                $addToSet: {
                  $ifNull: ["$availabilityStatus", "$availability"],
                },
              },
              shippingFromRegions: { $addToSet: "$shippingFromRegion" },
              years: {
                $addToSet: {
                  $ifNull: ["$yearOfManufacture", "$catalog.yearIntroduced"],
                },
              },
              companies: { $addToSet: { name: "$companyName" } },
              prices: { $push: "$price" },
              // salesAreas may contain arrays; we'll normalize in JS later
              salesAreas: { $addToSet: "$salesArea" },
              countries: { $addToSet: "$country" },
            },
          },
          {
            $project: {
              brands: 1,
              models: 1,
              conditions: 1,
              availabilities: 1,
              shippingFromRegions: 1,
              years: 1,
              companies: 1,
              priceMin: { $min: "$prices" },
              priceMax: { $max: "$prices" },
              salesAreas: 1,
              countries: 1,
            },
          },
          { $limit: 1 },
        ],
        totalCount: [{ $count: "count" }],
      },
    });

    // Run main aggregation
    const agg = await Advert.aggregate(pipeline).allowDiskUse(true);
    const facetResult = agg[0] || { products: [], filters: [], totalCount: [] };
    const rawFilters = (facetResult.filters && facetResult.filters[0]) || null;

    // Build counts pipeline (simpler) to get accurate counts for facets including per-salesArea counts
    const countsPipeline = [];
    countsPipeline.push({ $match: initialMatch });

    countsPipeline.push({
      $lookup: {
        from: "productcatalogs",
        localField: "catalogItem",
        foreignField: "_id",
        as: "catalog",
      },
    });
    countsPipeline.push({
      $unwind: { path: "$catalog", preserveNullAndEmptyArrays: true },
    });

    countsPipeline.push({
      $lookup: {
        from: "productmodels",
        localField: "modelItem",
        foreignField: "_id",
        as: "modelDoc",
      },
    });
    countsPipeline.push({
      $unwind: { path: "$modelDoc", preserveNullAndEmptyArrays: true },
    });

    countsPipeline.push({
      $lookup: {
        from: "categories",
        localField: "catalog.category",
        foreignField: "_id",
        as: "categoryDoc",
      },
    });
    countsPipeline.push({
      $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true },
    });

    if (catalogFilterId)
      countsPipeline.push({
        $match: {
          $or: [
            { "catalog._id": new mongoose.Types.ObjectId(catalogFilterId) },
            { catalogItem: new mongoose.Types.ObjectId(catalogFilterId) },
          ],
        },
      });
    else if (categoryFilterId)
      countsPipeline.push({
        $match: {
          $or: [
            {
              "categoryDoc._id": new mongoose.Types.ObjectId(categoryFilterId),
            },
            {
              "catalog.category": new mongoose.Types.ObjectId(categoryFilterId),
            },
          ],
        },
      });

    if (
      match._modelItemIds &&
      Array.isArray(match._modelItemIds) &&
      match._modelItemIds.length
    ) {
      const objIds = match._modelItemIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      const orClauses = [{ modelItem: { $in: objIds } }];
      if (match.model && match.model.$in)
        orClauses.push({ model: { $in: match.model.$in } });
      countsPipeline.push({ $match: { $or: orClauses } });
    }

    // Project fields used for counts; include salesArea as-is (array)
    countsPipeline.push({
      $project: {
        brand: { $ifNull: ["$brand", "$catalog.brand"] },
        model: {
          $ifNull: [
            "$modelDoc.variantName",
            {
              $ifNull: [
                "$modelDoc.modelNumber",
                { $ifNull: ["$model", "$catalog.modelNumber"] },
              ],
            },
          ],
        },
        companyName: "$companyName",
        condition: "$condition",
        availabilityStatus: {
          $ifNull: ["$availabilityStatus", "$availability"],
        },
        salesArea: "$salesArea",
        shippingFromRegion: "$shippingFromRegion",
        country: "$country",
        price: "$price",
      },
    });

    // Facet counts including salesAreaCounts (we $unwind salesArea to count each value)
    countsPipeline.push({
      $facet: {
        brandCounts: [
          { $match: { brand: { $ne: null } } },
          { $group: { _id: "$brand", count: { $sum: 1 } } },
        ],
        modelCounts: [
          { $match: { model: { $ne: null } } },
          { $group: { _id: "$model", count: { $sum: 1 } } },
        ],
        companyCounts: [
          { $match: { companyName: { $ne: null } } },
          { $group: { _id: "$companyName", count: { $sum: 1 } } },
        ],
        salesAreaCounts: [
          {
            $unwind: { path: "$salesArea", preserveNullAndEmptyArrays: false },
          },
          { $match: { salesArea: { $ne: null } } },
          { $group: { _id: "$salesArea", count: { $sum: 1 } } },
        ],
        availabilityCounts: [
          { $match: { availabilityStatus: { $ne: null } } },
          { $group: { _id: "$availabilityStatus", count: { $sum: 1 } } },
        ],
        shippingFromRegionCounts: [
          { $match: { shippingFromRegion: { $ne: null } } },
          { $group: { _id: "$shippingFromRegion", count: { $sum: 1 } } },
        ],
        countryCounts: [
          { $match: { country: { $ne: null } } },
          { $group: { _id: "$country", count: { $sum: 1 } } },
        ],
        priceStats: [
          {
            $group: {
              _id: null,
              min: { $min: "$price" },
              max: { $max: "$price" },
            },
          },
        ],
      },
    });

    const countsAgg = await Advert.aggregate(countsPipeline).allowDiskUse(true);
    const countsRes = countsAgg[0] || {
      brandCounts: [],
      modelCounts: [],
      companyCounts: [],
      salesAreaCounts: [],
      availabilityCounts: [],
      shippingFromRegionCounts: [],
      countryCounts: [],
      priceStats: [],
    };

    // Prepare filters output (normalize data)
    const filtersOutput = {
      brands: (countsRes.brandCounts || []).map((b) => ({
        value: b._id,
        count: b.count,
      })),
      models: (countsRes.modelCounts || []).map((m) => ({
        value: m._id,
        count: m.count,
      })),
      conditions: (rawFilters?.conditions || []).filter(Boolean),
      availabilities: (countsRes.availabilityCounts || []).map((a) => ({
        value: a._id,
        count: a.count,
      })),
      shippingFromRegions: (countsRes.shippingFromRegionCounts || []).map(
        (r) => ({ value: r._id, count: r.count })
      ),
      priceRange: {
        min:
          (countsRes.priceStats &&
            countsRes.priceStats[0] &&
            countsRes.priceStats[0].min) ??
          rawFilters?.priceMin ??
          null,
        max:
          (countsRes.priceStats &&
            countsRes.priceStats[0] &&
            countsRes.priceStats[0].max) ??
          rawFilters?.priceMax ??
          null,
      },
      years: (rawFilters?.years || []).filter(Boolean),
      companies: (countsRes.companyCounts || []).map((c) => ({
        name: c._id,
        count: c.count,
      })),
      salesAreas: (countsRes.salesAreaCounts || []).map((s) => ({
        value: s._id,
        count: s.count,
      })),
      countries: (countsRes.countryCounts || []).map((c) => ({
        value: c._id,
        count: c.count,
      })),
    };

    const products = facetResult.products || [];
    const total =
      (facetResult.totalCount &&
        facetResult.totalCount[0] &&
        facetResult.totalCount[0].count) ||
      0;
    const totalPages = Math.ceil(total / limit);
    const categoryInfo = body.category ? { _id: body.category } : null;

    return res.json({
      success: true,
      category: categoryInfo,
      filters: filtersOutput,
      products,
      pagination: { page, limit, totalProducts: total, totalPages },
    });
  } catch (err) {
    console.error("listAdverts error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createAdvert,
  listAdverts,
  buildMatchFromFilters, // exported for tests if needed
};
