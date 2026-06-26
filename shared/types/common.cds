using { managed, cuid } from '@sap/cds/common';

// BaseEntity is the root aspect for every entity in this project.
// - cuid: CAP auto-generates a UUID primary key (field: ID) so we never manage
//   key generation manually and avoid sequential ID enumeration attacks.
// - managed: CAP auto-populates createdAt, createdBy, modifiedAt, modifiedBy on
//   every INSERT/UPDATE, giving us a free audit trail without extra handler code.
aspect BaseEntity : cuid, managed {
}

// Named scalar types so that changing a max-length is a one-line edit here
// rather than a search-and-replace across every entity that uses the field.
type CurrencyCode : String(3);
type Email        : String(255);
type PhoneNumber  : String(50);
