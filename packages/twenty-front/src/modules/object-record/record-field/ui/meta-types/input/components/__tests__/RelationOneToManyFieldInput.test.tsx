import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { formatFieldMetadataItemAsFieldDefinition } from '@/object-metadata/utils/formatFieldMetadataItemAsFieldDefinition';
import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { FieldInputEventContext } from '@/object-record/record-field/ui/contexts/FieldInputEventContext';
import { RelationOneToManyFieldInput } from '@/object-record/record-field/ui/meta-types/input/components/RelationOneToManyFieldInput';
import { type FieldDefinition } from '@/object-record/record-field/ui/types/FieldDefinition';
import { type FieldRelationMetadata } from '@/object-record/record-field/ui/types/FieldMetadata';
import { type RecordPickerPickableMorphItem } from '@/object-record/record-picker/types/RecordPickerPickableMorphItem';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { getMockFieldMetadataItemOrThrow } from '~/testing/utils/getMockFieldMetadataItemOrThrow';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';
import { getTestEnrichedObjectMetadataItemsMock } from '~/testing/utils/getTestEnrichedObjectMetadataItemsMock';

const mockUpdateJunctionRelation = jest.fn();

jest.mock('@/object-metadata/hooks/useObjectMetadataItem');
jest.mock('@/object-metadata/hooks/useObjectMetadataItems');
jest.mock(
  '@/object-record/record-field/ui/hooks/useUpdateJunctionRelationFromCell',
  () => ({
    useUpdateJunctionRelationFromCell: () => ({
      junctionConfig: { isValid: true },
      updateJunctionRelationFromCell: mockUpdateJunctionRelation,
    }),
  }),
);
jest.mock(
  '@/object-record/record-field/ui/hooks/useCreateJunctionRecordWithNestedTarget',
  () => ({
    useCreateJunctionRecordWithNestedTarget: () => ({ loading: false }),
  }),
);
jest.mock(
  '@/object-record/record-field/ui/meta-types/input/hooks/useAddNewRecordAndOpenSidePanel',
  () => ({
    useAddNewRecordAndOpenSidePanel: () => ({}),
  }),
);
jest.mock(
  '@/object-record/record-field/ui/meta-types/input/hooks/useUpdateRelationOneToManyFieldInput',
  () => ({
    useUpdateRelationOneToManyFieldInput: () => ({}),
  }),
);
jest.mock(
  '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow',
  () => ({
    useAvailableComponentInstanceIdOrThrow: () => 'contact-picker',
  }),
);
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue',
  () => ({
    useAtomComponentStateValue: () => 'downward',
  }),
);
jest.mock(
  '@/object-record/record-picker/multiple-record-picker/components/MultipleRecordPicker',
  () => ({
    MultipleRecordPicker: ({
      onChange,
      onSubmit,
    }: {
      onChange: (item: RecordPickerPickableMorphItem) => void;
      onSubmit: () => void;
    }) => (
      <div role="dialog" aria-label="Choose contacts">
        {['First contact', 'Second contact'].map((name) => (
          <button
            key={name}
            onClick={() =>
              onChange({
                recordId: name,
                objectMetadataId: 'person-metadata',
                isSelected: true,
                isMatchingSearchFilter: true,
              })
            }
          >
            {name}
          </button>
        ))}
        <button onClick={onSubmit}>Done</button>
      </div>
    ),
  }),
);

const company = getMockObjectMetadataItemOrThrow('company');
const person = getMockObjectMetadataItemOrThrow('person');
const fieldDefinition = formatFieldMetadataItemAsFieldDefinition({
  field: getMockFieldMetadataItemOrThrow({
    objectMetadataItem: company,
    fieldName: 'people',
  }),
  objectMetadataItem: company,
}) as FieldDefinition<FieldRelationMetadata>;

const PickerHarness = () => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <FieldContext.Provider
      value={{
        fieldDefinition,
        recordId: 'opportunity',
        isLabelIdentifier: false,
        isRecordFieldReadOnly: false,
      }}
    >
      <FieldInputEventContext.Provider
        value={{ onSubmit: () => setIsOpen(false) }}
      >
        {isOpen && <RelationOneToManyFieldInput />}
      </FieldInputEventContext.Provider>
    </FieldContext.Provider>
  );
};

describe('RelationOneToManyFieldInput contact selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useObjectMetadataItems).mockReturnValue({
      objectMetadataItems: getTestEnrichedObjectMetadataItemsMock(),
    });
  });

  const renderPicker = (nameSingular: string) => {
    jest.mocked(useObjectMetadataItem).mockReturnValue({
      objectMetadataItem: { ...person, nameSingular },
    } as ReturnType<typeof useObjectMetadataItem>);
    render(<PickerHarness />);
  };

  it('should save two opportunity contacts in one session and close when done', async () => {
    const user = userEvent.setup();
    renderPicker(CoreObjectNameSingular.OpportunityContact);
    await user.click(screen.getByRole('button', { name: 'First contact' }));
    await user.click(screen.getByRole('button', { name: 'Second contact' }));
    expect(
      mockUpdateJunctionRelation.mock.calls.map(
        ([{ morphItem }]) => morphItem.recordId,
      ),
    ).toEqual(['First contact', 'Second contact']);
    expect(
      screen.getByRole('dialog', { name: 'Choose contacts' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should retain the existing close-after-selection behavior for other junctions', async () => {
    const user = userEvent.setup();
    renderPicker(CoreObjectNameSingular.TaskTarget);
    await user.click(screen.getByRole('button', { name: 'First contact' }));
    expect(mockUpdateJunctionRelation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
