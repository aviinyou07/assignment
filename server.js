require("dotenv").config();
// Validate environment early
try {
  require('./utils/env').validateEnv();
} catch (err) {
  console.error('Environment validation failed:', err && err.message ? err.message : err);
  process.exit(1);
}

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const expressLayouts = require("express-ejs-layouts");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  }
});


const port = process.env.PORT || 3000;

// =======================
// SOCKET.IO & REAL-TIME SETUP
// =======================
const { socketAuthMiddleware } = require("./middleware/socket.auth.middleware");
const { initializeRealtime } = require("./utils/realtime");
const { initializeDeadlineReminders } = require("./utils/deadline-reminders");
const { setIO } = require('./utils/socket');

io.use(socketAuthMiddleware);
initializeRealtime(io);
initializeDeadlineReminders(io);

// Store global io instance for services/controllers that don't have req.io
setIO(io);

// Make io accessible to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// =======================
// VIEW ENGINE
// =======================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layouts/admin");
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);
app.use(expressLayouts);

// =======================
// MIDDLEWARE
// =======================
app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// =======================
// API / MODULE ROUTES
// =======================
app.use("/master/countries", require("./routes/masterCountries"));

// Client API (new enterprise routes)
app.use("/client", require("./routes/client.api.routes"));

// Legacy client routes (for backward compatibility)
app.use("/auth/client", require("./routes/auth.client.routes"));
app.use("/client", require("./routes/client.profile.routes"));
app.use("/client/security", require("./routes/client.security.routes"));
app.use("/client", require("./routes/client.queries.routes"));

// Shared routes
app.use("/notifications", require("./routes/notifications.routes"));
app.use("/chat", require("./routes/chat.routes"));

// Role-based routes
app.use("/bde", require("./routes/bde.routes"));
app.use("/admin", require("./routes/admin.routes"));
app.use("/auth", require("./routes/auth.admin.routes"));
app.use("/writer", require("./routes/writer.routes"));

// =======================
// AUTH PAGES
// =======================
app.get("/login", (req, res) => {
  res.render("auth/login", {
    title: "Login | Assignment366",
    layout: false
  });
});

app.get("/register", (req, res) => {
  res.render("auth/register", {
    title: "Register | Assignment366",
    layout: false
  });
});

// =======================
// 404
// =======================
app.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    layout: false
  });
});

// =======================
// DB + SERVER
// =======================
const db = require("./config/db");
db.connect();

server.listen(port, () => {
  const logger = require('./utils/logger');
  logger.info(`Server running at http://localhost:${port}`);
  logger.info('Real-time WebSocket active');
});
