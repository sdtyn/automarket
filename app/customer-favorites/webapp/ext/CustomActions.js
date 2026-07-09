sap.ui.define([], function () {
  "use strict";

  // Sibling customer apps (EPIC22-T3, cross-app nav on every List Report —
  // not just the Vehicle Catalog's — added after the user caught the first
  // version's hardcoded ui5-serve dev ports, cap-notes.md #17). cds-serve
  // hosts every app's static webapp/ folder under one origin as a sibling
  // path, so these are origin-relative, not absolute localhost:PORT URLs.
  var SIBLING_APPS = {
    catalog: "/customer-portal/webapp/index.html",
    reservations: "/customer-reservations/webapp/index.html",
    offers: "/customer-offers/webapp/index.html",
    testdrives: "/customer-testdrives/webapp/index.html",
    orders: "/customer-orders/webapp/index.html",
    payments: "/customer-payments/webapp/index.html",
  };

  return {
    // Bound to the Object Page header's "Back to List" custom action
    // (manifest.json, FavoritesObjectPage target). Not a CDS/server
    // action — pure client-side navigation, hardcoded to the app's own list
    // route rather than window.history.back(), so it works the same way
    // whether the user got here via a row click or a deep/bookmarked link
    // (which may have no "list" entry in browser history at all).
    onBackToList: function () {
      window.location.hash = "#/";
    },

    onNavCatalog: function () {
      window.location.href = SIBLING_APPS.catalog;
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

    // Custom Object Page header action — its press handler receives the
    // bound sap.ui.model.odata.v4.Context as its first argument (confirmed
    // empirically against a live app, not documented anywhere reachable —
    // cap-notes.md #18), so oContext.getObject() gives the current
    // Favorite row's data with no extra fetch. Navigates to the same
    // vehicle's own Object Page in the separate customer-portal app —
    // there's no in-app route for Vehicles here (each app owns exactly one
    // entity's List Report/Object Page pair, cap-notes.md #12), so this has
    // to be a plain redirect, like the sibling-app nav buttons.
    onViewVehicle: function (oContext) {
      var sVehicleId = oContext.getObject().vehicle_ID;
      window.location.href = "/customer-portal/webapp/index.html#/Vehicles(" + sVehicleId + ")";
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
