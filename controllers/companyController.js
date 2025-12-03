// controllers/companyController.js
const Company = require("../models/CompanySchema");

// Create (or get existing) company
exports.createCompany = async (req, res) => {
  try {
    const {
      name,
      typeOfActivity,
      website,
      emails,
      phones,
      gstNumber,
      logoUrl,
      address,
      about,
    } = req.body;

    if (!name) return res.status(400).json({ message: "Name is required" });

    const normalizedName = String(name).toLowerCase().trim();
    const countryCode = address?.countryCode || null;

    // try to find an existing by normalizedName+countryCode
    let existing = await Company.findOne({
      normalizedName,
      ...(countryCode ? { "address.countryCode": countryCode } : {}),
    }).lean();

    if (existing)
      return res.status(200).json({ company: existing, existed: true });

    const company = await Company.create({
      name,
      normalizedName,
      typeOfActivity,
      website,
      emails,
      phones,
      gstNumber,
      logoUrl,
      address,
      about,
      createdBy: req.user?._id, // if you attach user in auth middleware
    });

    return res.status(201).json({ company, existed: false });
  } catch (err) {
    if (err?.code === 11000) {
      // unique index hit: return the existing record
      const dup = await Company.findOne({
        normalizedName: req.body.name?.toLowerCase().trim(),
        "address.countryCode": req.body.address?.countryCode,
      }).lean();
      return res.status(200).json({ company: dup, existed: true });
    }
    console.error("createCompany error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /companies/:id
exports.getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json({ company });
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
};

// PATCH /companies/:id
exports.updateCompany = async (req, res) => {
  try {
    const update = req.body || {};
    if (update.name) update.normalizedName = update.name.toLowerCase().trim();

    const company = await Company.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json({ company });
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ message: "Company already exists (name + country)" });
    }
    res.status(500).json({ message: "Server error" });
  }
};

// Lightweight search: GET /companies/search?q=bi&countryCode=IN&limit=10
exports.searchCompanies = async (req, res) => {
  try {
    const { q = "", countryCode, limit = 10 } = req.query;
    if (!q?.trim()) return res.json({ results: [] });

    const regex = new RegExp(
      q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    const filter = { $or: [{ name: regex }, { normalizedName: regex }] };
    if (countryCode) filter["address.countryCode"] = countryCode;

    const results = await Company.find(filter)
      .select(
        "name address.countryCode website phones emails logoUrl gstNumber typeOfActivity"
      )
      .sort({ name: 1 })
      .limit(Math.min(parseInt(limit, 10) || 10, 25))
      .lean();

    res.json({ results });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// (optional) soft delete / deactivate
exports.toggleActive = async (req, res) => {
  try {
    const { isActive } = req.body;
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { isActive: !!isActive },
      { new: true }
    ).lean();
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json({ company });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
