import {
  STANDARD_OBJECTS,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { PRE_2_31_STANDARD_RECORD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER_BY_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/database/commands/upgrade-version-command/2-31/constants/pre-2-31-standard-record-page-layout-universal-identifier-by-object-universal-identifier.constant';
import { type AllFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/all-flat-entity-maps.type';
import { type FlatPageLayoutWidget } from 'src/engine/metadata-modules/flat-page-layout-widget/types/flat-page-layout-widget.type';
import { WidgetConfigurationType } from 'src/engine/metadata-modules/page-layout-widget/enums/widget-configuration-type.type';

export const computeUnifiedContactWidgetUpdates = ({
  maps,
  standardApplicationId,
}: {
  maps: Pick<
    AllFlatEntityMaps,
    'flatPageLayoutMaps' | 'flatPageLayoutTabMaps' | 'flatPageLayoutWidgetMaps'
  >;
  standardApplicationId: string;
}): FlatPageLayoutWidget[] => {
  const updates: FlatPageLayoutWidget[] = [];
  const widgets = Object.values(
    maps.flatPageLayoutWidgetMaps.byUniversalIdentifier,
  ).filter(isDefined);
  const targets = [
    {
      object: STANDARD_OBJECTS.opportunity.universalIdentifier,
      layout:
        STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage
          .universalIdentifier,
      previousField:
        STANDARD_OBJECTS.opportunity.fields.pointOfContact.universalIdentifier,
      nextField:
        STANDARD_OBJECTS.opportunity.fields.additionalContacts
          .universalIdentifier,
      previousTitle: 'Point of Contact',
      title: 'Points of contact',
    },
    {
      object: STANDARD_OBJECTS.person.universalIdentifier,
      layout:
        STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage
          .universalIdentifier,
      previousField:
        STANDARD_OBJECTS.person.fields.pointOfContactForOpportunities
          .universalIdentifier,
      nextField:
        STANDARD_OBJECTS.person.fields.additionalOpportunities
          .universalIdentifier,
      previousTitle: 'Opportunities',
      title: 'Opportunities',
    },
  ];

  for (const target of targets) {
    const layouts = Object.values(maps.flatPageLayoutMaps.byUniversalIdentifier)
      .filter(isDefined)
      .filter(
        (layout) =>
          layout.applicationId === standardApplicationId &&
          layout.objectMetadataUniversalIdentifier === target.object &&
          [
            target.layout,
            PRE_2_31_STANDARD_RECORD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER_BY_OBJECT_UNIVERSAL_IDENTIFIER[
              target.object
            ],
          ].includes(layout.universalIdentifier),
      );
    const tabs = Object.values(maps.flatPageLayoutTabMaps.byUniversalIdentifier)
      .filter(isDefined)
      .filter((tab) =>
        layouts.some(
          (layout) =>
            layout.universalIdentifier === tab.pageLayoutUniversalIdentifier,
        ),
      );
    const eligibleWidgets = widgets.filter(
      (widget) =>
        widget.applicationId === standardApplicationId &&
        widget.isActive &&
        !isDefined(widget.overrides) &&
        tabs.some(
          (tab) =>
            tab.universalIdentifier === widget.pageLayoutTabUniversalIdentifier,
        ),
    );
    const primaryWidgets = eligibleWidgets.filter(
      (widget) =>
        widget.title === target.previousTitle &&
        widget.universalConfiguration.configurationType ===
          WidgetConfigurationType.FIELD &&
        widget.universalConfiguration.fieldMetadataId === target.previousField,
    );

    for (const widget of primaryWidgets) {
      if (
        widget.universalConfiguration.configurationType !==
        WidgetConfigurationType.FIELD
      )
        continue;
      updates.push({
        ...widget,
        title: target.title,
        universalConfiguration: {
          ...widget.universalConfiguration,
          fieldMetadataId: target.nextField,
        },
      });
    }

    for (const widget of eligibleWidgets) {
      if (
        widget.universalIdentifier !==
        STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.opportunityRecordPage.tabs
          .home.widgets.additionalContacts.universalIdentifier
      )
        continue;
      // Hide only the untouched extra widget introduced by this unreleased
      // feature. Retain the row so rollback can reactivate it. Never delete
      // widgets or modify custom layouts, titles, ownership or overrides.
      if (
        primaryWidgets.some(
          (primary) =>
            primary.pageLayoutTabUniversalIdentifier ===
            widget.pageLayoutTabUniversalIdentifier,
        )
      ) {
        updates.push({ ...widget, isActive: false });
      } else if (widget.title === 'Additional contacts') {
        updates.push({ ...widget, title: 'Points of contact' });
      }
    }
  }
  return updates;
};
