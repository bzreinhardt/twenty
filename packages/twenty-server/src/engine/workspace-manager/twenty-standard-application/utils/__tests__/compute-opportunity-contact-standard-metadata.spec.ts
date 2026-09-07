import {
  STANDARD_OBJECTS,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-shared/metadata';
import { RelationOnDeleteAction, RelationType } from 'twenty-shared/types';

import { isDefined } from 'twenty-shared/utils';

import { findRelationPathsToPerson } from 'src/engine/core-modules/related-person-ids/utils/find-relation-paths-to-person.util';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const { allFlatEntityMaps } = computeTwentyStandardApplicationAllFlatEntityMaps(
  {
    workspaceId: '20202020-1111-4111-8111-111111111111',
    twentyStandardApplicationId: '20202020-2222-4222-8222-222222222222',
    now: '2026-01-01T00:00:00.000Z',
  },
);

describe('Opportunity contacts', () => {
  it('should preserve the existing primary contact relation for existing records and integrations', () => {
    expect(
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.opportunity.fields.pointOfContact.universalIdentifier
      ],
    ).toMatchObject({
      name: 'pointOfContact',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        joinColumnName: 'pointOfContactId',
        onDelete: RelationOnDeleteAction.SET_NULL,
      },
    });
  });

  it.each([
    [
      STANDARD_OBJECTS.opportunity.fields.additionalContacts,
      STANDARD_OBJECTS.opportunityContact.fields.person,
    ],
    [
      STANDARD_OBJECTS.person.fields.additionalOpportunities,
      STANDARD_OBJECTS.opportunityContact.fields.opportunity,
    ],
  ])(
    'should allow selecting multiple related records through the contact links',
    (relation, target) => {
      expect(
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          relation.universalIdentifier
        ],
      ).toMatchObject({
        isUIEditable: true,
        settings: { relationType: RelationType.ONE_TO_MANY },
        universalSettings: {
          junctionTargetFieldUniversalIdentifier: target.universalIdentifier,
        },
      });
    },
  );

  it('should prevent duplicate active contacts without preventing a person from joining another opportunity', () => {
    const index =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.opportunityContact.indexes.opportunityPersonUniqueIndex
          .universalIdentifier
      ];
    expect(index).toMatchObject({
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    });
    expect(
      index?.flatIndexFieldMetadatas.map((field) => field.fieldMetadataId),
    ).toEqual([
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.opportunityContact.fields.opportunity
          .universalIdentifier
      ]?.id,
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.opportunityContact.fields.person.universalIdentifier
      ]?.id,
    ]);
  });

  it.each(['opportunity', 'person'] as const)(
    'should remove only the contact link when its %s is permanently deleted',
    (relationName) => {
      expect(
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.opportunityContact.fields[relationName]
            .universalIdentifier
        ],
      ).toMatchObject({
        isNullable: false,
        settings: {
          relationType: RelationType.MANY_TO_ONE,
          onDelete: RelationOnDeleteAction.CASCADE,
        },
      });
    },
  );

  it('should include additional contacts when resolving an opportunity’s related people', () => {
    const flatObjectMetadataMaps = structuredClone(
      allFlatEntityMaps.flatObjectMetadataMaps,
    );
    // Installation populates these inverse field lists in the workspace cache.
    for (const object of Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).filter(isDefined)) {
      object.fieldIds = Object.values(
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier,
      )
        .filter(isDefined)
        .filter((field) => field.objectMetadataId === object.id)
        .map((field) => field.id);
    }
    expect(
      findRelationPathsToPerson({
        rootObjectNameSingular: 'opportunity',
        flatObjectMetadataMaps,
        flatFieldMetadataMaps: allFlatEntityMaps.flatFieldMetadataMaps,
      }),
    ).toEqual(
      expect.arrayContaining([
        [
          {
            direction: RelationType.ONE_TO_MANY,
            queryObjectNameSingular: 'opportunityContact',
            joinColumnName: 'opportunityId',
          },
          {
            direction: RelationType.MANY_TO_ONE,
            queryObjectNameSingular: 'opportunityContact',
            joinColumnName: 'personId',
          },
        ],
      ]),
    );
  });

  it('should expose additional contacts on a newly initialized opportunity page', () => {
    const widgetIdentifier =
      STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage.tabs.home
        .widgets.additionalContacts.universalIdentifier;
    expect(
      allFlatEntityMaps.flatPageLayoutWidgetMaps.byUniversalIdentifier[
        widgetIdentifier
      ],
    ).toMatchObject({
      title: 'Points of contact',
    });
  });
});
