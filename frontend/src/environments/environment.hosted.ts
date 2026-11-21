// Build with `ng build --configuration hosted` for Firebase Hosting.
// Hosting serves static files only, so it cannot proxy /api to the Render origin
// the way backend/server.js does locally — the API URL has to be absolute here.
export const environment = {
  production: true,
  apiUrl: 'https://mehndi-erp-api.onrender.com/api'
};
