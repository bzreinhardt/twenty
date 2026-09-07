import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { ParticipantTargetReconciliationService } from 'src/modules/match-participant/participant-target-reconciliation.service';

jest.mock('src/engine/twenty-orm/storage/orm-workspace-context.storage');

const workspaceContext = jest.mocked(getWorkspaceContext);

describe('ParticipantTargetReconciliationService opportunity contacts', () => {
  const repositories = {
    calendarEventParticipant: { find: jest.fn() },
    person: { find: jest.fn() },
    opportunityContact: { find: jest.fn() },
    opportunity: { find: jest.fn() },
    calendarEventTarget: {
      find: jest.fn(),
      insert: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const getRepository = jest.fn(
    (name: keyof typeof repositories) => repositories[name],
  );
  const service = new ParticipantTargetReconciliationService({
    getRepository,
  } as unknown as WorkspaceOrmManager);

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceContext.mockReturnValue({
      objectIdByNameSingular: {
        calendarEventTarget: 'calendar-target-object',
        opportunityContact: 'contact-object',
      },
    } as unknown as ReturnType<typeof getWorkspaceContext>);
    repositories.calendarEventParticipant.find.mockResolvedValue([
      { calendarEventId: 'event', personId: 'primary-person' },
      { calendarEventId: 'event', personId: 'additional-person' },
    ]);
    repositories.person.find.mockResolvedValue([
      { id: 'primary-person', companyId: null },
      { id: 'additional-person', companyId: null },
    ]);
    repositories.opportunityContact.find.mockResolvedValue([
      { opportunityId: 'shared-opportunity', personId: 'additional-person' },
      { opportunityId: 'second-opportunity', personId: 'additional-person' },
      { opportunityId: 'deleted-opportunity', personId: 'additional-person' },
    ]);
    repositories.opportunity.find.mockResolvedValue([
      { id: 'shared-opportunity', pointOfContactId: 'primary-person' },
      { id: 'second-opportunity', pointOfContactId: null },
    ]);
    repositories.calendarEventTarget.find.mockResolvedValue([]);
  });

  it('should attach a meeting to every live opportunity through primary and additional contacts without duplicates', async () => {
    await service.reconcileCalendarEventTargets({
      calendarEventIds: ['event'],
    });

    const targets = repositories.calendarEventTarget.insert.mock.calls[0][0];
    expect(targets).toEqual([
      expect.objectContaining({ targetPersonId: 'primary-person' }),
      expect.objectContaining({ targetOpportunityId: 'shared-opportunity' }),
      expect.objectContaining({ targetPersonId: 'additional-person' }),
      expect.objectContaining({ targetOpportunityId: 'second-opportunity' }),
    ]);
    expect(targets).toHaveLength(4);
    expect(
      targets.every(
        (target: { isAutomaticallyAssigned: boolean }) =>
          target.isAutomaticallyAssigned,
      ),
    ).toBe(true);
  });

  it('should keep imports working before the additional contact metadata is installed', async () => {
    workspaceContext.mockReturnValue({
      objectIdByNameSingular: { calendarEventTarget: 'calendar-target-object' },
    } as unknown as ReturnType<typeof getWorkspaceContext>);
    repositories.opportunity.find.mockResolvedValue([
      { id: 'shared-opportunity', pointOfContactId: 'primary-person' },
    ]);

    await service.reconcileCalendarEventTargets({
      calendarEventIds: ['event'],
    });

    expect(repositories.opportunityContact.find).not.toHaveBeenCalled();
    expect(
      repositories.calendarEventTarget.insert.mock.calls[0][0],
    ).toHaveLength(3);
  });
});
