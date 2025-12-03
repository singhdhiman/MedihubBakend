// routes/serviceRoutes.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/serviceController");

router.post("/", controller.createService);
router.put("/:id", controller.updateService);
router.get("/:id", controller.getServiceById);
router.delete("/:id", controller.deleteService);

router.post("/search", controller.searchServices);

module.exports = router;
