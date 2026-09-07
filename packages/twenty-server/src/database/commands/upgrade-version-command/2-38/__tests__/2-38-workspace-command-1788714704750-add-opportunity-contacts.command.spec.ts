import {
  STANDARD_OBJECTS,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-shared/metadata';
import { PageLayoutTabLayoutMode } from 'twenty-shared/types';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { AddOpportunityContactsCommand } from 'src/database/commands/upgrade-version-command/2-38/2-38-workspace-command-1788714704750-add-opportunity-contacts.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const HOME_WIDGETS =
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage.tabs.home
    .widgets;

const buildExisting = (installed = false) => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: APPLICATION_ID,
      now: '2026-01-01T00:00:00.000Z',
    });
  const contactList =
    allFlatEntityMaps.flatPageLayoutWidgetMaps.byUniversalIdentifier[
      HOME_WIDGETS.additionalContacts.universalIdentifier
    ];
  if (!contactList) throw new Error('Missing contact list template');
  // Exercise the pre-feature layout, independently of the new defaults.
  allFlatEntityMaps.flatPageLayoutWidgetMaps.byUniversalIdentifier[
    HOME_WIDGETS.pointOfContact.universalIdentifier
  ] = {
    ...contactList,
    id: '20202020-3333-4333-8333-333333333333',
    universalIdentifier: HOME_WIDGETS.pointOfContact.universalIdentifier,
    title: 'Point of Contact',
    universalConfiguration: {
      ...contactList.universalConfiguration,
      fieldMetadataId:
        STANDARD_OBJECTS.opportunity.fields.pointOfContact.universalIdentifier,
    },
  } as typeof contactList;
  if (!installed) {
    delete allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
      STANDARD_OBJECTS.opportunityContact.universalIdentifier
    ];
    for (const { universalIdentifier } of [
      ...Object.values(STANDARD_OBJECTS.opportunityContact.fields),
      STANDARD_OBJECTS.opportunity.fields.additionalContacts,
      STANDARD_OBJECTS.person.fields.additionalOpportunities,
    ]) {
      delete allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        universalIdentifier
      ];
    }
    for (const { universalIdentifier } of Object.values(
      STANDARD_OBJECTS.opportunityContact.indexes,
    )) {
      delete allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        universalIdentifier
      ];
    }
    delete allFlatEntityMaps.flatPageLayoutWidgetMaps.byUniversalIdentifier[
      HOME_WIDGETS.additionalContacts.universalIdentifier
    ];
  }
  return allFlatEntityMaps;
};

