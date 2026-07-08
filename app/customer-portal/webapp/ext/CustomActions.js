sap.ui.define([], function () {
  "use strict";

  // Sibling customer apps (EPIC21-T3 split) are separate sap.fe.core
  // AppComponents with no shared Fiori Launchpad shell, so cross-app
  // navigation has to be a plain window.location redirect, not an in-app
  // router.navTo. cds-serve hosts every app's static webapp/ folder under
  // one origin as a sibling path (confirmed via its own generated welcome
  // page: "/customer-offers/webapp", "/customer-reservations/webapp", etc.)
  // — origin-relative paths work both for that normal deployment and for
  // BTP/approuter-fronted deployments, where an absolute localhost:PORT
  // (only ever valid for an isolated `ui5 serve` dev session) would 404.
  var SIBLING_APPS = {
    reservations: "/customer-reservations/webapp/index.html",
    offers: "/customer-offers/webapp/index.html",
    testdrives: "/customer-testdrives/webapp/index.html",
    orders: "/customer-orders/webapp/index.html",
    payments: "/customer-payments/webapp/index.html",
  };

  return {
    // Bound to the Object Page header's "Back to List" custom action
    // (manifest.json, VehiclesObjectPage target). Not a CDS/server action —
    // pure client-side navigation, hardcoded to the app's own list route
    // rather than window.history.back(), so it works the same way whether
    // the user got here via a row click or a deep/bookmarked link (which
    // may have no "list" entry in browser history at all).
    onBackToList: function () {
      window.location.hash = "#/";
    },

    onNavReservations: function () {
      window.location.href = SIBLING_APPS.reservations;
    },

    onNavOffers: function () {
      window.location.href = SIBLING_APPS.offers;
    },

    onNavTestDrives: function () {
      window.location.href = SIBLING_APPS.testdrives;
    },

    onNavOrders: function () {
      window.location.href = SIBLING_APPS.orders;
    },

    onNavPayments: function () {
      window.location.href = SIBLING_APPS.payments;
    },

    // Mocked auth (package.json cds.requires.auth.kind: mocked) is plain
    // HTTP Basic — the browser caches the credentials against the origin
    // and there is no server-side session/token to invalidate. The standard
    // workaround: issue one request with deliberately wrong credentials via
    // the three-arg XHR#open overload, which overwrites the browser's
    // cached credential for this origin/realm with a bad one. The next
    // request the app makes gets a fresh 401 and the browser re-prompts.
    onLogout: function () {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/", true, "logout", "logout");
      xhr.onloadend = function () {
        window.location.href = window.location.origin + window.location.pathname;
      };
      xhr.send();
    },
  };
});
