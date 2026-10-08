// Vercel function: every request to /api/... is served by the Nest app built into dist/.
// The app's own routes have no /api prefix (/auth/login, /tickets), so it is removed here.
const handler = require('../dist/serverless').default;

module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api(?=\/|\?|$)/, '') || '/';
  return handler(req, res);
};