describe('AddOpportunityContactsCommand', () => {
  const createCommand = (existing = buildExisting()) => {
    const migrate = jest
      .fn<
        ReturnType<
          WorkspaceMigrationValidateBuildAndRunService['validateBuildAndRunWorkspaceMigration']
        >,
        Parameters<
          WorkspaceMigrationValidateBuildAndRunService['validateBuildAndRunWorkspaceMigration']
        >
      >()
      .mockResolvedValue({ status: 'success' } as Awaited<
        ReturnType<
          WorkspaceMigrationValidateBuildAndRunService['validateBuildAndRunWorkspaceMigration']
        >
      >);
    const command = new AddOpportunityContactsCommand(
      {} as WorkspaceIteratorService,
      {
        findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
          .fn()
          .mockResolvedValue({
            twentyStandardFlatApplication: {
              id: APPLICATION_ID,
              universalIdentifier: APPLICATION_ID,
            },
          }),
      } as unknown as ApplicationService,
      {
        getOrRecompute: jest.fn().mockResolvedValue(existing),
      } as unknown as WorkspaceCacheService,
      {
        validateBuildAndRunWorkspaceMigration: migrate,
      } as unknown as WorkspaceMigrationValidateBuildAndRunService,
    );
    return {
      migrate,
      run: (dryRun = false) =>
        command.runOnWorkspace({
          workspaceId: WORKSPACE_ID,
          options: { dryRun },
          index: 0,
          total: 1,
        }),
    };
  };

  it('should add contact metadata without rewriting primary contacts or existing metadata', async () => {
    const { migrate, run } = createCommand();
    await run();
    expect(migrate).toHaveBeenCalledTimes(1);
    const operations =
      migrate.mock.calls[0][0].allFlatEntityOperationByMetadataName;
    expect(
      operations.objectMetadata?.flatEntityToCreate?.map(
        (object) => object.nameSingular,
      ),
    ).toEqual(['opportunityContact']);
    for (const operation of Object.values(operations)) {
      expect(operation.flatEntityToDelete).toEqual([]);
      expect(operation.flatEntityToUpdate).toEqual([]);
    }
    expect(
      operations.fieldMetadata?.flatEntityToCreate?.map(
        (field) => field.universalIdentifier,
      ),
    ).not.toContain(
      STANDARD_OBJECTS.opportunity.fields.pointOfContact.universalIdentifier,
    );
  });

  it('should preserve customized widget positions and append the contact list', async () => {
    const existing = buildExisting();
    const pointOfContactWidget =
      existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[
        HOME_WIDGETS.pointOfContact.universalIdentifier
      ];
    if (!pointOfContactWidget)
      throw new Error('Missing standard contact widget');
    pointOfContactWidget.position = {
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      index: 50,
    };
    const { migrate, run } = createCommand(existing);
    await run();
    const widgets =
      migrate.mock.calls[0][0].allFlatEntityOperationByMetadataName
        .pageLayoutWidget?.flatEntityToCreate;
    expect(widgets).toHaveLength(1);
    expect(widgets?.[0].position).toEqual({
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      index: 51,
    });
    expect(pointOfContactWidget.position.index).toBe(50);
  });

  it('should perform no writes in dry-run mode', async () => {
    const { migrate, run } = createCommand();
    await run(true);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('should attach the picker to an older opportunity layout after contact metadata was installed', async () => {
    const existing = buildExisting(true);
    const homeIdentifier =
      STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage.tabs.home
        .universalIdentifier;
    const home =
      existing.flatPageLayoutTabMaps.byUniversalIdentifier[homeIdentifier];
    if (!home) throw new Error('Missing home tab');
    const legacyIdentifier = '20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    delete existing.flatPageLayoutTabMaps.byUniversalIdentifier[homeIdentifier];
    existing.flatPageLayoutTabMaps.byUniversalIdentifier[legacyIdentifier] = {
      ...home,
      title: 'Renamed contact tab',
      universalIdentifier: legacyIdentifier,
    };
    for (const widget of Object.values(
      existing.flatPageLayoutWidgetMaps.byUniversalIdentifier,
    )) {
      if (widget?.pageLayoutTabUniversalIdentifier === homeIdentifier) {
        widget.pageLayoutTabUniversalIdentifier = legacyIdentifier;
      }
    }
    delete existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[
      HOME_WIDGETS.additionalContacts.universalIdentifier
    ];
    const before = structuredClone(existing);
    const { migrate, run } = createCommand(existing);
    await run();
    const operations =
      migrate.mock.calls[0][0].allFlatEntityOperationByMetadataName;
    expect(operations.objectMetadata?.flatEntityToCreate).toEqual([]);
    expect(operations.pageLayoutWidget?.flatEntityToCreate).toEqual([
      expect.objectContaining({
        pageLayoutTabId: home.id,
        pageLayoutTabUniversalIdentifier: legacyIdentifier,
      }),
    ]);
    expect(existing).toEqual(before);
  });

  it('should keep an existing custom contact picker without adding a duplicate', async () => {
    const existing = buildExisting(true);
    const identifier = HOME_WIDGETS.additionalContacts.universalIdentifier;
    const widget =
      existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[identifier];
    if (!widget) throw new Error('Missing contact picker');
    delete existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[identifier];
    const customIdentifier = '20202020-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[customIdentifier] =
      {
        ...widget,
        universalIdentifier: customIdentifier,
        title: 'Our contacts',
      };
    const { migrate, run } = createCommand(existing);
    await run();
    expect(migrate).not.toHaveBeenCalled();
  });

  it('should append after overridden positions without moving existing widgets', async () => {
    const existing = buildExisting();
    const widget =
      existing.flatPageLayoutWidgetMaps.byUniversalIdentifier[
        HOME_WIDGETS.pointOfContact.universalIdentifier
      ];
    if (!widget) throw new Error('Missing contact picker');
    widget.overrides = {
      position: {
        layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
        index: 100,
      },
    };
    const { migrate, run } = createCommand(existing);
    await run();
    expect(
      migrate.mock.calls[0][0].allFlatEntityOperationByMetadataName
        .pageLayoutWidget?.flatEntityToCreate?.[0].position,
    ).toEqual({
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      index: 101,
    });
    expect(widget.overrides.position?.layoutMode).toBe(
      PageLayoutTabLayoutMode.VERTICAL_LIST,
    );
  });

  it('should leave an already upgraded workspace unchanged', async () => {
    const { migrate, run } = createCommand(buildExisting(true));
    await run();
    expect(migrate).not.toHaveBeenCalled();
  });
});
