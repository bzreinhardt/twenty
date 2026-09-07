import { groupOpportunityIdsByContact } from 'src/modules/opportunity/utils/group-opportunity-ids-by-contact.util';

describe('groupOpportunityIdsByContact', () => {
  it('should include every primary and additional contact across opportunities without duplicates', () => {
    const result = groupOpportunityIdsByContact({
      opportunities: [
        { id: 'first', pointOfContactId: 'primary' },
        { id: 'second', pointOfContactId: null },
      ],
      additionalContacts: [
        { opportunityId: 'first', personId: 'primary' },
        { opportunityId: 'first', personId: 'additional' },
        { opportunityId: 'second', personId: 'additional' },
      ],
    });
    expect(result.get('primary')).toEqual(['first']);
    expect(result.get('additional')).toEqual(['first', 'second']);
  });

  it('should exclude links to deleted or inaccessible opportunities', () => {
    expect(
      groupOpportunityIdsByContact({
        opportunities: [],
        additionalContacts: [{ opportunityId: 'deleted', personId: 'person' }],
      }).size,
    ).toBe(0);
  });
});
