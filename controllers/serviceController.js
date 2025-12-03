// controllers/serviceController.js
const mongoose = require("mongoose");
const Service = require("../models/ServiceSchema");
const User = require("../models/UserSchema");
const Category = require("../models/CategorySchema");

// Allowed service keys
const ALLOWED_SERVICE_KEYS = [
  "delivery_by_sea",
  "delivery_by_air",
  "installation",
  "repair",
  "maintenance",
  "consulting",
  "training",
  // add other allowed keys here...
];

function isValidId(id) {
  return !!(id && mongoose.Types.ObjectId.isValid(id));
}

/**
 * Create Service
 * POST /api/services
 * Accepts optional: country (string), location (object: { lat, lng } OR { coordinates: [lng, lat] })
 */
async function createService(req, res) {
  try {
    const body = req.body || {};

    const userId = body.userId || req.user?.userId;
    if (!userId || !isValidId(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const userExists = await User.findById(userId).select("_id");
    if (!userExists) return res.status(404).json({ message: "User not found" });

    if (
      !Array.isArray(body.servicesProvided) ||
      body.servicesProvided.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "servicesProvided must be a non-empty array" });
    }

    // validate service keys + category refs
    for (const ser of body.servicesProvided) {
      if (
        !ser.serviceKey ||
        typeof ser.serviceKey !== "string" ||
        !ALLOWED_SERVICE_KEYS.includes(ser.serviceKey)
      ) {
        return res.status(400).json({
          message: `Invalid serviceKey: ${
            ser.serviceKey
          }. Allowed: ${ALLOWED_SERVICE_KEYS.join(", ")}`,
        });
      }
      if (Array.isArray(ser.categories)) {
        for (const c of ser.categories) {
          if (c.categoryRef && !isValidId(c.categoryRef)) {
            return res
              .status(400)
              .json({ message: `Invalid categoryRef id: ${c.categoryRef}` });
          }
        }
      }
    }

    // handle country & location (GeoJSON)
    let country = body.country ? String(body.country).trim() : undefined;
    let locationGeo = undefined;

    if (body.location && typeof body.location === "object") {
      const { lat, lng, latitude, longitude, coordinates } = body.location;
      if (Array.isArray(coordinates) && coordinates.length === 2) {
        const [lngV, latV] = coordinates;
        if (typeof lngV === "number" && typeof latV === "number") {
          locationGeo = { type: "Point", coordinates: [lngV, latV] };
        }
      } else if (typeof lat === "number" && typeof lng === "number") {
        locationGeo = { type: "Point", coordinates: [lng, lat] };
      } else if (
        typeof latitude === "number" &&
        typeof longitude === "number"
      ) {
        locationGeo = { type: "Point", coordinates: [longitude, latitude] };
      }
    }
    if (
      !locationGeo &&
      typeof body.lat === "number" &&
      typeof body.lng === "number"
    ) {
      locationGeo = { type: "Point", coordinates: [body.lng, body.lat] };
    }

    const newService = await Service.create({
      userId,
      title: body.title,
      description: body.description,
      servicesProvided: body.servicesProvided,
      isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      country,
      location: locationGeo,
    });

    return res.status(201).json({ success: true, service: newService });
  } catch (err) {
    console.error("createService error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Update Service
 * PUT /api/services/:id
 * Accepts updates to title, description, servicesProvided, country, location, isActive
 */
async function updateService(req, res) {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid id" });

    const body = req.body || {};

    if (Array.isArray(body.servicesProvided)) {
      for (const ser of body.servicesProvided) {
        if (!ser.serviceKey || !ALLOWED_SERVICE_KEYS.includes(ser.serviceKey)) {
          return res
            .status(400)
            .json({ message: `Invalid serviceKey: ${ser.serviceKey}` });
        }
        if (Array.isArray(ser.categories)) {
          for (const c of ser.categories) {
            if (c.categoryRef && !isValidId(c.categoryRef)) {
              return res
                .status(400)
                .json({ message: `Invalid categoryRef id: ${c.categoryRef}` });
            }
          }
        }
      }
    }

    // prevent changing userId via update
    delete body.userId;

    // normalize location if provided
    if (body.location && typeof body.location === "object") {
      const { lat, lng, latitude, longitude, coordinates } = body.location;
      if (Array.isArray(coordinates) && coordinates.length === 2) {
        const [lngV, latV] = coordinates;
        if (typeof lngV === "number" && typeof latV === "number") {
          body.location = { type: "Point", coordinates: [lngV, latV] };
        } else {
          delete body.location;
        }
      } else if (typeof lat === "number" && typeof lng === "number") {
        body.location = { type: "Point", coordinates: [lng, lat] };
      } else if (
        typeof latitude === "number" &&
        typeof longitude === "number"
      ) {
        body.location = { type: "Point", coordinates: [longitude, latitude] };
      } else {
        delete body.location;
      }
    } else if (typeof body.lat === "number" && typeof body.lng === "number") {
      body.location = { type: "Point", coordinates: [body.lng, body.lat] };
      delete body.lat;
      delete body.lng;
    }

    const updated = await Service.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ message: "Service not found" });

    return res.json({ success: true, service: updated });
  } catch (err) {
    console.error("updateService error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Get single service
 * GET /api/services/:id
 */
async function getServiceById(req, res) {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid id" });

    const service = await Service.findById(id)
      .populate("userId", "name email")
      .populate("servicesProvided.categories.categoryRef", "name");

    if (!service) return res.status(404).json({ message: "Service not found" });
    return res.json({ success: true, service });
  } catch (err) {
    console.error("getServiceById error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Soft-delete (deactivate) service
 * DELETE /api/services/:id
 */
async function deleteService(req, res) {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid id" });

    const updated = await Service.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Service not found" });

    return res.json({
      success: true,
      message: "Service deactivated",
      service: updated,
    });
  } catch (err) {
    console.error("deleteService error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * POST /api/services/search
 * Supports:
 *  - userId
 *  - serviceKeys (array)
 *  - category / categories (id(s))
 *  - categoryNames (array of label substrings)
 *  - query (text)
 *  - country (string)
 *  - near: { lat, lng, radiusKm }  // radius in km
 *  - isActive, page, limit, sort
 */
// async function searchServices(req, res) {
//   try {
//     const body = req.body || {};
//     const page = Math.max(parseInt(body.page || 1, 10), 1);
//     const limit = Math.max(parseInt(body.limit || 20, 10), 1);
//     const skip = (page - 1) * limit;

//     // baseMatch (applied for non-geospatial matching)
//     const baseMatch = {};
//     baseMatch.isActive =
//       typeof body.isActive === "boolean" ? body.isActive : true;

//     if (body.userId && isValidId(body.userId)) {
//       baseMatch.userId = new mongoose.Types.ObjectId(body.userId);
//     }

//     if (body.country && typeof body.country === "string") {
//       baseMatch.country = body.country.trim();
//     }

//     // serviceKeys
//     let filteredServiceKeys = null;
//     if (Array.isArray(body.serviceKeys) && body.serviceKeys.length) {
//       filteredServiceKeys = body.serviceKeys.filter((k) =>
//         ALLOWED_SERVICE_KEYS.includes(k)
//       );
//       if (filteredServiceKeys.length) {
//         baseMatch["servicesProvided.serviceKey"] = { $in: filteredServiceKeys };
//       }
//     }

//     // categories (ids)
//     let categoryObjectIds = null;
//     if (Array.isArray(body.categories) && body.categories.length) {
//       categoryObjectIds = body.categories
//         .filter(isValidId)
//         .map((id) => new mongoose.Types.ObjectId(id));
//     } else if (body.category && isValidId(body.category)) {
//       categoryObjectIds = [new mongoose.Types.ObjectId(body.category)];
//     }

//     // categoryNames -> regexes
//     let categoryNameRegexes = null;
//     if (Array.isArray(body.categoryNames) && body.categoryNames.length) {
//       categoryNameRegexes = body.categoryNames.map(
//         (name) =>
//           new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
//       );
//     }

//     // query regex
//     const query = (body.query || "").trim();
//     const queryRegex = query
//       ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
//       : null;

//     // geo / near
//     const near = body.near && typeof body.near === "object" ? body.near : null;
//     let useGeoNear = false;
//     let geoNearStage = null;
//     if (near && typeof near.lat === "number" && typeof near.lng === "number") {
//       const radiusKm =
//         typeof near.radiusKm === "number" && near.radiusKm > 0
//           ? near.radiusKm
//           : 50;
//       const maxDistanceMeters = radiusKm * 1000;
//       useGeoNear = true;
//       geoNearStage = {
//         $geoNear: {
//           near: { type: "Point", coordinates: [near.lng, near.lat] },
//           distanceField: "distanceMeters",
//           spherical: true,
//           maxDistance: maxDistanceMeters,
//           query: baseMatch,
//           distanceMultiplier: 0.001, // to get km if desired later
//         },
//       };
//     }

//     const pipeline = [];

//     // If geoNear used, must be first stage
//     if (useGeoNear) {
//       pipeline.push(geoNearStage);
//     } else {
//       pipeline.push({ $match: baseMatch });
//     }

//     // unwind servicesProvided
//     pipeline.push({
//       $unwind: { path: "$servicesProvided", preserveNullAndEmptyArrays: true },
//     });

//     if (filteredServiceKeys && filteredServiceKeys.length) {
//       pipeline.push({
//         $match: { "servicesProvided.serviceKey": { $in: filteredServiceKeys } },
//       });
//     }

//     // unwind categories
//     pipeline.push({
//       $unwind: {
//         path: "$servicesProvided.categories",
//         preserveNullAndEmptyArrays: true,
//       },
//     });

//     if (categoryObjectIds && categoryObjectIds.length) {
//       pipeline.push({
//         $match: {
//           "servicesProvided.categories.categoryRef": { $in: categoryObjectIds },
//         },
//       });
//     }

//     if (categoryNameRegexes && categoryNameRegexes.length) {
//       pipeline.push({
//         $match: {
//           $or: categoryNameRegexes.map((rx) => ({
//             "servicesProvided.categories.label": rx,
//           })),
//         },
//       });
//     }

//     if (queryRegex) {
//       pipeline.push({
//         $match: {
//           $or: [
//             { title: queryRegex },
//             { description: queryRegex },
//             { "servicesProvided.title": queryRegex },
//             { "servicesProvided.description": queryRegex },
//             { "servicesProvided.categories.label": queryRegex },
//           ],
//         },
//       });
//     }

//     // group back to service level
//     pipeline.push({
//       $group: {
//         _id: "$_id",
//         userId: { $first: "$userId" },
//         title: { $first: "$title" },
//         description: { $first: "$description" },
//         isActive: { $first: "$isActive" },
//         country: { $first: "$country" },
//         location: { $first: "$location" },
//         distanceMeters: { $first: "$distanceMeters" }, // when geoNear used
//         createdAt: { $first: "$createdAt" },
//         servicesProvided: { $push: "$servicesProvided" },
//       },
//     });

//     // lookup user
//     pipeline.push({
//       $lookup: {
//         from: "users",
//         localField: "userId",
//         foreignField: "_id",
//         as: "user",
//       },
//     });
//     pipeline.push({
//       $unwind: { path: "$user", preserveNullAndEmptyArrays: true },
//     });

//     // facet
//     const sortStage = useGeoNear
//       ? { distanceMeters: 1 }
//       : body.sort === "title_asc"
//       ? { title: 1 }
//       : body.sort === "title_desc"
//       ? { title: -1 }
//       : { createdAt: -1 };

//     pipeline.push({
//       $facet: {
//         items: [
//           { $sort: sortStage },
//           { $skip: skip },
//           { $limit: limit },
//           {
//             $project: {
//               _id: "$_id",
//               title: 1,
//               description: 1,
//               isActive: 1,
//               country: 1,
//               location: 1,
//               distanceKm: {
//                 $cond: [
//                   { $ifNull: ["$distanceMeters", false] },
//                   { $divide: ["$distanceMeters", 1000] },
//                   null,
//                 ],
//               },
//               createdAt: 1,
//               user: {
//                 _id: "$user._id",
//                 name: "$user.name",
//                 email: "$user.email",
//               },
//               servicesProvided: 1,
//             },
//           },
//         ],
//         meta: [
//           {
//             $unwind: {
//               path: "$servicesProvided",
//               preserveNullAndEmptyArrays: true,
//             },
//           },
//           {
//             $unwind: {
//               path: "$servicesProvided.categories",
//               preserveNullAndEmptyArrays: true,
//             },
//           },
//           {
//             $group: {
//               _id: null,
//               serviceKeyCounts: { $push: "$servicesProvided.serviceKey" },
//               categoryRefs: {
//                 $push: "$servicesProvided.categories.categoryRef",
//               },
//             },
//           },
//         ],
//         totalCount: [{ $count: "count" }],
//       },
//     });

//     const agg = await Service.aggregate(pipeline).allowDiskUse(true);
//     const data = agg[0] || { items: [], meta: [], totalCount: [] };

//     const items = data.items || [];
//     const total = (data.totalCount[0] && data.totalCount[0].count) || 0;
//     const totalPages = Math.ceil(total / limit);

//     // build filter counts
//     let serviceKeyCounts = [];
//     let categoryCounts = [];
//     if (data.meta && data.meta[0]) {
//       const meta = data.meta[0];
//       const skArr = (meta.serviceKeyCounts || []).filter(Boolean);
//       const skMap = skArr.reduce((acc, sk) => {
//         acc[sk] = (acc[sk] || 0) + 1;
//         return acc;
//       }, {});
//       serviceKeyCounts = Object.keys(skMap)
//         .map((k) => ({ serviceKey: k, count: skMap[k] }))
//         .sort((a, b) => b.count - a.count);

//       const catArr = (meta.categoryRefs || [])
//         .filter(Boolean)
//         .map((v) => (v && v.toString ? v.toString() : v));
//       const catMap = catArr.reduce((acc, id) => {
//         acc[id] = (acc[id] || 0) + 1;
//         return acc;
//       }, {});
//       categoryCounts = Object.keys(catMap)
//         .map((id) => ({ categoryId: id, count: catMap[id] }))
//         .sort((a, b) => b.count - a.count);
//     }

//     return res.json({
//       success: true,
//       filters: { serviceKeyCounts, categoryCounts },
//       services: items,
//       pagination: { page, limit, totalServices: total, totalPages },
//     });
//   } catch (err) {
//     console.error("searchServices error", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// }

// Replace your existing searchServices with this implementation

// Replace your existing searchServices with this function
async function searchServices(req, res) {
  try {
    const body = req.body || {};
    const page = Math.max(parseInt(body.page || 1, 10), 1);
    const limit = Math.max(parseInt(body.limit || 20, 10), 1);
    const skip = (page - 1) * limit;

    // escape helper for regex
    const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // baseMatch (applied for non-geospatial matching)
    const baseMatch = {};
    baseMatch.isActive =
      typeof body.isActive === "boolean" ? body.isActive : true;

    // userId
    if (body.userId && isValidId(body.userId)) {
      baseMatch.userId = new mongoose.Types.ObjectId(body.userId);
    }

    // COUNTRY: normalize user-provided country for matching (use case-insensitive regex)
    if (body.country && typeof body.country === "string") {
      const c = body.country.trim();
      if (c.length) {
        baseMatch.country = {
          $regex: new RegExp("^\\s*" + escapeForRegex(c) + "\\s*$", "i"),
        };
      }
    }

    // serviceKeys
    let filteredServiceKeys = null;
    if (Array.isArray(body.serviceKeys) && body.serviceKeys.length) {
      filteredServiceKeys = body.serviceKeys.filter((k) =>
        ALLOWED_SERVICE_KEYS.includes(k)
      );
      if (filteredServiceKeys.length)
        baseMatch["servicesProvided.serviceKey"] = { $in: filteredServiceKeys };
    }

    // categories (ids)
    let categoryObjectIds = null;
    if (Array.isArray(body.categories) && body.categories.length) {
      categoryObjectIds = body.categories
        .filter(isValidId)
        .map((id) => new mongoose.Types.ObjectId(id));
    } else if (body.category && isValidId(body.category)) {
      categoryObjectIds = [new mongoose.Types.ObjectId(body.category)];
    }

    // categoryNames
    let categoryNameRegexes = null;
    if (Array.isArray(body.categoryNames) && body.categoryNames.length) {
      categoryNameRegexes = body.categoryNames.map(
        (name) => new RegExp(escapeForRegex(name.trim()), "i")
      );
    }

    // query regex
    const query = (body.query || "").trim();
    const queryRegex = query ? new RegExp(escapeForRegex(query), "i") : null;

    // geo / near
    const near = body.near && typeof body.near === "object" ? body.near : null;
    let useGeoNear = false;
    let geoNearStage = null;
    if (near && typeof near.lat === "number" && typeof near.lng === "number") {
      const radiusKm =
        typeof near.radiusKm === "number" && near.radiusKm > 0
          ? near.radiusKm
          : 50;
      const maxDistanceMeters = radiusKm * 1000;
      useGeoNear = true;
      geoNearStage = {
        $geoNear: {
          near: { type: "Point", coordinates: [near.lng, near.lat] },
          distanceField: "distanceMeters",
          spherical: true,
          maxDistance: maxDistanceMeters,
          query: baseMatch,
          distanceMultiplier: 0.001,
        },
      };
    }

    const pipeline = [];
    // must be first if using geoNear
    if (useGeoNear) pipeline.push(geoNearStage);
    else pipeline.push({ $match: baseMatch });

    // unwind servicesProvided
    pipeline.push({
      $unwind: { path: "$servicesProvided", preserveNullAndEmptyArrays: true },
    });

    if (filteredServiceKeys && filteredServiceKeys.length) {
      pipeline.push({
        $match: { "servicesProvided.serviceKey": { $in: filteredServiceKeys } },
      });
    }

    // unwind categories
    pipeline.push({
      $unwind: {
        path: "$servicesProvided.categories",
        preserveNullAndEmptyArrays: true,
      },
    });

    if (categoryObjectIds && categoryObjectIds.length) {
      pipeline.push({
        $match: {
          "servicesProvided.categories.categoryRef": { $in: categoryObjectIds },
        },
      });
    }

    if (categoryNameRegexes && categoryNameRegexes.length) {
      pipeline.push({
        $match: {
          $or: categoryNameRegexes.map((rx) => ({
            "servicesProvided.categories.label": rx,
          })),
        },
      });
    }

    if (queryRegex) {
      pipeline.push({
        $match: {
          $or: [
            { title: queryRegex },
            { description: queryRegex },
            { "servicesProvided.title": queryRegex },
            { "servicesProvided.description": queryRegex },
            { "servicesProvided.categories.label": queryRegex },
          ],
        },
      });
    }

    // Group back to service level
    pipeline.push({
      $group: {
        _id: "$_id",
        userId: { $first: "$userId" },
        title: { $first: "$title" },
        description: { $first: "$description" },
        isActive: { $first: "$isActive" },
        country: { $first: "$country" },
        location: { $first: "$location" },
        distanceMeters: { $first: "$distanceMeters" },
        createdAt: { $first: "$createdAt" },
        servicesProvided: { $push: "$servicesProvided" },
      },
    });

    // lookup user
    pipeline.push({
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    });
    pipeline.push({
      $unwind: { path: "$user", preserveNullAndEmptyArrays: true },
    });

    // Now facet: items + meta + totalCount
    const sortStage = useGeoNear
      ? { distanceMeters: 1 }
      : body.sort === "title_asc"
      ? { title: 1 }
      : body.sort === "title_desc"
      ? { title: -1 }
      : { createdAt: -1 };

    pipeline.push({
      $facet: {
        items: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: "$_id",
              title: 1,
              description: 1,
              isActive: 1,
              country: 1,
              location: 1,
              distanceKm: {
                $cond: [
                  { $ifNull: ["$distanceMeters", false] },
                  { $divide: ["$distanceMeters", 1000] },
                  null,
                ],
              },
              createdAt: 1,
              user: {
                _id: "$user._id",
                name: "$user.name",
                email: "$user.email",
              },
              servicesProvided: 1,
            },
          },
        ],
        meta: [
          // unwind servicesProvided and categories to collect counts
          {
            $unwind: {
              path: "$servicesProvided",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$servicesProvided.categories",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $group: {
              _id: null,
              serviceKeyCounts: { $push: "$servicesProvided.serviceKey" },
              categoryRefs: {
                $push: "$servicesProvided.categories.categoryRef",
              },
              countries: { $push: "$country" }, // collect country field values (may be null)
            },
          },
          {
            $project: {
              serviceKeyCounts: 1,
              categoryRefs: 1,
              countries: 1,
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    });

    const agg = await Service.aggregate(pipeline).allowDiskUse(true);
    const data = agg[0] || { items: [], meta: [], totalCount: [] };

    const items = data.items || [];
    const total = (data.totalCount[0] && data.totalCount[0].count) || 0;
    const totalPages = Math.ceil(total / limit);

    // Build filter counts
    let serviceKeyCounts = [];
    let categoryCounts = [];
    let countryCounts = [];

    if (data.meta && data.meta[0]) {
      const meta = data.meta[0];

      // serviceKeyCounts
      const skArr = (meta.serviceKeyCounts || []).filter(Boolean);
      const skMap = skArr.reduce((acc, sk) => {
        acc[sk] = (acc[sk] || 0) + 1;
        return acc;
      }, {});
      serviceKeyCounts = Object.keys(skMap)
        .map((k) => ({ serviceKey: k, count: skMap[k] }))
        .sort((a, b) => b.count - a.count);

      // categoryCounts (same as before)
      const catArr = (meta.categoryRefs || [])
        .filter(Boolean)
        .map((v) => (v && v.toString ? v.toString() : v));
      const catMap = catArr.reduce((acc, id) => {
        acc[id] = (acc[id] || 0) + 1;
        return acc;
      }, {});
      categoryCounts = Object.keys(catMap)
        .map((id) => ({ categoryId: id, count: catMap[id] }))
        .sort((a, b) => b.count - a.count);

      // countryCounts: normalize to trimmed lowercase key for counting, but return original-cased sample
      const countriesRaw = (meta.countries || [])
        .filter(Boolean)
        .map((c) => String(c).trim())
        .filter(Boolean);
      const cMap = {};
      for (const c of countriesRaw) {
        const key = c.toLowerCase();
        if (!cMap[key]) cMap[key] = { name: c, count: 0 };
        cMap[key].count += 1;
      }
      countryCounts = Object.keys(cMap)
        .map((k) => ({ country: cMap[k].name, count: cMap[k].count }))
        .sort((a, b) => b.count - a.count);
    }

    return res.json({
      success: true,
      filters: {
        serviceKeyCounts,
        categoryCounts,
        countryCounts,
      },
      services: items,
      pagination: { page, limit, totalServices: total, totalPages },
    });
  } catch (err) {
    console.error("searchServices error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createService,
  updateService,
  getServiceById,
  deleteService,
  searchServices,
};
