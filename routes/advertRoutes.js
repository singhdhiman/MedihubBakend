const express = require("express");
const router = express.Router();
const {
  createAdvert,
  listAdverts,
} = require("../controllers/advertController");

router.post("/", createAdvert); // create new advert
router.post("/search", listAdverts); // list with filters (POST /api/adverts/search)

module.exports = router;
