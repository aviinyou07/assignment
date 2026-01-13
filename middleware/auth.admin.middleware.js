const jwt = require("jsonwebtoken");

exports.authGuard = (roles = []) => {
  return (req, res, next) => {
    try {
      const token = req.cookies.token;

      if (!token) {
        return res.redirect("/login");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).render("errors/403", {
          title: "Forbidden"
        });
      }

      next();
    } catch (err) {
      console.error("Auth error:", err.message);
      res.clearCookie("token");
      return res.redirect("/login");
    }
  };
};
