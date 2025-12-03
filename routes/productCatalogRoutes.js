const express = require("express");
const router = express.Router();
const {
  createProductCatalog,
  searchProductCatalog,
} = require("../controllers/productCatalogController");

router.post("/", createProductCatalog);
router.post("/search", searchProductCatalog);

module.exports = router;
