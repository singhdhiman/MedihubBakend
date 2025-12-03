// routes/productModelRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/productModelController");

// Create
router.post("/", controller.createModel);

// List
router.get("/", controller.listModels);

// Get one
router.get("/:id", controller.getModel);

// Update
router.put("/:id", controller.updateModel);

// Soft delete
router.delete("/:id", controller.deleteModel);

// Restore
router.post("/:id/restore", controller.restoreModel);

module.exports = router;
