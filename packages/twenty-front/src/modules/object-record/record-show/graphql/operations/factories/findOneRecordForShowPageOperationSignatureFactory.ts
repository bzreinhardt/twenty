import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { generateDepthRecordGqlFieldsFromFields } from '@/object-record/graphql/record-gql-fields/utils/generateDepthRecordGqlFieldsFromFields';
import { type RecordGqlOperationSignatureFactory } from '@/object-record/graphql/types/RecordGqlOperationSignatureFactory';
import { FieldMetadataType, RelationType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

type FindOneRecordForShowPageOperationSignatureFactory = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  objectMetadataItems: EnrichedObjectMetadataItem[];
  visibleFieldIdentifiers?: Set<string>;
};

// To-many relations are the expensive part of the findOne: each one fans out
// into its own server-side query returning up to 60 nested rows.
const isToManyRelationField = (fieldMetadataItem: FieldMetadataItem) =>
  (fieldMetadataItem.type === FieldMetadataType.RELATION ||
    fieldMetadataItem.type === FieldMetadataType.MORPH_RELATION) &&
  (fieldMetadataItem.settings?.relationType === RelationType.ONE_TO_MANY ||
    fieldMetadataItem.relation?.type === RelationType.ONE_TO_MANY);

export const buildFindOneRecordForShowPageOperationSignature: RecordGqlOperationSignatureFactory<
  FindOneRecordForShowPageOperationSignatureFactory
> = ({
  objectMetadataItem,
  objectMetadataItems,
  visibleFieldIdentifiers,
}: FindOneRecordForShowPageOperationSignatureFactory) => {
  const primaryOpportunitiesField = objectMetadataItem.fields.find(
    (field) => field.name === 'pointOfContactForOpportunities',
  );
  // Existing people layouts still name the primary inverse. Their built-in
  // Opportunities widget now displays the combined contact collection.
  const shouldFetchAdditionalOpportunities =
    objectMetadataItem.nameSingular === 'person' &&
    isDefined(primaryOpportunitiesField) &&
    (visibleFieldIdentifiers?.has(primaryOpportunitiesField.id) === true ||
      visibleFieldIdentifiers?.has(primaryOpportunitiesField.name) === true);

  // Scalar and to-one fields are always fetched; to-many relations only when
  // the record page layout can actually display them (or when the layout
  // cannot be resolved, in which case visibleFieldIdentifiers is undefined).
  const fieldsToFetch = isDefined(visibleFieldIdentifiers)
    ? objectMetadataItem.fields.filter(
        (fieldMetadataItem) =>
          !isToManyRelationField(fieldMetadataItem) ||
          (shouldFetchAdditionalOpportunities &&
            fieldMetadataItem.name === 'additionalOpportunities') ||
          visibleFieldIdentifiers.has(fieldMetadataItem.id) ||
          visibleFieldIdentifiers.has(fieldMetadataItem.name),
      )
    : objectMetadataItem.fields;

  return {
    objectNameSingular: objectMetadataItem.nameSingular,
    variables: {},
    fields: {
      ...generateDepthRecordGqlFieldsFromFields({
        objectMetadataItems,
        sourceObjectMetadataItem: objectMetadataItem,
        fields: fieldsToFetch,
        depth: 1,
      }),
    },
  };
};
