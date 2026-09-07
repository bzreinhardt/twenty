import { isObjectWithId } from '@/object-record/record-field/ui/utils/junction/isObjectWithId';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

// Keep the legacy primary foreign key authoritative. Project it into the
// contact collection so old API clients and imports do not need dual writes.
export const getOpportunityContactRelationValue = (
  record: ObjectRecord | null | undefined,
  fieldName: string,
): unknown => {
  const value = record?.[fieldName];
  if (!record) return value;

  const isOpportunity =
    record.__typename === 'Opportunity' && fieldName === 'additionalContacts';
  const isPerson =
    record.__typename === 'Person' && fieldName === 'additionalOpportunities';
  if (!isOpportunity && !isPerson) return value;

  const links: ObjectRecord[] = Array.isArray(value) ? value : [];
  const primaryRecords: ObjectRecord[] = isOpportunity
    ? isObjectWithId(record.pointOfContact)
      ? [record.pointOfContact]
      : []
    : Array.isArray(record.pointOfContactForOpportunities)
      ? record.pointOfContactForOpportunities
      : [];
  const targetFieldName = isOpportunity ? 'person' : 'opportunity';
  const linkedIds = new Set(links.map((link) => link[targetFieldName]?.id));

  return [
    ...primaryRecords
      .filter((primaryRecord) => !linkedIds.has(primaryRecord.id))
      .map((primaryRecord) => ({
        id: `primary-contact:${record.id}:${primaryRecord.id}`,
        __typename: 'OpportunityContact',
        opportunityId: isOpportunity ? record.id : primaryRecord.id,
        personId: isOpportunity ? primaryRecord.id : record.id,
        [targetFieldName]: primaryRecord,
      })),
    ...links,
  ];
};
