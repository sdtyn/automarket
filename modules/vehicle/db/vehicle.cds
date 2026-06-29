namespace automarket;

using {BaseEntity} from '../../../shared/types/common';
using {automarket.Branches} from '../../branch/db/branch';

// Vehicles is the central aggregate of the AutoMarket domain. Its row is
// locked (SELECT FOR UPDATE) during every state transition so that concurrent
// reservation and checkout requests cannot race past the guard checks.
// Keep this entity lean — Reservation, Offer, and TestDrive reference it by ID
// only to avoid widening the lock scope.
entity Vehicles : BaseEntity {
    vin          : String(17); // ISO 3779 — always 17 chars
    plateNumber  : String(20);
    brand        : String(100);
    model        : String(100);
    year         : Integer;
    mileage      : Integer; // in km
    fuelType     : FuelType;
    transmission : Transmission;
    color        : String(50);
    price        : Decimal(15, 2);
    currency     : String(3) default 'TRY';
    status       : VehicleStatus default 'DRAFT';
    branch       : Association to Branches;
    // images is a composition so that VehicleImages rows are owned by the Vehicle
    // aggregate and deleted automatically when the Vehicle is deleted.
    images       : Composition of many VehicleImages
                       on images.vehicle = $self;
}

// VehicleImages is part of the Vehicle aggregate. SortOrder controls display
// sequence in the catalog; the handler must reject duplicate sortOrder values
// within the same vehicle to avoid ambiguous ordering.
entity VehicleImages : BaseEntity {
    vehicle   : Association to Vehicles;
    url       : String(1000);
    sortOrder : Integer default 0;
}

// VehicleStatus mirrors the authoritative state machine in the Implementation
// Architecture Document §13. Do not add or remove values here without updating
// VehicleStateMachine.js — the two must stay in sync.
type VehicleStatus : String enum {
    DRAFT;
    FOR_SALE;
    RESERVED;
    PENDING_PAYMENT;
    SOLD;
    DELIVERED;
    ARCHIVED;
};

type FuelType      : String enum {
    PETROL;
    DIESEL;
    ELECTRIC;
    HYBRID;
    LPG;
};

type Transmission  : String enum {
    MANUAL;
    AUTOMATIC;
    SEMI_AUTOMATIC;
};
