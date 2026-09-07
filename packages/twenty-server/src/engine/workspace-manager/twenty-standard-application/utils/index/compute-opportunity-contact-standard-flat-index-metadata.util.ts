import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildOpportunityContactStandardFlatIndexMetadatas = (
  args: Omit<CreateStandardIndexArgs<'opportunityContact'>, 'context'>,
): Record<
  AllStandardObjectIndexName<'opportunityContact'>,
  FlatIndexMetadata
> => ({
  opportunityIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'opportunityIdIndex',
      relatedFieldNames: ['opportunity'],
    },
  }),
  personIdIndex: createStandardIndexFlatMetadata({
    ...args,
    context: { indexName: 'personIdIndex', relatedFieldNames: ['person'] },
  }),
  opportunityPersonUniqueIndex: createStandardIndexFlatMetadata({
    ...args,
    context: {
      indexName: 'opportunityPersonUniqueIndex',
      relatedFieldNames: ['opportunity', 'person'],
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    },
  }),
});
