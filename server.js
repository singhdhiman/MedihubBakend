// server.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const http = require("http");

const authRoutes = require("./routes/auth");
const userCardRoutes = require("./routes/userCardRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productCatalogRoutes = require("./routes/productCatalogRoutes");
const advertRoutes = require("./routes/advertRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const productModelRoutes = require("./routes/productModelRoutes");
const companyRoutes = require("./routes/companyRoutes");
const subscriptionRouter = require("./routes/subscriptionRoutes");
const { initSocket } = require("./sockets/socket");
const subscriptionController = require("./controllers/subscriptionController");

const app = express();

app.use(cookieParser());

app.use(express.json()); // to parse JSON body
app.use(express.urlencoded({ extended: true })); // to parse form data

app.get("/", (req, res) => res.send("Auth server running"));

app.use("/api/auth", authRoutes);
app.use("/api/user-cards", userCardRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/product-catalog", productCatalogRoutes);
app.use("/api/adverts", advertRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/models", productModelRoutes);
app.use("/api/companies", companyRoutes);
app.use(
  express.json({
    verify: (req, res, buf) => {
      // Only set rawBody for requests that have a body
      if (buf && buf.length) {
        req.rawBody = buf;
      }
    },
  })
);

app.use("/api", subscriptionRouter);

const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("MongoDB connected");

    const server = http.createServer(app);
    initSocket(server, {
      cors: {
        origin: process.env.CLIENT_ORIGIN || "*",
        methods: ["GET", "POST"],
      },
    });

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(
      "MongoDB connection error:",
      err && err.message ? err.message : err
    );
    process.exit(1);
  });
