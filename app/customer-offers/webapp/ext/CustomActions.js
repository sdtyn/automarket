sap.ui.define([], function () {
  "use strict";

  return {
    // Bound to the Object Page header's "Back to List" custom action
    // (manifest.json, OffersObjectPage target). Not a CDS/server action —
    // pure client-side navigation, hardcoded to the app's own list route
    // rather than window.history.back(), so it works the same way whether
    // the user got here via a row click or a deep/bookmarked link (which
    // may have no "list" entry in browser history at all).
    onBackToList: function () {
      window.location.hash = "#/";
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
