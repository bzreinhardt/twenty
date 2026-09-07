import { useFieldMetadataItemById } from '@/object-metadata/hooks/useFieldMetadataItemById';
import { useGetIsMetadataItemFromStandardApplication } from '@/object-metadata/hooks/useGetIsMetadataItemFromStandardApplication';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { formatFieldMetadataItemAsColumnDefinition } from '@/object-metadata/utils/formatFieldMetadataItemAsColumnDefinition';
import { resolvePersonOpportunitiesWidgetField } from '@/opportunity/utils/resolvePersonOpportunitiesWidgetField';
import { useResolveFieldMetadataIdFromNameOrId } from '@/page-layout/hooks/useResolveFieldMetadataIdFromNameOrId';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { isFieldWidget } from '@/page-layout/widgets/field/utils/isFieldWidget';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';
import { isDefined } from 'twenty-shared/utils';

export const useFieldWidgetFieldDefinition = (widget: PageLayoutWidget) => {
  const targetRecord = useTargetRecord();

  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular: targetRecord.targetObjectNameSingular,
  });

  const fieldMetadataId = isFieldWidget(widget)
    ? widget.configuration.fieldMetadataId
    : undefined;

  const resolvedFieldMetadataId = useResolveFieldMetadataIdFromNameOrId(
    fieldMetadataId ?? '',
  );

  const { fieldMetadataItem: configuredFieldMetadataItem } =
    useFieldMetadataItemById(resolvedFieldMetadataId ?? '');
  const getIsMetadataItemFromStandardApplication =
    useGetIsMetadataItemFromStandardApplication();
  const fieldMetadataItem = resolvePersonOpportunitiesWidgetField({
    objectNameSingular: objectMetadataItem.nameSingular,
    fields: objectMetadataItem.fields,
    fieldMetadataItem: configuredFieldMetadataItem,
    widget,
    isStandardWidget: getIsMetadataItemFromStandardApplication(widget) === true,
  });

  const fieldDefinition = isDefined(fieldMetadataItem)
    ? formatFieldMetadataItemAsColumnDefinition({
        field: fieldMetadataItem,
        position: 0,
        objectMetadataItem,
        showLabel: true,
        labelWidth: 90,
      })
    : null;

  return {
    objectMetadataItem,
    fieldMetadataItem: fieldMetadataItem ?? null,
    fieldDefinition,
  };
};
