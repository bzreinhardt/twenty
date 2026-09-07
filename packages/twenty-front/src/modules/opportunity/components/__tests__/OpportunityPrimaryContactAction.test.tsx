import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useIsRecordFieldReadOnly } from '@/object-record/read-only/hooks/useIsRecordFieldReadOnly';
import { OpportunityPrimaryContactAction } from '@/opportunity/components/OpportunityPrimaryContactAction';

const mockCreateManyRecords = jest.fn();
const mockUpdateOneRecord = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({
    objectMetadataItem: {
      id: 'metadata-id',
      fields: [{ id: 'primary-field', name: 'pointOfContact' }],
    },
  }),
}));
jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));
jest.mock('@/object-record/read-only/hooks/useIsRecordFieldReadOnly');
jest.mock('@/object-record/hooks/useCreateManyRecords', () => ({
  useCreateManyRecords: () => ({ createManyRecords: mockCreateManyRecords }),
}));
jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));
jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({ enqueueErrorSnackBar: mockEnqueueErrorSnackBar }),
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue', () => ({
  useAtomFamilyStateValue: () => ({
    id: 'opportunity-1',
    pointOfContactId: 'person-1',
  }),
}));
jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    onClick,
    disabled,
  }: {
    title: string;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {title}
    </button>
  ),
}));

describe('OpportunityPrimaryContactAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useIsRecordFieldReadOnly).mockReturnValue(false);
    mockCreateManyRecords.mockResolvedValue([{ id: 'link-1' }]);
    mockUpdateOneRecord.mockResolvedValue({ id: 'opportunity-1' });
  });

  it('should retain the old contact before making another contact primary', async () => {
    render(
      <OpportunityPrimaryContactAction
        opportunityId="opportunity-1"
        personId="person-2"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Make primary' }));
    await waitFor(() =>
      expect(mockUpdateOneRecord).toHaveBeenCalledWith({
        objectNameSingular: 'opportunity',
        idToUpdate: 'opportunity-1',
        updateOneRecordInput: { pointOfContactId: 'person-2' },
      }),
    );
    expect(mockCreateManyRecords).toHaveBeenCalledWith({
      recordsToCreate: [
        { opportunityId: 'opportunity-1', personId: 'person-1' },
      ],
      upsert: true,
    });
    expect(mockCreateManyRecords.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateOneRecord.mock.invocationCallOrder[0],
    );
  });

  it('should leave the primary unchanged when retaining the old contact fails', async () => {
    mockCreateManyRecords.mockRejectedValueOnce(new Error('Save failed'));
    render(
      <OpportunityPrimaryContactAction
        opportunityId="opportunity-1"
        personId="person-2"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Make primary' }));
    await waitFor(() => expect(mockEnqueueErrorSnackBar).toHaveBeenCalled());
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it('should label the primary contact without offering to promote it again', () => {
    render(
      <OpportunityPrimaryContactAction
        opportunityId="opportunity-1"
        personId="person-1"
      />,
    );
    expect(screen.getByText('Primary')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should hide the primary action when the field is read only', () => {
    jest.mocked(useIsRecordFieldReadOnly).mockReturnValue(true);
    render(
      <OpportunityPrimaryContactAction
        opportunityId="opportunity-1"
        personId="person-2"
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
