// routes/userCardRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/userCardController");

// Create
router.post("/", /* auth, */ controller.createUserCard);

// List by user (query ?userId=... or authenticated)
router.get("/", /* auth, */ controller.getUserCards);

// Get by id
router.get("/:id", /* auth, */ controller.getUserCardById);

// Update
router.put("/:id", /* auth, */ controller.updateUserCard);

// Delete (soft)
router.delete("/:id", /* auth, */ controller.deleteUserCard);

module.exports = router;
