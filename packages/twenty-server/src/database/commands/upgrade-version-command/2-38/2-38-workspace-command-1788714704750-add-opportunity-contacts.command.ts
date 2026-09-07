import { Command } from 'nest-commander';
import {
  STANDARD_OBJECTS,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-shared/metadata';
import { PageLayoutTabLayoutMode } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WidgetConfigurationType } from 'src/engine/metadata-modules/page-layout-widget/enums/widget-configuration-type.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const FIELD_UNIVERSAL_IDENTIFIERS = [
  ...Object.values(STANDARD_OBJECTS.opportunityContact.fields).map(
    ({ universalIdentifier }) => universalIdentifier,
  ),
  STANDARD_OBJECTS.opportunity.fields.additionalContacts.universalIdentifier,
  STANDARD_OBJECTS.person.fields.additionalOpportunities.universalIdentifier,
];

@RegisteredWorkspaceCommand('2.38.0', 1788714704750)
@Command({
  name: 'upgrade:2-38:add-opportunity-contacts',
  description:
    'Add multiple additional opportunity contacts while preserving primary contacts and existing layouts',
})
export class AddOpportunityContactsCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const existing = await this.workspaceCacheService.getOrRecompute(
      workspaceId,
      [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
        'flatIndexMaps',
        'flatPageLayoutMaps',
        'flatPageLayoutTabMaps',
        'flatPageLayoutWidgetMaps',
      ],
    );

    if (
      ![STANDARD_OBJECTS.person, STANDARD_OBJECTS.opportunity].every(
        ({ universalIdentifier }) =>
          isDefined(
            existing.flatObjectMetadataMaps.byUniversalIdentifier[
              universalIdentifier
            ],
          ),
      )
    ) {
      this.logger.log(
        'Skipping contacts for a workspace without people and opportunities',
      );
      return;
    }

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { allFlatEntityMaps: standard } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const opportunityLayouts = Object.values(
      existing.flatPageLayoutMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .filter(
        (layout) =>
          layout.objectMetadataUniversalIdentifier ===
          STANDARD_OBJECTS.opportunity.universalIdentifier,
      );
    const opportunityTabs = Object.values(
      existing.flatPageLayoutTabMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .filter((tab) =>
        opportunityLayouts.some(
          (layout) =>
            layout.universalIdentifier === tab.pageLayoutUniversalIdentifier,
        ),
      );
    const opportunityWidgets = Object.values(
      existing.flatPageLayoutWidgetMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .filter((widget) =>
        opportunityTabs.some(
          (tab) =>
            tab.universalIdentifier === widget.pageLayoutTabUniversalIdentifier,
        ),
      );
    const primaryContactWidget = opportunityWidgets.find(
      (widget) =>
        widget.universalConfiguration.configurationType ===
          WidgetConfigurationType.FIELD &&
        widget.universalConfiguration.fieldMetadataId ===
          STANDARD_OBJECTS.opportunity.fields.pointOfContact
            .universalIdentifier,
    );
    // Older workspaces retain pre-2.31 layout identifiers. Resolve their
    // actual contact tab through its field, without renaming or replacing it.
    const existingHomeTab =
      opportunityTabs.find(
        (tab) =>
          tab.universalIdentifier ===
          primaryContactWidget?.pageLayoutTabUniversalIdentifier,
      ) ??
      opportunityTabs.find(
        (tab) =>
          tab.universalIdentifier ===
          STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage.tabs
            .home.universalIdentifier,
      );
    const hasContactList = opportunityWidgets.some(
      (widget) =>
        widget.universalConfiguration.configurationType ===
          WidgetConfigurationType.FIELD &&
        widget.universalConfiguration.fieldMetadataId ===
          STANDARD_OBJECTS.opportunity.fields.additionalContacts
            .universalIdentifier,
    );
    const widgets =
      !hasContactList &&
      isDefined(existingHomeTab) &&
      existingHomeTab.layoutMode === PageLayoutTabLayoutMode.VERTICAL_LIST
        ? getStandardFlatEntitiesToCreateOrThrow({
            standardFlatEntityMaps: standard.flatPageLayoutWidgetMaps,
            existingFlatEntityMaps: existing.flatPageLayoutWidgetMaps,
            universalIdentifiers: [
              STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage
                .tabs.home.widgets.additionalContacts.universalIdentifier,
            ],
          }).map((widget) => ({
            ...widget,
            pageLayoutTabId: existingHomeTab.id,
            pageLayoutTabUniversalIdentifier:
              existingHomeTab.universalIdentifier,
            // Append without moving any owner-customized widgets.
            position: {
              layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST as const,
              index:
                1 +
                Math.max(
                  -1,
                  ...Object.values(
                    existing.flatPageLayoutWidgetMaps.byUniversalIdentifier,
                  )
                    .filter(isDefined)
                    .filter(
                      (existingWidget) =>
                        existingWidget.pageLayoutTabUniversalIdentifier ===
                        existingHomeTab.universalIdentifier,
                    )
                    .map(
                      (existingWidget) =>
                        existingWidget.overrides?.position ??
                        existingWidget.position,
                    )
                    .map((existingWidget) =>
                      existingWidget?.layoutMode ===
                      PageLayoutTabLayoutMode.VERTICAL_LIST
                        ? existingWidget.index
                        : -1,
                    ),
                ),
            },
          }))
        : [];
    const operations = {
      objectMetadata: {
        flatEntityToCreate: getStandardFlatEntitiesToCreateOrThrow({
          standardFlatEntityMaps: standard.flatObjectMetadataMaps,
          existingFlatEntityMaps: existing.flatObjectMetadataMaps,
          universalIdentifiers: [
            STANDARD_OBJECTS.opportunityContact.universalIdentifier,
          ],
        }),
        flatEntityToUpdate: [],
        flatEntityToDelete: [],
      },
      fieldMetadata: {
        flatEntityToCreate: getStandardFlatEntitiesToCreateOrThrow({
          standardFlatEntityMaps: standard.flatFieldMetadataMaps,
          existingFlatEntityMaps: existing.flatFieldMetadataMaps,
          universalIdentifiers: FIELD_UNIVERSAL_IDENTIFIERS,
        }),
        flatEntityToUpdate: [],
        flatEntityToDelete: [],
      },
      index: {
        flatEntityToCreate: getStandardFlatEntitiesToCreateOrThrow({
          standardFlatEntityMaps: standard.flatIndexMaps,
          existingFlatEntityMaps: existing.flatIndexMaps,
          universalIdentifiers: Object.values(
            STANDARD_OBJECTS.opportunityContact.indexes,
          ).map(({ universalIdentifier }) => universalIdentifier),
        }),
        flatEntityToUpdate: [],
        flatEntityToDelete: [],
      },
      pageLayoutWidget: {
        flatEntityToCreate: widgets,
        flatEntityToUpdate: [],
        flatEntityToDelete: [],
      },
    };
    const operationCount = Object.values(operations).reduce(
      (total, operation) => total + operation.flatEntityToCreate.length,
      0,
    );
    if (operationCount === 0) {
      this.logger.log('Opportunity contacts are already installed');
      return;
    }
    this.logger.log(
      `${options.dryRun ? '[DRY RUN] Would apply' : 'Applying'} ${operationCount} opportunity contact metadata additions`,
    );
    if (options.dryRun) {
      return;
    }
    const result =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: operations,
          workspaceId,
          isSystemBuild: true,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );
    if (result.status === 'fail') {
      throw new Error(
        `Failed to add opportunity contact metadata: ${JSON.stringify(result)}`,
      );
    }
  }
}
