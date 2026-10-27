// Adds what app.json can't hold: the Firebase config for Android notifications. It stays out of git;
// EAS builds get it as a file variable (GOOGLE_SERVICES_JSON, see docs/deploy.md), local builds
// read apps/client/google-services.json when it's there.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = ({ config }) => {
  const local = join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (existsSync(local) ? './google-services.json' : undefined);
  return { ...config, android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) } };
};
