import { resolvePersonOpportunitiesWidgetField } from '@/opportunity/utils/resolvePersonOpportunitiesWidgetField';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import {
  FieldDisplayMode,
  WidgetConfigurationType,
  WidgetType,
} from '~/generated-metadata/graphql';
import { getMockFieldMetadataItemOrThrow } from '~/testing/utils/getMockFieldMetadataItemOrThrow';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const primary = getMockFieldMetadataItemOrThrow({
  objectMetadataItem: getMockObjectMetadataItemOrThrow('person'),
  fieldName: 'pointOfContactForOpportunities',
});
const combined = {
  ...primary,
  id: 'combined-field',
  name: 'additionalOpportunities',
};
const widget: PageLayoutWidget = {
  id: 'widget',
  universalIdentifier: 'legacy-widget',
  applicationId: primary.applicationId ?? '',
  title: 'Opportunities',
  type: WidgetType.FIELD,
  isActive: true,
  isSystemSideEffect: false,
  pageLayoutTabId: 'tab',
  createdAt: '',
  updatedAt: '',
  configuration: {
    __typename: 'FieldConfiguration',
    configurationType: WidgetConfigurationType.FIELD,
    fieldMetadataId: primary.id,
    fieldDisplayMode: FieldDisplayMode.CARD,
  },
};
const resolve = (
  overrides: Partial<
    Parameters<typeof resolvePersonOpportunitiesWidgetField>[0]
  > = {},
) =>
  resolvePersonOpportunitiesWidgetField({
    objectNameSingular: 'person',
    fields: [primary, combined],
    fieldMetadataItem: primary,
    widget,
    isStandardWidget: true,
    ...overrides,
  });

describe('existing person Opportunities widget', () => {
  it('should display the combined collection without mutating the saved widget or field', () => {
    const before = structuredClone({ widget, primary });
    expect(resolve()).toBe(combined);
    expect({ widget, primary }).toEqual(before);
  });
  it.each([
    { isStandardWidget: false },
    { objectNameSingular: 'company' },
    { widget: { ...widget, title: 'Primary opportunities' } },
    { widget: { ...widget, isOverridden: true } },
    {
      widget: {
        ...widget,
        configuration: { ...widget.configuration, viewId: 'custom-view' },
      },
    },
    {
      widget: {
        ...widget,
        configuration: {
          ...widget.configuration,
          nestedRelationFieldMetadataId: 'nested-field',
        },
      },
    },
  ])(
    'should preserve explicitly customized and unrelated widgets: %p',
    (overrides) => {
      expect(resolve(overrides)).toBe(primary);
    },
  );
  it('should keep the original field when the combined collection is unavailable or inactive', () => {
    expect(resolve({ fields: [primary] })).toBe(primary);
    expect(
      resolve({ fields: [primary, { ...combined, isActive: false }] }),
    ).toBe(primary);
  });
  it('should preserve a field that is already configured to show all opportunities', () => {
    expect(resolve({ fieldMetadataItem: combined })).toBe(combined);
  });
});
