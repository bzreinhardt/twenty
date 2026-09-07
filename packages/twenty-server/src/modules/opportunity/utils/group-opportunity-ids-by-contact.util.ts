import { isDefined } from 'twenty-shared/utils';

export const groupOpportunityIdsByContact = ({
  opportunities,
  additionalContacts,
}: {
  opportunities: { id: string; pointOfContactId: string | null }[];
  additionalContacts: { opportunityId: string; personId: string }[];
}): Map<string, string[]> => {
  const liveOpportunityIds = new Set(opportunities.map(({ id }) => id));
  const opportunityIdsByPersonId = new Map<string, Set<string>>();
  const addContact = (opportunityId: string, personId: string) => {
    if (!liveOpportunityIds.has(opportunityId)) {
      return;
    }
    const opportunityIds =
      opportunityIdsByPersonId.get(personId) ?? new Set<string>();
    opportunityIds.add(opportunityId);
    opportunityIdsByPersonId.set(personId, opportunityIds);
  };

  for (const opportunity of opportunities) {
    if (isDefined(opportunity.pointOfContactId)) {
      addContact(opportunity.id, opportunity.pointOfContactId);
    }
  }
  for (const contact of additionalContacts) {
    addContact(contact.opportunityId, contact.personId);
  }

  return new Map(
    [...opportunityIdsByPersonId].map(([personId, opportunityIds]) => [
      personId,
      [...opportunityIds],
    ]),
  );
};
