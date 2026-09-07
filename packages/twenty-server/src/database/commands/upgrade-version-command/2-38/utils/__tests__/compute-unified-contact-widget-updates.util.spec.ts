import {
  STANDARD_OBJECTS,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-shared/metadata';
import { PageLayoutTabLayoutMode } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { PRE_2_31_STANDARD_RECORD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER_BY_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/database/commands/upgrade-version-command/2-31/constants/pre-2-31-standard-record-page-layout-universal-identifier-by-object-universal-identifier.constant';
import { computeUnifiedContactWidgetUpdates } from 'src/database/commands/upgrade-version-command/2-38/utils/compute-unified-contact-widget-updates.util';
import { WidgetConfigurationType } from 'src/engine/metadata-modules/page-layout-widget/enums/widget-configuration-type.type';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const opportunityLayout =
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage;
const personLayout =
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage;

const setup = () => {
  const { allFlatEntityMaps: maps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      workspaceId: '20202020-1111-4111-8111-111111111111',
      twentyStandardApplicationId: APPLICATION_ID,
      now: '2026-01-01T00:00:00.000Z',
    });
  const widgets = maps.flatPageLayoutWidgetMaps.byUniversalIdentifier;
  const contacts =
    widgets[
      opportunityLayout.tabs.home.widgets.additionalContacts.universalIdentifier
    ];
  const opportunities =
    widgets[
      personLayout.tabs.home.widgets.pointOfContactForOpportunities
        .universalIdentifier
    ];
  if (
    !contacts ||
    !opportunities ||
    contacts.universalConfiguration.configurationType !==
      WidgetConfigurationType.FIELD ||
    opportunities.universalConfiguration.configurationType !==
      WidgetConfigurationType.FIELD
  )
    throw new Error('Missing standard field widgets');
  const primary = {
    ...contacts,
    universalIdentifier:
      opportunityLayout.tabs.home.widgets.pointOfContact.universalIdentifier,
    title: 'Point of Contact',
    universalConfiguration: {
      ...contacts.universalConfiguration,
      configurationType: WidgetConfigurationType.FIELD as const,
      fieldMetadataId:
        STANDARD_OBJECTS.opportunity.fields.pointOfContact.universalIdentifier,
    },
  };
  widgets[primary.universalIdentifier] = primary;
  opportunities.universalConfiguration = {
    ...opportunities.universalConfiguration,
    configurationType: WidgetConfigurationType.FIELD,
    fieldMetadataId:
      STANDARD_OBJECTS.person.fields.pointOfContactForOpportunities
        .universalIdentifier,
  };
  return {
    maps,
    contacts,
    primary,
    opportunities,
    run: () =>
      computeUnifiedContactWidgetUpdates({
        maps,
        standardApplicationId: APPLICATION_ID,
      }),
  };
};

describe('unified built-in contact widgets', () => {
  it('should update both built-in lists and retain the extra widget as inactive', () => {
    const { run, primary, contacts, opportunities } = setup();
    const updates = run();
    expect(updates).toHaveLength(3);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          universalIdentifier: primary.universalIdentifier,
          title: 'Points of contact',
          universalConfiguration: expect.objectContaining({
            fieldMetadataId:
              STANDARD_OBJECTS.opportunity.fields.additionalContacts
                .universalIdentifier,
          }),
        }),
        expect.objectContaining({
          universalIdentifier: contacts.universalIdentifier,
          isActive: false,
        }),
        expect.objectContaining({
          universalIdentifier: opportunities.universalIdentifier,
          universalConfiguration: expect.objectContaining({
            fieldMetadataId:
              STANDARD_OBJECTS.person.fields.additionalOpportunities
                .universalIdentifier,
          }),
        }),
      ]),
    );
  });

  it('should resolve retained legacy standard layouts without changing positions or identifiers', () => {
    const { maps, run, primary } = setup();
    const layout =
      maps.flatPageLayoutMaps.byUniversalIdentifier[
        opportunityLayout.universalIdentifier
      ];
    if (!layout) throw new Error('Missing layout');
    const legacy =
      PRE_2_31_STANDARD_RECORD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER_BY_OBJECT_UNIVERSAL_IDENTIFIER[
        STANDARD_OBJECTS.opportunity.universalIdentifier
      ];
    delete maps.flatPageLayoutMaps.byUniversalIdentifier[
      layout.universalIdentifier
    ];
    maps.flatPageLayoutMaps.byUniversalIdentifier[legacy] = {
      ...layout,
      universalIdentifier: legacy,
    };
    for (const tab of Object.values(
      maps.flatPageLayoutTabMaps.byUniversalIdentifier,
    ).filter(isDefined)) {
      if (tab.pageLayoutUniversalIdentifier === layout.universalIdentifier)
        tab.pageLayoutUniversalIdentifier = legacy;
    }
    primary.position = {
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      index: 23,
    };
    expect(run()).toContainEqual(
      expect.objectContaining({
        id: primary.id,
        position: primary.position,
        title: 'Points of contact',
      }),
    );
  });

  it.each(['title', 'ownership', 'overrides', 'layout'] as const)(
    'should leave a widget with customized %s untouched',
    (customization) => {
      const { maps, primary, contacts, run } = setup();
      if (customization === 'title') primary.title = 'Our decision makers';
      if (customization === 'ownership')
        primary.applicationId = 'custom-application';
      if (customization === 'overrides')
        primary.overrides = { title: 'Our contacts' };
      if (customization === 'layout') {
        const layout =
          maps.flatPageLayoutMaps.byUniversalIdentifier[
            opportunityLayout.universalIdentifier
          ];
        if (!layout) throw new Error('Missing layout');
        layout.applicationId = 'custom-application';
      }
      expect(run().map((widget) => widget.universalIdentifier)).not.toContain(
        primary.universalIdentifier,
      );
      expect(run()).not.toContainEqual(
        expect.objectContaining({
          universalIdentifier: contacts.universalIdentifier,
          isActive: false,
        }),
      );
    },
  );

  it('should be idempotent after its updates are applied', () => {
    const { maps, run } = setup();
    for (const widget of run())
      maps.flatPageLayoutWidgetMaps.byUniversalIdentifier[
        widget.universalIdentifier
      ] = widget;
    expect(run()).toEqual([]);
  });
});
