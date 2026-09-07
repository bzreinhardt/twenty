import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { isFieldWidget } from '@/page-layout/widgets/field/utils/isFieldWidget';
import { isDefined } from 'twenty-shared/utils';

export const resolvePersonOpportunitiesWidgetField = ({
  objectNameSingular,
  fields,
  fieldMetadataItem,
  widget,
  isStandardWidget,
}: {
  objectNameSingular: string;
  fields: FieldMetadataItem[];
  fieldMetadataItem: FieldMetadataItem | undefined;
  widget: PageLayoutWidget;
  isStandardWidget: boolean;
}): FieldMetadataItem | undefined => {
  if (
    objectNameSingular !== 'person' ||
    fieldMetadataItem?.name !== 'pointOfContactForOpportunities' ||
    !fieldMetadataItem.isActive ||
    !isStandardWidget ||
    widget.isOverridden === true ||
    widget.title !== 'Opportunities' ||
    !isFieldWidget(widget) ||
    isDefined(widget.configuration.nestedRelationFieldMetadataId) ||
    isDefined(widget.configuration.viewId)
  ) {
    return fieldMetadataItem;
  }

  // Older built-in layouts point at the primary-only inverse. Use the existing
  // combined collection for both rendering and editing without rewriting the
  // saved layout or changing the primary-only API field's meaning.
  return (
    fields.find(
      (field) =>
        field.name === 'additionalOpportunities' &&
        field.isActive &&
        field.applicationId === fieldMetadataItem.applicationId,
    ) ?? fieldMetadataItem
  );
};
