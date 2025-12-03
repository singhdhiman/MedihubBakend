// controllers/userCardController.js
const UserCard = require("../models/UserCardSchema");
const mongoose = require("mongoose");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Create a new user card
async function createUserCard(req, res) {
  try {
    // prefer authenticated user id if available
    const userId = req.body.userId || req.user?.userId;
    if (!userId || !isValidObjectId(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    // Basic payload (you can validate more using Joi / express-validator)
    const payload = {
      userId,
      displayName: req.body.displayName,
      phone: req.body.phone,
      addressLine1: req.body.addressLine1,
      addressLine2: req.body.addressLine2,
      city: req.body.city,
      state: req.body.state,
      postalCode: req.body.postalCode,
      country: req.body.country,
      companyName: req.body.companyName,
      logoUrl: req.body.logoUrl,
      gstNumber: req.body.gstNumber,
    };

    const card = await UserCard.create(payload);
    return res.status(201).json({ message: "UserCard created", card });
  } catch (err) {
    console.error("createUserCard error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// Get all cards for a user (query param userId or authenticated)
async function getUserCards(req, res) {
  try {
    const userIdRaw = req.query.userId || req.user?.userId;
    if (!userIdRaw || !isValidObjectId(userIdRaw)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userIdRaw);

    const cards = await UserCard.find({
      userId: userObjectId,
      isDeleted: { $ne: true },
    }).sort({ createdAt: -1 });

    return res.json({ cards });
  } catch (err) {
    console.error("getUserCards error", err);
    return res.status(500).json({ message: "Server error" });
  }
}
// Get single card by id
async function getUserCardById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });

    const card = await UserCard.findOne({ _id: id, isDeleted: false });
    if (!card) return res.status(404).json({ message: "UserCard not found" });

    return res.json({ card });
  } catch (err) {
    console.error("getUserCardById error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// Update card (partial updates allowed)
async function updateUserCard(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });

    const update = { ...req.body };
    // prevent updating userId directly
    delete update.userId;
    delete update.isDeleted;

    const card = await UserCard.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    if (!card) return res.status(404).json({ message: "UserCard not found" });
    return res.json({ message: "UserCard updated", card });
  } catch (err) {
    console.error("updateUserCard error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// Soft delete card
async function deleteUserCard(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ message: "Invalid id" });

    const card = await UserCard.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );

    if (!card) return res.status(404).json({ message: "UserCard not found" });
    return res.json({ message: "UserCard deleted", card });
  } catch (err) {
    console.error("deleteUserCard error", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createUserCard,
  getUserCards,
  getUserCardById,
  updateUserCard,
  deleteUserCard,
};
