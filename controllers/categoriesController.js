// controllers/categoryController.js (add)
const Category = require("../models/CategorySchema");

// 🟢 Create Category
async function createCategory(req, res) {
  try {
    const { name, parentCategory, slug, description } = req.body;

    const category = new Category({
      name,
      parentCategory: parentCategory || null,
      description,
    });

    await category.save();
    res
      .status(201)
      .json({ message: "Category created successfully", category });
  } catch (error) {
    console.error("Error creating category:", error);
    res
      .status(500)
      .json({ message: "Failed to create category", error: error.message });
  }
}

// 🟡 Get All Categories (Flat list)
async function getAllCategories(req, res) {
  try {
    const categories = await Category.find()
      .populate("parentCategory", "name")
      .sort({ createdAt: -1 });
    res.status(200).json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch categories", error: error.message });
  }
}

// 🟣 Get Single Category by ID
async function getCategoryById(req, res) {
  try {
    const category = await Category.findById(req.params.id).populate(
      "parentCategory",
      "name"
    );
    if (!category)
      return res.status(404).json({ message: "Category not found" });
    res.status(200).json(category);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch category", error: error.message });
  }
}

// 🟠 Update Category
async function updateCategory(req, res) {
  try {
    const { name, parentCategory, slug, description } = req.body;

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, parentCategory: parentCategory || null, slug, description },
      { new: true, runValidators: true }
    );

    if (!category)
      return res.status(404).json({ message: "Category not found" });
    res
      .status(200)
      .json({ message: "Category updated successfully", category });
  } catch (error) {
    console.error("Error updating category:", error);
    res
      .status(500)
      .json({ message: "Failed to update category", error: error.message });
  }
}

// 🔴 Delete Category (and handle child categories)
async function deleteCategory(req, res) {
  try {
    const categoryId = req.params.id;

    const existing = await Category.findById(categoryId);
    if (!existing)
      return res.status(404).json({ message: "Category not found" });

    // Optionally, reassign or delete children
    const children = await Category.find({ parentCategory: categoryId });
    if (children.length > 0) {
      // Delete children recursively
      for (const child of children) {
        await deleteCategoryRecursive(child._id);
      }
    }

    await Category.findByIdAndDelete(categoryId);
    res
      .status(200)
      .json({ message: "Category and subcategories deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res
      .status(500)
      .json({ message: "Failed to delete category", error: error.message });
  }
}

async function deleteCategoryRecursive(id) {
  const children = await Category.find({ parentCategory: id });
  for (const child of children) {
    await deleteCategoryRecursive(child._id);
  }
  await Category.findByIdAndDelete(id);
}

async function getCategoryTree(req, res) {
  // fetch all categories and build tree in-memory (fast for moderately sized lists)
  const categories = await Category.find().lean().sort({ name: 1 });

  const map = new Map();
  categories.forEach((c) => {
    c.children = [];
    map.set(String(c._id), c);
  });

  const roots = [];
  categories.forEach((c) => {
    if (c.parentCategory) {
      const parent = map.get(String(c.parentCategory));
      if (parent) parent.children.push(c);
      else roots.push(c);
    } else {
      roots.push(c);
    }
  });

  res.json(roots);
}

module.exports = {
  getCategoryTree,
  deleteCategory,
  updateCategory,
  getCategoryById,
  getAllCategories,
  createCategory,
};
