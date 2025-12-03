const express = require("express");

const {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  getCategoryTree,
} = require("../controllers/categoriesController");

const router = express.Router();

// ✅ Get category tree (nested)
router.get("/all", getCategoryTree);

// ✅ Create new category
router.post("/", createCategory);

// ✅ Get all categories (flat)
router.get("/", getAllCategories);

// ✅ Get category by ID
router.get("/:id", getCategoryById);

// ✅ Update category
router.put("/:id", updateCategory);

// ✅ Delete category
router.delete("/:id", deleteCategory);

module.exports = router;
