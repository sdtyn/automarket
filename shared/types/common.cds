using { managed, cuid } from '@sap/cds/common';

aspect BaseEntity : cuid, managed {
}

type CurrencyCode : String(3);
type Email        : String(255);
type PhoneNumber  : String(50);
