// This file replaces environment.ts during `ng build --configuration production`
// (see angular.json > fileReplacements). '/api' keeps the build origin-agnostic:
// the same bundle works on localhost, the tunnel URL and any domain you point at it.
export const environment = {
  production: true,
  apiUrl: '/api'
};
