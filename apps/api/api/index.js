// Vercel function: every request to /api/... is rewritten to this file (see vercel.json) and served by the Nest app built into dist/.
// dist/serverless.bundle.js is the compiled app with @nestjs/* folded in (see scripts/bundle-serverless.mjs):
// Vercel cannot require() the ES-module NestJS packages directly.
// The app's own routes have no /api prefix (/auth/login, /tickets), so it is removed here.
const handler = require('../dist/serverless.bundle').default;

module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api(?=\/|\?|$)/, '') || '/';
  return handler(req, res);
};
