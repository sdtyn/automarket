using {automarket} from '../db/favorites';

// FavoritesService is restricted to authenticated Customers only.
// Guests are excluded because Favorites drives notification subscriptions
// which require a durable identity (email address) to deliver to.
@impl: 'modules/favorites/application/favorites-service.js'
service FavoritesService @(path: '/favorites') {

    // Favorites is exposed read-only with a row-level filter so each Customer
    // sees only their own rows. The $user predicate maps to req.user.id at
    // runtime — no handler code needed for the read path.
    // addFavorite/removeFavorite are explicit actions so customer_ID is always
    // taken from the token, never from the request body.
    @restrict: [{
        grant: 'READ',
        to   : 'Customer',
        where: 'customer_ID = $user'
    }]
    entity Favorites  as projection on automarket.Favorites;

    // addFavorite: records a customer–vehicle link.
    // Duplicate entries are rejected by the @assert.unique constraint on the entity.
    @requires: 'Customer'
    action   addFavorite(vehicleId: String)    returns String;

    // removeFavorite: deletes the customer–vehicle link.
    // No-ops silently if the favorite does not exist.
    @requires: 'Customer'
    action   removeFavorite(vehicleId: String) returns Boolean;

    // listFavorites: convenience function that returns the same row set as
    // GET /favorites/Favorites for clients that prefer a function call.
    @requires: 'Customer'
    function listFavorites()                   returns array of Favorites;
}
