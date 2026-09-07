import { buildFindOneRecordForShowPageOperationSignature } from '@/object-record/record-show/graphql/operations/factories/findOneRecordForShowPageOperationSignatureFactory';
import { getMockFieldMetadataItemOrThrow } from '~/testing/utils/getMockFieldMetadataItemOrThrow';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';
import { getTestEnrichedObjectMetadataItemsMock } from '~/testing/utils/getTestEnrichedObjectMetadataItemsMock';

const person = getMockObjectMetadataItemOrThrow('person');
const primary = getMockFieldMetadataItemOrThrow({
  objectMetadataItem: person,
  fieldName: 'pointOfContactForOpportunities',
});
const combined = {
  ...primary,
  id: 'combined-field',
  name: 'additionalOpportunities',
};
const objectMetadataItem = { ...person, fields: [...person.fields, combined] };
const build = (identifier: string) =>
  buildFindOneRecordForShowPageOperationSignature({
    objectMetadataItem,
    objectMetadataItems: getTestEnrichedObjectMetadataItemsMock(),
    visibleFieldIdentifiers: new Set([identifier]),
  }).fields;

describe('person opportunity data for existing layouts', () => {
  it.each([primary.id, primary.name])(
    'should fetch both contact relations when the visible list uses %s',
    (identifier) => {
      expect(build(identifier)).toHaveProperty(
        'pointOfContactForOpportunities',
      );
      expect(build(identifier)).toHaveProperty('additionalOpportunities');
    },
  );
  it('should keep hidden to-many relations out of the page query', () => {
    expect(build('name')).not.toHaveProperty('additionalOpportunities');
    expect(build('name')).not.toHaveProperty('pointOfContactForOpportunities');
  });
});
