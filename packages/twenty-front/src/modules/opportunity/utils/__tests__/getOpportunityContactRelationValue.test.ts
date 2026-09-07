import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { getOpportunityContactRelationValue } from '@/opportunity/utils/getOpportunityContactRelationValue';

const person = {
  id: 'person-1',
  __typename: 'Person',
  name: { firstName: 'Alex', lastName: 'Example' },
};
const opportunity = {
  id: 'opportunity-1',
  __typename: 'Opportunity',
  name: 'Example grant',
};

describe('unified opportunity contacts', () => {
  it('should include a legacy primary with all linked people without changing stored data', () => {
    const record = {
      ...opportunity,
      pointOfContact: person,
      additionalContacts: [
        {
          id: 'link-2',
          __typename: 'OpportunityContact',
          person: { ...person, id: 'person-2' },
        },
      ],
    };
    const before = structuredClone(record);
    const links = getOpportunityContactRelationValue(
      record,
      'additionalContacts',
    ) as ObjectRecord[];
    expect(links.map((link) => link.person.id)).toEqual([
      'person-1',
      'person-2',
    ]);
    expect(record).toEqual(before);
  });

  it('should show an opportunity only once when the person is both primary and linked', () => {
    const record = {
      ...person,
      pointOfContactForOpportunities: [opportunity],
      additionalOpportunities: [
        { id: 'link-1', __typename: 'OpportunityContact', opportunity },
        {
          id: 'link-2',
          __typename: 'OpportunityContact',
          opportunity: { ...opportunity, id: 'opportunity-2' },
        },
      ],
    };
    const links = getOpportunityContactRelationValue(
      record,
      'additionalOpportunities',
    ) as ObjectRecord[];
    expect(links.map((link) => link.opportunity.id)).toEqual([
      'opportunity-1',
      'opportunity-2',
    ]);
  });

  it('should retain legacy primary opportunities when the person has no junction links', () => {
    const links = getOpportunityContactRelationValue(
      {
        ...person,
        pointOfContactForOpportunities: [opportunity],
        additionalOpportunities: [],
      },
      'additionalOpportunities',
    ) as ObjectRecord[];
    expect(links).toEqual([
      expect.objectContaining({
        opportunityId: opportunity.id,
        personId: person.id,
        opportunity,
      }),
    ]);
  });

  it('should reflect a removed contact and keep the remaining primary', () => {
    const links = getOpportunityContactRelationValue(
      {
        ...opportunity,
        pointOfContact: person,
        additionalContacts: [],
      },
      'additionalContacts',
    ) as ObjectRecord[];
    expect(links.map((link) => link.person.id)).toEqual([person.id]);
  });

  it('should leave unrelated and custom fields unchanged', () => {
    const custom = {
      id: 'custom',
      __typename: 'Custom',
      additionalContacts: [person],
      pointOfContact: person,
    };
    expect(
      getOpportunityContactRelationValue(custom, 'additionalContacts'),
    ).toBe(custom.additionalContacts);
    expect(getOpportunityContactRelationValue(opportunity, 'name')).toBe(
      opportunity.name,
    );
  });
});
