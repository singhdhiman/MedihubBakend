// routes/company.routes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/companyController");
// const { auth } = require("../middleware/auth"); // if needed

router.get("/search", ctrl.searchCompanies);
router.get("/:id", ctrl.getCompanyById);
router.post("/", /*auth,*/ ctrl.createCompany);
router.patch("/:id", /*auth,*/ ctrl.updateCompany);
router.patch("/:id/active", /*auth,*/ ctrl.toggleActive);

module.exports = router;
